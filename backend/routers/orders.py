"""Orders + Payments router.

Extracted from server.py (Jun 2026 refactor). Holds the full order lifecycle
and the Razorpay payment-first flow as ONE cohesive module, because payment
verification materialises orders through the SAME `_materialize_order` +
`_finalize_payment_intent` idempotency guard. Keeping them together preserves
the atomic `find_one_and_update` sentinel that prevents duplicate orders when
`/verify` races the webhook.

Shared primitives (db, notifications, websocket manager, QR helpers) are
injected via `make_router(...)` so behaviour is byte-for-byte identical to the
inline routes it replaces.
"""
from __future__ import annotations

import os
import json
import hmac
import hashlib
import secrets
import asyncio
import random
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import razorpay
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel, Field

from models import (
    OrderCreate, OrderStatus, BulkOrderCreate, OrderItemInput,
    RazorpayCheckoutIntent, RazorpayOrderCreate, RazorpayVerify,
)
from bson import ObjectId

logger = logging.getLogger(__name__)

RAZORPAY_MOCK_MODE = os.environ.get('RAZORPAY_MOCK_MODE', 'true').lower() == 'true'
CANCEL_WINDOW_SECONDS = int(os.environ.get('CANCEL_WINDOW_SECONDS', '300'))  # 5 min default


def get_razorpay_client():
    """Get razorpay client if not in mock mode, else None"""
    if RAZORPAY_MOCK_MODE:
        return None
    return razorpay.Client(auth=(os.environ['RAZORPAY_KEY_ID'], os.environ['RAZORPAY_KEY_SECRET']))


class _MarkPaidBody(BaseModel):
    # Cash payments are no longer accepted at the counter — only Physical QR (UPI).
    # Historical orders paid in cash remain in the DB; new collects must be physical_qr.
    method: str = Field(default="physical_qr", pattern="^physical_qr$")


class _ManualOrderBody(BaseModel):
    """Vendor-punched counter order for a non-corporate customer (Guest, etc.)."""
    customer_type: str
    items: List[OrderItemInput]
    site_id: Optional[str] = None
    special_instructions: Optional[str] = None
    mark_paid: bool = True
    payment_method: str = Field(default="physical_qr", pattern="^physical_qr$")


class _CustomerTypeBody(BaseModel):
    name: str


def make_router(db, safe_objectid, get_current_user, create_notification, manager,
                generate_pickup_qr, verify_pickup_qr):
    r = APIRouter()

    # ─── Cart validation + order materialisation helpers ────────────────
    async def _validate_cart(items):
        """Server-side price validation. Returns (validated_items, total_amount)."""
        if not items:
            raise HTTPException(status_code=400, detail="Cart is empty")
        menu_item_ids = [safe_objectid(item.menu_item_id, "Menu item") for item in items]
        menu_items_cursor = db.menu_items.find({"_id": {"$in": menu_item_ids}})
        menu_items_dict = {str(mi["_id"]): mi async for mi in menu_items_cursor}

        validated_items = []
        total_amount = 0.0
        for item in items:
            menu_item = menu_items_dict.get(item.menu_item_id)
            if not menu_item:
                raise HTTPException(status_code=400, detail=f"Menu item {item.menu_item_id} not found")
            if not menu_item.get("is_available", False):
                raise HTTPException(status_code=400, detail=f"Menu item {menu_item['name']} is not available")
            actual_price = float(menu_item["price"])
            if int(item.quantity) <= 0:
                raise HTTPException(status_code=400, detail=f"Invalid quantity for {menu_item['name']}")
            validated_items.append({
                "menu_item_id": item.menu_item_id,
                "name": menu_item["name"],
                "quantity": int(item.quantity),
                "price": actual_price,
                "counter": menu_item.get("counter") or None,
            })
            total_amount += actual_price * int(item.quantity)
        return validated_items, round(total_amount, 2)

    async def _materialize_order(
        *,
        user: dict,
        vendor_id: str,
        validated_items: list,
        total_amount: float,
        payment_status: str,               # 'paid' (razorpay) | 'pending' (offline)
        payment_method: Optional[str],     # 'razorpay' | None
        delivery_type: str = "pickup",
        special_instructions: Optional[str] = None,
        razorpay_order_id: Optional[str] = None,
        razorpay_payment_id: Optional[str] = None,
    ):
        """Insert the order row + collection_code + QR + notifications.
        Callable from OFFLINE create_order and from Razorpay verify/webhook.
        Returns (order_id_str, order_doc).
        """
        now = datetime.now(timezone.utc)
        order_doc = {
            "user_id": user["id"],
            "employee_name": user.get("name") or user.get("email"),
            "employee_email": user.get("email"),
            "vendor_id": vendor_id,
            # Hierarchy linkage — stamp the employee's site + company so the order
            # rolls up correctly through Client → City → Site → ... → Order for
            # scoping and reporting at every admin level.
            "site_id": user.get("site_id"),
            "company_id": user.get("company_id"),
            "items": validated_items,
            "total_amount": total_amount,
            "status": "pending",
            "payment_status": payment_status,
            "collection_code": f"CRV-{random.randint(100000, 999999)}",
            "payment_mode": os.environ.get("PAYMENT_MODE", "OFFLINE").upper(),
            "payment_method": payment_method,
            "delivery_type": delivery_type,
            "special_instructions": special_instructions,
            # Inherit the counter tag from the first item that carries one — used
            # by the vendor Sales Report for per-counter breakdowns. If no item
            # has a counter (single-counter vendor), stays null.
            "counter": next((it.get("counter") for it in validated_items if it.get("counter")), None),
            "created_at": now,
        }
        if payment_status == "paid":
            order_doc["paid_at"] = now
        if razorpay_order_id:
            order_doc["razorpay_order_id"] = razorpay_order_id
        if razorpay_payment_id:
            order_doc["razorpay_payment_id"] = razorpay_payment_id

        result = await db.orders.insert_one(order_doc)
        order_id = str(result.inserted_id)

        qr_code = generate_pickup_qr(order_id)
        update_doc = {"pickup_qr": qr_code}

        vendor_doc = await db.vendors.find_one({"_id": safe_objectid(vendor_id, "Vendor")})
        if vendor_doc and vendor_doc.get("auto_confirm"):
            update_doc["status"] = "confirmed"
            order_doc["status"] = "confirmed"
        if payment_status == "paid" and update_doc.get("status") != "confirmed":
            # Paid orders auto-confirm — no reason to leave them "pending"
            update_doc["status"] = "confirmed"
            order_doc["status"] = "confirmed"

        await db.orders.update_one({"_id": result.inserted_id}, {"$set": update_doc})
        order_doc["pickup_qr"] = qr_code

        # Notify vendor
        vendor_users = await db.users.find({"vendor_id": vendor_id, "role": "vendor"}).to_list(10)
        for vu in vendor_users:
            await create_notification(
                str(vu["_id"]),
                "New Paid Order" if payment_status == "paid" else "New Order Received",
                f"Order for ₹{total_amount:.2f} — Code {order_doc['collection_code']}",
                "order",
            )
        await manager.send_to_vendor(vendor_id, {
            "type": "new_order",
            "order_id": order_id,
            "status": order_doc["status"],
            "amount": total_amount,
            "items_count": len(validated_items),
            "payment_status": payment_status,
        })
        await manager.send_to_user(user["id"], {
            "type": "order_created",
            "order_id": order_id,
            "collection_code": order_doc["collection_code"],
            "payment_status": payment_status,
        })

        # Best-effort order confirmation email
        try:
            prefs = (user.get("notification_preferences") or {})
            if prefs.get("order_confirm_email", False):
                import email_service
                oc_html, oc_text = email_service.render_order_confirmation_email(
                    name=user.get("name") or user["email"],
                    order_id=order_id,
                    vendor_name=vendor_doc.get("name", "Cravitoo Vendor") if vendor_doc else "Cravitoo Vendor",
                    items=validated_items,
                    total=total_amount,
                )
                email_service.send_email(
                    user["email"],
                    f"Order Confirmed — ₹{total_amount:.2f} from {vendor_doc.get('name', 'Cravitoo') if vendor_doc else 'Cravitoo'}",
                    oc_html, oc_text,
                )
        except Exception as e:
            logger.warning(f"Order confirmation email failed: {e}")

        return order_id, order_doc

    async def _finalize_payment_intent(*, intent: dict, razorpay_payment_id: str, source: str) -> Optional[dict]:
        """Idempotent materialisation: turns a paid payment_intent into a real
        Cravitoo order. Safe to call from both /verify and the webhook — the
        findOneAndUpdate on (cravitoo_order_id: None) is the atomic guard.

        Returns the Cravitoo order document (from a fresh find) or None if
        the intent was already materialised.
        """
        # Atomic claim: only ONE caller succeeds. We flip cravitoo_order_id from
        # None → a sentinel INSIDE the same atomic update, so a second concurrent
        # caller (e.g. /verify racing the webhook) no longer matches the filter and
        # cannot materialise a duplicate order.
        claim = await db.payment_intents.find_one_and_update(
            {"_id": intent["_id"], "cravitoo_order_id": None},
            {"$set": {"status": "materialising", "cravitoo_order_id": "__materialising__",
                      "materialising_by": source, "materialising_at": datetime.now(timezone.utc)}},
        )
        if claim is None:
            # Already claimed/materialised by another caller. The winner may still
            # be inside _materialize_order (cravitoo_order_id == sentinel). Poll
            # briefly so this (losing) caller returns the SAME finished order instead
            # of a false "could not finalise" error.
            for _ in range(20):  # up to ~2s
                cur = await db.payment_intents.find_one({"_id": intent["_id"]})
                oid = cur.get("cravitoo_order_id") if cur else None
                if oid and oid != "__materialising__":
                    return await db.orders.find_one({"_id": safe_objectid(oid, "Order")})
                if oid is None:
                    # Winner released the claim (e.g. user missing) — nothing to return.
                    return None
                await asyncio.sleep(0.1)
            return None

        # We hold the claim — materialise now.
        user_doc = await db.users.find_one({"_id": safe_objectid(intent["user_id"], "User")})
        if not user_doc:
            # User disappeared — release the claim so a retry can happen
            await db.payment_intents.update_one({"_id": intent["_id"]}, {"$set": {"cravitoo_order_id": None, "status": "user_missing"}})
            return None
        user_dict = {**user_doc, "id": str(user_doc["_id"])}

        # Re-validate cart at materialisation time — prices might have shifted; but
        # we honour the intent snapshot as the source of truth since the customer
        # already paid on that amount.
        validated_items = intent["items"]
        total_amount = intent["total_amount"]

        order_id, order_doc = await _materialize_order(
            user=user_dict,
            vendor_id=intent["vendor_id"],
            validated_items=validated_items,
            total_amount=total_amount,
            payment_status="paid",
            payment_method="razorpay",
            delivery_type=intent.get("delivery_type", "pickup"),
            special_instructions=intent.get("special_instructions"),
            razorpay_order_id=intent["razorpay_order_id"],
            razorpay_payment_id=razorpay_payment_id,
        )

        await db.payment_intents.update_one(
            {"_id": intent["_id"]},
            {"$set": {
                "cravitoo_order_id": order_id,
                "razorpay_payment_id": razorpay_payment_id,
                "status": "paid",
                "materialised_at": datetime.now(timezone.utc),
            }},
        )

        return await db.orders.find_one({"_id": safe_objectid(order_id, "Order")})

    # ─── Order Routes ───────────────────────────────────────────────────
    @r.post("/orders")
    async def create_order(data: OrderCreate, user: dict = Depends(get_current_user)):
        if user["role"] != "employee":
            raise HTTPException(status_code=403, detail="Only employees can create orders")

        # Payment-mode gate: in RAZORPAY mode, employees must go through
        # the /payments/razorpay/checkout-intent → /verify path so we
        # never persist an unpaid order. This POST /orders route is the
        # OFFLINE (pay-at-counter) path only.
        active_mode = os.environ.get("PAYMENT_MODE", "OFFLINE").upper()
        if active_mode == "RAZORPAY":
            raise HTTPException(
                status_code=400,
                detail="Online payment mode is active — use /payments/razorpay/checkout-intent instead of creating an order directly.",
            )

        validated_items, total_amount = await _validate_cart(data.items)

        order_id, order_doc = await _materialize_order(
            user=user,
            vendor_id=data.vendor_id,
            validated_items=validated_items,
            total_amount=total_amount,
            payment_status="pending",
            payment_method=None,
            delivery_type=data.delivery_type,
            special_instructions=data.special_instructions,
        )

        return {
            "id": order_id,
            "total_amount": total_amount,
            "status": order_doc["status"],
            "pickup_qr": order_doc.get("pickup_qr"),
            "collection_code": order_doc["collection_code"],
            "payment_mode": order_doc["payment_mode"],
            "payment_status": order_doc["payment_status"],
        }

    # ─── Manual counter orders (non-corporate customers) ─────────────────
    _DEFAULT_CUSTOMER_TYPES = ["Guest", "Housekeeping", "Security", "Drivers", "Facility Management"]

    async def _get_customer_types():
        docs = await db.customer_types.find({"active": {"$ne": False}}).sort("name", 1).to_list(200)
        if not docs:
            for n in _DEFAULT_CUSTOMER_TYPES:
                await db.customer_types.update_one(
                    {"name": n}, {"$setOnInsert": {"name": n, "active": True}}, upsert=True)
            docs = await db.customer_types.find({"active": {"$ne": False}}).sort("name", 1).to_list(200)
        return docs

    @r.get("/customer-types")
    async def list_customer_types(user: dict = Depends(get_current_user)):
        """Customer types for manual orders. Auto-seeds sensible defaults."""
        docs = await _get_customer_types()
        return [{"id": str(d["_id"]), "name": d["name"]} for d in docs]

    @r.post("/admin/customer-types")
    async def add_customer_type(body: _CustomerTypeBody, user: dict = Depends(get_current_user)):
        if user["role"] != "master_admin":
            raise HTTPException(status_code=403, detail="Only master admin")
        name = (body.name or "").strip()[:60]
        if not name:
            raise HTTPException(status_code=400, detail="Name required")
        await db.customer_types.update_one({"name": name}, {"$set": {"name": name, "active": True}}, upsert=True)
        return {"success": True, "name": name}

    @r.delete("/admin/customer-types/{type_id}")
    async def delete_customer_type(type_id: str, user: dict = Depends(get_current_user)):
        if user["role"] != "master_admin":
            raise HTTPException(status_code=403, detail="Only master admin")
        await db.customer_types.update_one(
            {"_id": safe_objectid(type_id, "Customer type")}, {"$set": {"active": False}})
        return {"success": True}

    @r.post("/vendor/manual-order")
    async def create_manual_order(body: _ManualOrderBody, user: dict = Depends(get_current_user)):
        """Vendor punches an order for a non-corporate customer (Guest, Housekeeping,
        etc.). Scoped strictly to the vendor's own counter + site. Flows through the
        same Orders / Sales Report / history as any other order."""
        if user.get("role") != "vendor" or not user.get("vendor_id"):
            raise HTTPException(status_code=403, detail="Only vendors can punch manual orders")
        vendor_id = user["vendor_id"]
        maps = await db.vendor_site_mappings.find(
            {"vendor_id": vendor_id, "status": "active"}, {"site_id": 1}).to_list(20)
        site_ids = [str(m["site_id"]) for m in maps if m.get("site_id")]
        uniq = list(dict.fromkeys(site_ids))
        if body.site_id:
            if body.site_id not in uniq:
                raise HTTPException(status_code=403, detail="That site is not assigned to you")
            site_id = body.site_id
        elif len(uniq) == 1:
            site_id = uniq[0]
        elif len(uniq) == 0:
            raise HTTPException(status_code=400, detail="Your vendor account isn't linked to a site yet")
        else:
            raise HTTPException(status_code=400, detail="You serve multiple sites — please pick one")

        ct = (body.customer_type or "").strip()
        valid = {d["name"] for d in await _get_customer_types()}
        if ct not in valid:
            raise HTTPException(status_code=400, detail="Unknown customer type")

        validated_items, total_amount = await _validate_cart(body.items)
        site = await db.sites.find_one(
            {"_id": safe_objectid(site_id, "Site")}, {"company_id": 1, "city_id": 1}) or {}
        now = datetime.now(timezone.utc)
        order_doc = {
            "user_id": None,
            "employee_name": ct,
            "employee_email": None,
            "customer_type": ct,
            "is_manual": True,
            "created_by_vendor": user["id"],
            "vendor_id": vendor_id,
            "site_id": site_id,
            "company_id": site.get("company_id"),
            "city_id": site.get("city_id"),
            "items": validated_items,
            "total_amount": total_amount,
            "status": "pending",
            "payment_status": "paid" if body.mark_paid else "pending",
            "collection_code": f"CRV-{random.randint(100000, 999999)}",
            "payment_mode": os.environ.get("PAYMENT_MODE", "OFFLINE").upper(),
            "payment_method": body.payment_method if body.mark_paid else None,
            "delivery_type": "pickup",
            "special_instructions": body.special_instructions,
            "counter": next((it.get("counter") for it in validated_items if it.get("counter")), None),
            "created_at": now,
        }
        if body.mark_paid:
            order_doc["paid_at"] = now
            order_doc["paid_by"] = user["email"]
        res = await db.orders.insert_one(order_doc)
        return {
            "id": str(res.inserted_id),
            "collection_code": order_doc["collection_code"],
            "total_amount": total_amount,
            "customer_type": ct,
            "payment_status": order_doc["payment_status"],
        }

    # ─── Offline payment mode (Feb 2026) ─────────────────────────────────
    @r.get("/config/payment-mode")
    async def get_payment_mode():
        """Public config probe: tells the frontend whether to send the
        customer to Razorpay or straight to a collection-code screen.

        Values: ``OFFLINE`` (cash / physical QR collected at counter) or
        ``RAZORPAY`` (online). Controlled via the ``PAYMENT_MODE`` env
        var — flipping this + a backend restart is the only step needed to
        switch modes later.
        """
        return {"mode": os.environ.get("PAYMENT_MODE", "OFFLINE").upper()}

    @r.post("/orders/{order_id}/mark-paid")
    async def mark_order_paid(order_id: str, body: _MarkPaidBody, user: dict = Depends(get_current_user)):
        """Vendor / site_admin / master_admin marks an offline order paid.

        Records the collection method separately from order status so the
        admin reconciliation dashboard can slice by cash vs physical-QR.
        Idempotent — re-calling on an already-paid order 409s so double-
        collect attempts are caught.
        """
        if user["role"] not in ("vendor", "site_admin", "master_admin"):
            raise HTTPException(status_code=403, detail="Only vendor / site admin / master admin can mark paid")
        order = await db.orders.find_one({"_id": safe_objectid(order_id, "Order")})
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if user["role"] == "vendor" and order.get("vendor_id") != user.get("vendor_id"):
            raise HTTPException(status_code=403, detail="Not your order")
        if order.get("payment_status") == "paid":
            raise HTTPException(status_code=409, detail="Order is already marked paid")

        await db.orders.update_one(
            {"_id": order["_id"]},
            {"$set": {
                "payment_status": "paid",
                "payment_method": body.method,
                "paid_at": datetime.now(timezone.utc),
                "paid_by": user["email"],
            }},
        )
        return {"order_id": order_id, "payment_status": "paid", "payment_method": body.method}

    @r.post("/orders/collect/{collection_code}")
    async def scan_collect(collection_code: str, body: _MarkPaidBody, user: dict = Depends(get_current_user)):
        """One-tap collect flow — vendor scans the employee's QR at the
        counter and picks Cash or Physical QR. In a single call:

          1. Looks up the order by ``collection_code`` (indexed).
          2. Verifies the vendor owns the order (403 if not).
          3. Sets ``payment_status: paid`` + ``payment_method``.
          4. Bumps ``status`` to ``collected``.

        Rejects if the collection code doesn't exist or the order is
        already collected — makes double-scan safe.
        """
        if user["role"] not in ("vendor", "site_admin", "master_admin"):
            raise HTTPException(status_code=403, detail="Only vendor / site admin / master admin can collect")
        code = collection_code.strip().upper()
        order = await db.orders.find_one({"collection_code": code})
        if not order:
            raise HTTPException(status_code=404, detail=f"No order found with code {code}")
        if user["role"] == "vendor" and order.get("vendor_id") != user.get("vendor_id"):
            raise HTTPException(status_code=403, detail="This order belongs to a different vendor")
        if order.get("status") == "collected":
            raise HTTPException(status_code=409, detail="Order already collected")

        now = datetime.now(timezone.utc)
        await db.orders.update_one(
            {"_id": order["_id"]},
            {"$set": {
                "payment_status": "paid",
                "payment_method": body.method,
                "paid_at": now,
                "paid_by": user["email"],
                "status": "collected",
                "collected_at": now,
            }},
        )
        return {
            "order_id": str(order["_id"]),
            "collection_code": code,
            "payment_status": "paid",
            "payment_method": body.method,
            "status": "collected",
        }

    @r.get("/admin/orders/reconciliation")
    async def orders_reconciliation(user: dict = Depends(get_current_user)):
        """Bucketed counts + rupee totals for admin reconciliation.

        Buckets: total, pending, cash, physical_qr, paid, unpaid,
        ready_for_collection, collected, cancelled. Every bucket returns
        ``{count, amount}`` so admins can see both volume and value.
        """
        if user["role"] not in ("site_admin", "master_admin"):
            raise HTTPException(status_code=403, detail="Only site admin / master admin")

        pipeline = [
            {"$group": {
                "_id": None,
                "total_count":  {"$sum": 1},
                "total_amount": {"$sum": "$total_amount"},
                "pending_count":  {"$sum": {"$cond": [{"$eq": ["$payment_status", "pending"]}, 1, 0]}},
                "pending_amount": {"$sum": {"$cond": [{"$eq": ["$payment_status", "pending"]}, "$total_amount", 0]}},
                "cash_count":  {"$sum": {"$cond": [{"$eq": ["$payment_method", "cash"]}, 1, 0]}},
                "cash_amount": {"$sum": {"$cond": [{"$eq": ["$payment_method", "cash"]}, "$total_amount", 0]}},
                "qr_count":  {"$sum": {"$cond": [{"$eq": ["$payment_method", "physical_qr"]}, 1, 0]}},
                "qr_amount": {"$sum": {"$cond": [{"$eq": ["$payment_method", "physical_qr"]}, "$total_amount", 0]}},
                "paid_count":  {"$sum": {"$cond": [{"$eq": ["$payment_status", "paid"]}, 1, 0]}},
                "paid_amount": {"$sum": {"$cond": [{"$eq": ["$payment_status", "paid"]}, "$total_amount", 0]}},
                "ready_count":  {"$sum": {"$cond": [{"$eq": ["$status", "ready_for_collection"]}, 1, 0]}},
                "collected_count":  {"$sum": {"$cond": [{"$eq": ["$status", "collected"]}, 1, 0]}},
                "cancelled_count":  {"$sum": {"$cond": [{"$eq": ["$status", "cancelled"]}, 1, 0]}},
            }},
        ]
        agg = await db.orders.aggregate(pipeline).to_list(1)
        if not agg:
            return {"buckets": {k: {"count": 0, "amount": 0} for k in [
                "total", "pending", "cash", "physical_qr", "paid", "unpaid",
                "ready_for_collection", "collected", "cancelled",
            ]}, "payment_mode": os.environ.get("PAYMENT_MODE", "OFFLINE").upper()}
        rr = agg[0]
        total = rr["total_count"]
        paid = rr["paid_count"]
        return {
            "buckets": {
                "total":                {"count": total,                "amount": round(rr["total_amount"], 2)},
                "pending":              {"count": rr["pending_count"],   "amount": round(rr["pending_amount"], 2)},
                "cash":                 {"count": rr["cash_count"],      "amount": round(rr["cash_amount"], 2)},
                "physical_qr":          {"count": rr["qr_count"],        "amount": round(rr["qr_amount"], 2)},
                "paid":                 {"count": paid,                 "amount": round(rr["paid_amount"], 2)},
                "unpaid":               {"count": total - paid,         "amount": round(rr["total_amount"] - rr["paid_amount"], 2)},
                "ready_for_collection": {"count": rr["ready_count"],     "amount": 0},
                "collected":            {"count": rr["collected_count"], "amount": 0},
                "cancelled":            {"count": rr["cancelled_count"], "amount": 0},
            },
            "payment_mode": os.environ.get("PAYMENT_MODE", "OFFLINE").upper(),
        }

    @r.get("/orders")
    async def get_orders(user: dict = Depends(get_current_user)):
        query = {}
        role = user["role"]
        if role == "employee":
            query["user_id"] = user["id"]
        elif role == "vendor":
            query["vendor_id"] = user.get("vendor_id")
        elif role == "site_admin":
            # Site admin only sees orders placed at their own site.
            sid = user.get("site_id")
            if not sid:
                return []
            query["site_id"] = sid
        elif role == "corporate_admin":
            # Corporate admin only sees their company's orders.
            cid = user.get("company_id")
            if not cid:
                return []
            query["company_id"] = cid
        elif role == "super_admin":
            # Super admin sees orders across only their assigned sites.
            assigned = user.get("assigned_sites") or []
            if not assigned:
                return []
            query["site_id"] = {"$in": assigned}
        # master_admin: no filter — sees every order.

        orders = await db.orders.find(query, {"_id": 1, "user_id": 1, "employee_name": 1, "employee_email": 1, "vendor_id": 1, "site_id": 1, "company_id": 1, "counter": 1, "customer_type": 1, "is_manual": 1, "items": 1, "total_amount": 1, "status": 1, "payment_status": 1, "delivery_type": 1, "created_at": 1, "pickup_qr": 1, "collection_code": 1, "payment_mode": 1, "payment_method": 1, "paid_at": 1}).sort("created_at", -1).to_list(1000)
        # Resolve employee names for legacy orders that were placed before we started
        # stamping employee_name on the order document.
        missing = {o.get("user_id") for o in orders if not o.get("employee_name") and o.get("user_id")}
        name_map = {}
        if missing:
            oids = []
            for uid in missing:
                try:
                    oids.append(ObjectId(uid))
                except Exception:
                    pass
            async for u in db.users.find({"_id": {"$in": oids}}, {"name": 1, "email": 1}):
                name_map[str(u["_id"])] = u.get("name") or u.get("email")
        for order in orders:
            order["id"] = str(order.pop("_id"))
            if not order.get("employee_name"):
                order["employee_name"] = name_map.get(order.get("user_id")) or "Walk-in / Kiosk"
            # Normalise created_at to a UTC-aware ISO string ('+00:00') so the client
            # always converts to the correct local time (naive datetimes were being
            # read as local, showing the wrong order time).
            ca = order.get("created_at")
            if isinstance(ca, datetime):
                if ca.tzinfo is None:
                    ca = ca.replace(tzinfo=timezone.utc)
                order["created_at"] = ca.astimezone(timezone.utc).isoformat()
        return orders

    @r.patch("/orders/{order_id}")
    async def update_order_status(order_id: str, status: OrderStatus, user: dict = Depends(get_current_user)):
        """Vendor / admin endpoint to change an order's status.

        Server-side state machine in routers/order_lifecycle.py enforces:
          - only valid transitions for the actor's role
          - no double / out-of-order updates (atomic conditional update)
          - terminal states are immutable
          - stale orders (older than 48h, non-terminal) are read-only
        """
        from order_lifecycle import assert_transition_allowed, apply_transition

        if user["role"] not in ("vendor", "master_admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Only vendors or master admins can update order status")

        order_oid = safe_objectid(order_id, "Order")
        # Vendors can only modify their own vendor's orders.
        query: dict = {"_id": order_oid}
        if user["role"] == "vendor":
            query["vendor_id"] = user.get("vendor_id")

        order = await db.orders.find_one(query)
        if not order:
            raise HTTPException(status_code=404, detail="Order not found or not yours")

        target_status = status.value
        current_status = order.get("status") or "pending"

        # Validate transition (raises HTTPException on invalid)
        assert_transition_allowed(order, target_status, user["role"])

        # Atomic update — fails if a concurrent request beat us.
        ok = await apply_transition(db, order_oid, current_status, target_status, user)
        if not ok:
            raise HTTPException(
                status_code=409,
                detail="Order status changed concurrently. Reload and try again.",
            )

        # Notify employee with push + ws
        status_messages = {
            "confirmed": "Your order has been confirmed!",
            "preparing": "Your food is being prepared",
            "ready": "Your order is ready for pickup!",
            "completed": "Order completed. Enjoy your meal!",
            "cancelled": "Your order was cancelled",
            "rejected": "Your order was rejected by the vendor",
            "no_show": "Your order was marked as no-show",
            "expired": "Your order expired before confirmation",
        }
        msg = status_messages.get(target_status, f"Order status: {target_status}")
        await create_notification(
            order["user_id"],
            f"Order #{order_id[-8:]}",
            msg,
            "order"
        )

        # Broadcast WebSocket event
        await manager.send_to_user(order["user_id"], {
            "type": "order_update",
            "order_id": order_id,
            "status": target_status
        })

        return {"message": "Order status updated", "status": target_status}

    @r.post("/orders/{order_id}/verify-pickup")
    async def verify_pickup(order_id: str, qr_code: str, user: dict = Depends(get_current_user)):
        """Vendor scans the employee QR to mark the order as picked up.

        Only valid for orders currently in 'ready' state. State transition is
        routed through the same lifecycle helper so concurrent updates are safe.
        """
        from order_lifecycle import assert_transition_allowed, apply_transition

        if user["role"] != "vendor":
            raise HTTPException(status_code=403, detail="Only vendors can verify pickup")

        order_oid = safe_objectid(order_id, "Order")
        order = await db.orders.find_one({"_id": order_oid, "vendor_id": user.get("vendor_id")})
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")

        if not verify_pickup_qr(qr_code, order_id):
            raise HTTPException(status_code=400, detail="Invalid QR code")

        current_status = order.get("status") or "pending"
        assert_transition_allowed(order, "completed", user["role"])
        ok = await apply_transition(db, order_oid, current_status, "completed", user)
        if not ok:
            raise HTTPException(
                status_code=409,
                detail="Order status changed concurrently. Reload and try again.",
            )
        return {"message": "Pickup verified successfully", "order_id": order_id}

    # ─── Bulk Team Ordering ─────────────────────────────────────────────
    @r.post("/orders/bulk")
    async def create_bulk_order(data: BulkOrderCreate, user: dict = Depends(get_current_user)):
        if user["role"] not in ["corporate_admin", "employee"]:
            raise HTTPException(status_code=403, detail="Access denied")

        bulk_order_id = str(ObjectId())
        total_amount = 0.0
        individual_orders = []
        skipped = []

        for bulk_item in data.orders:
            target_user = await db.users.find_one({"email": bulk_item.user_email.lower()})
            if not target_user:
                skipped.append({"email": bulk_item.user_email, "reason": "user_not_found"})
                continue

            validated_items = []
            order_total = 0.0
            invalid_item_ids = []
            for item in bulk_item.items:
                try:
                    menu_obj_id = ObjectId(item.menu_item_id)
                except Exception:
                    invalid_item_ids.append(item.menu_item_id)
                    continue
                menu_item = await db.menu_items.find_one({"_id": menu_obj_id})
                if not menu_item or not menu_item.get("is_available", False):
                    invalid_item_ids.append(item.menu_item_id)
                    continue
                actual_price = menu_item["price"]
                validated_items.append({
                    "menu_item_id": item.menu_item_id,
                    "name": menu_item["name"],
                    "quantity": item.quantity,
                    "price": actual_price
                })
                order_total += actual_price * item.quantity

            if not validated_items:
                skipped.append({"email": bulk_item.user_email, "reason": "no_valid_items", "invalid_item_ids": invalid_item_ids})
                continue

            order_doc = {
                "user_id": str(target_user["_id"]),
                "employee_name": target_user.get("name") or target_user.get("email"),
                "employee_email": target_user.get("email"),
                "vendor_id": data.vendor_id,
                "site_id": target_user.get("site_id"),
                "company_id": target_user.get("company_id"),
                "items": validated_items,
                "total_amount": order_total,
                "status": "pending",
                "payment_status": "paid" if data.sponsored else "pending",
                "delivery_type": data.delivery_type,
                "bulk_order_id": bulk_order_id,
                "sponsored": data.sponsored,
                "sponsored_by": user["id"] if data.sponsored else None,
                "occasion": data.occasion,
                "created_at": datetime.now(timezone.utc)
            }
            result = await db.orders.insert_one(order_doc)
            order_id = str(result.inserted_id)
            qr_code = generate_pickup_qr(order_id)
            await db.orders.update_one({"_id": result.inserted_id}, {"$set": {"pickup_qr": qr_code, "status": "confirmed" if data.sponsored else "pending"}})

            await create_notification(
                str(target_user["_id"]),
                f"New {'Sponsored ' if data.sponsored else ''}Order",
                f"You have a new order{' (sponsored by company)' if data.sponsored else ''}{' - ' + data.occasion if data.occasion else ''}",
                "order"
            )

            total_amount += order_total
            individual_orders.append({"order_id": order_id, "user_email": bulk_item.user_email, "amount": order_total})

        await db.bulk_orders.insert_one({
            "_id": ObjectId(bulk_order_id),
            "created_by": user["id"],
            "vendor_id": data.vendor_id,
            "total_amount": total_amount,
            "order_count": len(individual_orders),
            "sponsored": data.sponsored,
            "occasion": data.occasion,
            "created_at": datetime.now(timezone.utc)
        })

        return {"bulk_order_id": bulk_order_id, "total_amount": total_amount, "orders": individual_orders, "skipped": skipped}

    # ─── Razorpay payment-first flow ────────────────────────────────────
    @r.post("/payments/razorpay/checkout-intent")
    async def razorpay_checkout_intent(data: RazorpayCheckoutIntent, user: dict = Depends(get_current_user)):
        """PAYMENT-FIRST FLOW — Step 1.

        Employee submits cart → we validate prices, compute the total server-side,
        and create a Razorpay order + payment_intent. NO Cravitoo order is created
        yet — that happens on /verify (or the webhook) after the signature is valid.

        Returns everything the client needs to open Razorpay Checkout.
        """
        if user["role"] != "employee":
            raise HTTPException(status_code=403, detail="Only employees can pay")

        validated_items, total_amount = await _validate_cart(data.items)
        if total_amount <= 0:
            raise HTTPException(status_code=400, detail="Cart total must be greater than zero")

        amount_paise = int(round(total_amount * 100))
        intent_id = secrets.token_hex(12)

        if RAZORPAY_MOCK_MODE:
            razorpay_order_id = f"order_mock_{intent_id}"
        else:
            client_rzp = get_razorpay_client()
            razor_order = client_rzp.order.create({
                "amount": amount_paise,
                "currency": "INR",
                "payment_capture": 1,
                "receipt": intent_id,
                "notes": {
                    "cravitoo_user_id": user["id"],
                    "cravitoo_vendor_id": data.vendor_id,
                    "cravitoo_intent_id": intent_id,
                },
            })
            razorpay_order_id = razor_order["id"]

        await db.payment_intents.insert_one({
            "intent_id": intent_id,
            "razorpay_order_id": razorpay_order_id,
            "user_id": user["id"],
            "user_email": user.get("email"),
            "user_name": user.get("name"),
            "vendor_id": data.vendor_id,
            "items": validated_items,
            "delivery_type": data.delivery_type,
            "special_instructions": data.special_instructions,
            "amount": amount_paise,
            "currency": "INR",
            "total_amount": total_amount,
            "status": "created",
            "cravitoo_order_id": None,
            "mock_mode": RAZORPAY_MOCK_MODE,
            "created_at": datetime.now(timezone.utc),
        })

        return {
            "razorpay_order_id": razorpay_order_id,
            "amount": amount_paise,
            "currency": "INR",
            "key_id": os.environ.get('RAZORPAY_KEY_ID', ''),
            "mock_mode": RAZORPAY_MOCK_MODE,
            "intent_id": intent_id,
            "total_amount": total_amount,
        }

    # Legacy alias — old clients may still POST to /payments/razorpay/create-order
    # with a Cravitoo order_id. Reject clearly so they upgrade to the new flow.
    @r.post("/payments/razorpay/create-order")
    async def razorpay_create_order_deprecated(data: RazorpayOrderCreate, user: dict = Depends(get_current_user)):
        raise HTTPException(
            status_code=410,
            detail="Deprecated — use POST /payments/razorpay/checkout-intent with the cart. Order creation happens on /verify after successful payment.",
        )

    @r.post("/payments/razorpay/verify")
    async def razorpay_verify(data: RazorpayVerify, user: dict = Depends(get_current_user)):
        """PAYMENT-FIRST FLOW — Step 3.
        Frontend calls this immediately after the Razorpay Checkout callback.
        We verify the HMAC signature, then idempotently materialise the Cravitoo
        order. If /verify races the webhook, both return the same order_id.
        """
        intent = await db.payment_intents.find_one({
            "razorpay_order_id": data.razorpay_order_id,
            "user_id": user["id"],
        })
        if not intent:
            raise HTTPException(status_code=404, detail="Payment session not found")

        if not RAZORPAY_MOCK_MODE:
            # Verify HMAC signature
            body = f"{data.razorpay_order_id}|{data.razorpay_payment_id}"
            expected_signature = hmac.new(
                os.environ['RAZORPAY_KEY_SECRET'].encode(),
                body.encode(),
                hashlib.sha256,
            ).hexdigest()
            if not hmac.compare_digest(expected_signature, data.razorpay_signature):
                raise HTTPException(status_code=400, detail="Invalid payment signature")

        order = await _finalize_payment_intent(
            intent=intent,
            razorpay_payment_id=data.razorpay_payment_id,
            source="verify",
        )
        if not order:
            # Should not happen in practice — either race resolved to another intent, or user missing
            raise HTTPException(status_code=500, detail="Could not finalise order")

        return {
            "verified": True,
            "order_id": str(order["_id"]),
            "collection_code": order.get("collection_code"),
            "total_amount": order.get("total_amount"),
            "payment_status": "paid",
            "status": order.get("status"),
            "pickup_qr": order.get("pickup_qr"),
        }

    @r.post("/payments/razorpay/webhook")
    async def razorpay_webhook(request: Request):
        """Async confirmation hook from Razorpay servers.
        Idempotent — safe to call multiple times. Configure in Razorpay Dashboard
        → Settings → Webhooks: URL = {PUBLIC_BACKEND_URL}/api/payments/razorpay/webhook
        Events to subscribe: payment.captured, payment.failed, order.paid"""
        raw_body = await request.body()
        # Header lookup is case-insensitive via Starlette, but be defensive.
        signature = (
            request.headers.get('X-Razorpay-Signature')
            or request.headers.get('x-razorpay-signature')
            or ''
        ).strip()
        webhook_secret = os.environ.get('RAZORPAY_WEBHOOK_SECRET', '').strip()

        # Verify signature (only enforced when a webhook secret is configured).
        # We compute the HMAC ourselves rather than relying on the razorpay SDK —
        # the SDK's `verify_webhook_signature` occasionally raises on bytes vs str
        # encoding, and doing it manually gives us clean diagnostics.
        if webhook_secret:
            if not signature:
                logger.warning(
                    "Razorpay webhook: missing X-Razorpay-Signature header "
                    f"(body_len={len(raw_body)}, secret_configured=True)"
                )
                raise HTTPException(status_code=400, detail="Missing signature header")
            expected = hmac.new(
                webhook_secret.encode('utf-8'),
                raw_body,
                hashlib.sha256,
            ).hexdigest()
            if not hmac.compare_digest(expected, signature):
                # Log first/last 6 chars of both sigs to spot secret mismatches
                # in production without leaking the full secret to logs.
                logger.warning(
                    "Razorpay webhook signature mismatch — "
                    f"expected={expected[:6]}...{expected[-6:]} "
                    f"got={signature[:6]}...{signature[-6:]} "
                    f"body_len={len(raw_body)} "
                    f"secret_len={len(webhook_secret)}. "
                    "Most common cause: RAZORPAY_WEBHOOK_SECRET on this environment "
                    "does not match what is configured in Razorpay Dashboard → Webhooks."
                )
                raise HTTPException(status_code=400, detail="Invalid webhook signature")
        else:
            logger.warning("RAZORPAY_WEBHOOK_SECRET not configured — accepting webhook without signature check (test mode only)")

        try:
            payload = json.loads(raw_body)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON payload")

        event = payload.get("event", "")
        pay_entity = ((payload.get("payload") or {}).get("payment") or {}).get("entity") or {}
        rzp_order_id = pay_entity.get("order_id")
        rzp_payment_id = pay_entity.get("id")

        if not rzp_order_id:
            # Payments that arrive without an order_id are NOT from the Cravitoo
            # checkout flow — our /checkout-intent always calls Razorpay Orders API.
            # These come from other Razorpay products the merchant may have enabled:
            #   • Static Payment QR / QRv2  (description contains 'QR' or 'QRv2')
            #   • Payment Links / Payment Pages
            #   • Payment Button widgets
            # We log with enough detail for merchant-side triage and return 200 so
            # Razorpay doesn't disable the webhook.
            logger.warning(
                "Razorpay webhook — payment without order_id. "
                f"NOT from Cravitoo checkout (that flow always uses Orders API). "
                f"payment_id={rzp_payment_id} amount={pay_entity.get('amount')} "
                f"method={pay_entity.get('method')} description='{pay_entity.get('description')}' "
                f"vpa={pay_entity.get('vpa')} event={event}. "
                "Likely source: Razorpay Static QR / Payment Link / Payment Button. "
                "If unintended, disable it in Razorpay Dashboard → Payment Products."
            )
            return {
                "ok": True,
                "ignored": "payment_without_order_id",
                "note": "This payment did not originate from the Cravitoo Standard Checkout flow (which always creates a Razorpay Order via the Orders API). It came from Razorpay Static QR, Payment Link, or Payment Button. Cravitoo cannot reconcile it because there is no corresponding cart intent.",
                "payment_id": rzp_payment_id,
                "source_hint": pay_entity.get("description"),
            }

        # New payment-first flow: look up the payment_intent
        intent = await db.payment_intents.find_one({"razorpay_order_id": rzp_order_id})
        if not intent:
            # Legacy fallback: some old orders may still exist in payment_transactions
            tx = await db.payment_transactions.find_one({"razorpay_order_id": rzp_order_id})
            if not tx:
                logger.warning(f"Razorpay webhook for unknown order_id={rzp_order_id} event={event}")
                return {"ok": True, "ignored": "unknown_order"}
            # Legacy path: just mark the pre-existing order as paid
            if event in ("payment.captured", "order.paid") and tx.get("payment_status") != "paid":
                await db.payment_transactions.update_one(
                    {"_id": tx["_id"]},
                    {"$set": {
                        "payment_status": "paid",
                        "razorpay_payment_id": rzp_payment_id,
                        "paid_at": datetime.now(timezone.utc),
                        "confirmed_via": "webhook_legacy",
                    }},
                )
                cid = tx.get("order_id")
                if cid:
                    await db.orders.update_one(
                        {"_id": safe_objectid(cid, "Order")},
                        {"$set": {"payment_status": "paid", "status": "confirmed"}},
                    )
            return {"ok": True, "legacy": True}

        if event in ("payment.captured", "order.paid"):
            order = await _finalize_payment_intent(intent=intent, razorpay_payment_id=rzp_payment_id, source="webhook")
            return {
                "ok": True,
                "marked_paid": True,
                "order_id": str(order["_id"]) if order else None,
            }

        if event == "payment.failed":
            await db.payment_intents.update_one(
                {"_id": intent["_id"]},
                {"$set": {
                    "status": "failed",
                    "razorpay_payment_id": rzp_payment_id,
                    "failed_at": datetime.now(timezone.utc),
                    "error_description": pay_entity.get("error_description"),
                }},
            )
            return {"ok": True, "marked_failed": True}

        return {"ok": True, "ignored_event": event}

    # ─── Order cancellation & refund ────────────────────────────────────
    @r.post("/orders/{order_id}/cancel")
    async def cancel_order(order_id: str, user: dict = Depends(get_current_user)):
        """Customer cancels their own order — only within CANCEL_WINDOW_SECONDS and before vendor confirms."""
        order = await db.orders.find_one({"_id": safe_objectid(order_id, "Order")})
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if user["role"] != "employee" or order.get("user_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only cancel your own orders")
        if order.get("status") == "cancelled":
            raise HTTPException(status_code=400, detail="Order is already cancelled")
        if order.get("status") not in ("pending",):
            raise HTTPException(status_code=400, detail=f"Cannot cancel order with status '{order.get('status')}' — vendor has already started preparing it")

        created_at = order.get("created_at")
        if isinstance(created_at, datetime):
            # MongoDB returns naive datetimes — assume UTC
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            elapsed = (datetime.now(timezone.utc) - created_at).total_seconds()
            if elapsed > CANCEL_WINDOW_SECONDS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cancellation window of {CANCEL_WINDOW_SECONDS // 60} minutes has passed",
                )

        # If paid → mark for refund (mock-mode auto-refund; real-mode would call Razorpay refund API)
        refund_status = None
        if order.get("payment_status") == "paid":
            if RAZORPAY_MOCK_MODE:
                refund_status = "refunded_mock"
            else:
                try:
                    tx = await db.payment_transactions.find_one({"cravitoo_order_id": order_id})
                    pay_id = tx and tx.get("razorpay_payment_id")
                    if pay_id:
                        client_rp = get_razorpay_client()
                        client_rp.payment.refund(pay_id, {"amount": int(order["total_amount"] * 100)})
                        refund_status = "refunded"
                    else:
                        refund_status = "refund_pending"
                except Exception as e:
                    logger.error(f"Razorpay refund failed for order {order_id}: {e}")
                    refund_status = "refund_failed"

        await db.orders.update_one(
            {"_id": safe_objectid(order_id, "Order")},
            {"$set": {
                "status": "cancelled",
                "status_updated_at": datetime.now(timezone.utc),
                "cancelled_at": datetime.now(timezone.utc),
                "cancelled_by": "customer",
                **({"refund_status": refund_status} if refund_status else {}),
            }}
        )

        # Order-status audit trail (mirrors order_lifecycle.apply_transition)
        await db.order_status_history.insert_one({
            "order_id": order_id,
            "from_status": order.get("status") or "pending",
            "to_status": "cancelled",
            "actor_id": user.get("id"),
            "actor_email": user.get("email"),
            "actor_role": user.get("role"),
            "created_at": datetime.now(timezone.utc),
            "details": {"cancelled_by": "customer", "refund_status": refund_status},
        })

        # Notify vendor
        vendor_users = await db.users.find({"vendor_id": order["vendor_id"], "role": "vendor"}).to_list(10)
        for vu in vendor_users:
            await create_notification(
                str(vu["_id"]),
                "Order Cancelled",
                f"Customer cancelled order #{order_id[-8:]}",
                "order"
            )
        await manager.send_to_vendor(order["vendor_id"], {
            "type": "order_update",
            "order_id": order_id,
            "status": "cancelled",
        })
        await manager.send_to_user(user["id"], {
            "type": "order_update",
            "order_id": order_id,
            "status": "cancelled",
        })

        return {"message": "Order cancelled", "refund_status": refund_status}

    @r.post("/orders/{order_id}/refund")
    async def refund_order(order_id: str, user: dict = Depends(get_current_user)):
        """Vendor or master_admin issues a refund (e.g. customer no-show, food unavailable)."""
        if user["role"] not in ("vendor", "master_admin"):
            raise HTTPException(status_code=403, detail="Only vendors or master admin can issue refunds")
        order = await db.orders.find_one({"_id": safe_objectid(order_id, "Order")})
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if user["role"] == "vendor" and order.get("vendor_id") != user.get("vendor_id"):
            raise HTTPException(status_code=403, detail="Not your order")
        if order.get("payment_status") != "paid":
            raise HTTPException(status_code=400, detail="Order is not paid — nothing to refund")
        if order.get("refund_status") in ("refunded", "refunded_mock", "refund_pending"):
            raise HTTPException(status_code=400, detail="Order already refunded or refund in progress")

        refund_status = "refunded_mock"
        if not RAZORPAY_MOCK_MODE:
            try:
                tx = await db.payment_transactions.find_one({"cravitoo_order_id": order_id})
                pay_id = tx and tx.get("razorpay_payment_id")
                if pay_id:
                    client_rp = get_razorpay_client()
                    client_rp.payment.refund(pay_id, {"amount": int(order["total_amount"] * 100)})
                    refund_status = "refunded"
                else:
                    refund_status = "refund_pending"
            except Exception as e:
                logger.error(f"Razorpay refund failed for order {order_id}: {e}")
                raise HTTPException(status_code=500, detail="Refund failed at gateway")

        await db.orders.update_one(
            {"_id": safe_objectid(order_id, "Order")},
            {"$set": {
                "status": "cancelled",
                "refund_status": refund_status,
                "refunded_at": datetime.now(timezone.utc),
                "cancelled_by": user["role"],
            }}
        )

        await create_notification(
            order["user_id"],
            "Order Refunded",
            f"Your order #{order_id[-8:]} has been refunded (₹{order['total_amount']:.2f})",
            "order"
        )
        await manager.send_to_user(order["user_id"], {
            "type": "order_update",
            "order_id": order_id,
            "status": "cancelled",
            "refund_status": refund_status,
        })

        return {"message": "Refund issued", "refund_status": refund_status, "amount": order["total_amount"]}

    @r.get("/orders/last")
    async def get_last_order(user: dict = Depends(get_current_user)):
        """Returns the employee's most recent order to enable 'reorder my usual'."""
        if user["role"] != "employee":
            raise HTTPException(status_code=403, detail="Only employees")
        order = await db.orders.find_one(
            {"user_id": user["id"], "status": {"$in": ["completed", "ready", "confirmed", "preparing"]}},
            sort=[("created_at", -1)]
        )
        if not order:
            raise HTTPException(status_code=404, detail="No previous orders to reorder")
        return {
            "vendor_id": order.get("vendor_id"),
            "items": order.get("items", []),
            "total_amount": order.get("total_amount"),
        }

    # Expose internal helpers for regression tests (race/concurrency script).
    r._validate_cart = _validate_cart
    r._materialize_order = _materialize_order
    r._finalize_payment_intent = _finalize_payment_intent

    return r
