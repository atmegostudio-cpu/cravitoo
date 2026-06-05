"""
Notification Preferences & Daily Digest (iter19).

Lets users opt in/out of per-event emails (DPDP compliance) and provides
a single daily-digest email instead of per-order emails — reduces Resend
email volume by ~70% at 500+ employee scale.

Endpoints:
  GET   /api/me/notification-preferences      — current user's preferences
  PATCH /api/me/notification-preferences      — update preferences
  POST  /api/admin/digest/send-now            — Master Admin: trigger digest manually
  GET   /api/admin/digest/preview/{user_id}   — Master Admin: preview a user's digest

Built as make_router(...) factory.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import email_service

logger = logging.getLogger(__name__)

# Indian Standard Time (UTC+05:30, no DST)
IST = timezone(timedelta(hours=5, minutes=30))


# Default preferences — chosen to MINIMIZE email volume
# (the daily digest replaces all the per-event emails by default)
DEFAULT_PREFS: Dict[str, bool] = {
    "order_confirm_email": False,         # was implicit-True before; now off to conserve quota
    "reservation_confirm_email": False,   # already off (only push notifications fired)
    "daily_digest_email": True,           # opt-in by default — the new single-email-per-day approach
    "push_notifications": True,           # free, always-on by default
    "marketing_email": False,             # never on by default
}


class PreferencesUpdate(BaseModel):
    order_confirm_email: Optional[bool] = None
    reservation_confirm_email: Optional[bool] = None
    daily_digest_email: Optional[bool] = None
    push_notifications: Optional[bool] = None
    marketing_email: Optional[bool] = None


def _user_prefs(user_doc: Dict[str, Any]) -> Dict[str, bool]:
    """Merge user-stored prefs with defaults so missing keys fall back safely."""
    stored = user_doc.get("notification_preferences") or {}
    return {**DEFAULT_PREFS, **{k: v for k, v in stored.items() if k in DEFAULT_PREFS}}


async def build_daily_digest(db, user_id: str, ist_date) -> Dict[str, Any]:
    """Build the payload for a user's daily-digest email.

    Includes:
      • orders placed today (IST day)
      • reservations made for tomorrow (delivery_date IST = day after `ist_date`)
    """
    # Window: 00:00 IST → 24:00 IST of ist_date, in UTC
    day_start_utc = datetime(ist_date.year, ist_date.month, ist_date.day, 0, 0, tzinfo=IST).astimezone(timezone.utc)
    day_end_utc = day_start_utc + timedelta(days=1)
    tomorrow_ist = ist_date + timedelta(days=1)
    tomorrow_start_utc = datetime(tomorrow_ist.year, tomorrow_ist.month, tomorrow_ist.day, 0, 0, tzinfo=IST).astimezone(timezone.utc)

    # --- Orders placed today ---
    orders_cur = db.orders.find({
        "user_id": user_id,
        "created_at": {"$gte": day_start_utc, "$lt": day_end_utc},
        "status": {"$nin": ["cancelled"]},
    }).sort("created_at", -1).limit(20)
    orders_out: List[Dict[str, Any]] = []
    async for o in orders_cur:
        v = None
        vid = o.get("vendor_id")
        if vid:
            try:
                v = await db.vendors.find_one({"_id": ObjectId(vid) if isinstance(vid, str) else vid})
            except Exception:
                v = None
        orders_out.append({
            "vendor_name": (v.get("name") if v else None) or o.get("vendor_name", "Vendor"),
            "items_count": len(o.get("items", []) or []),
            "amount": o.get("total_amount") or o.get("amount") or 0,
        })

    # --- Reservations for tomorrow ---
    res_cur = db.reservations.find({
        "employee_id": user_id,
        "delivery_date": tomorrow_start_utc,
        "status": {"$in": ["reserved", "consumed"]},
    }).sort("meal_period", 1).limit(8)
    res_out: List[Dict[str, Any]] = []
    async for rec in res_cur:
        v = None
        vid = rec.get("vendor_id")
        if vid:
            try:
                v = await db.vendors.find_one({"_id": ObjectId(vid) if isinstance(vid, str) else vid})
            except Exception:
                v = None
        res_out.append({
            "meal_period": rec.get("meal_period"),
            "vendor_name": (v.get("name") if v else None) or "Vendor",
            "pickup_qr": rec.get("pickup_qr"),
            "delivery_date": tomorrow_ist.isoformat(),
        })

    return {"orders": orders_out, "reservations": res_out}


async def send_daily_digest_to_user(db, user_doc: Dict[str, Any], ist_date) -> Dict[str, Any]:
    """Send (or skip) a daily digest for one user. Returns {sent, reason}."""
    prefs = _user_prefs(user_doc)
    if not prefs["daily_digest_email"]:
        return {"sent": False, "reason": "user opted out"}
    digest = await build_daily_digest(db, str(user_doc["_id"]), ist_date)
    if not digest["orders"] and not digest["reservations"]:
        return {"sent": False, "reason": "no activity"}
    try:
        html, text = email_service.render_daily_digest_email(
            name=user_doc.get("name") or user_doc.get("email", ""),
            date_label=ist_date.strftime("%a, %d %b %Y"),
            orders=digest["orders"],
            reservations=digest["reservations"],
        )
        subj_bits = []
        if digest["orders"]:
            subj_bits.append(f"{len(digest['orders'])} order(s)")
        if digest["reservations"]:
            subj_bits.append(f"{len(digest['reservations'])} pre-order(s)")
        subject = f"Your Cravitoo recap — {', '.join(subj_bits)}"
        ok = email_service.send_email(user_doc["email"], subject, html, text)
        return {"sent": bool(ok), "reason": "ok" if ok else "send failed"}
    except Exception as e:
        logger.warning(f"Digest email failed for {user_doc.get('email')}: {e}")
        return {"sent": False, "reason": str(e)}


async def build_vendor_digest(db, vendor_id: str, ist_date) -> Dict[str, Any]:
    """Build the payload for a vendor's end-of-day sales digest."""
    day_start_utc = datetime(ist_date.year, ist_date.month, ist_date.day, 0, 0, tzinfo=IST).astimezone(timezone.utc)
    day_end_utc = day_start_utc + timedelta(days=1)
    tomorrow_ist = ist_date + timedelta(days=1)
    tomorrow_start_utc = datetime(tomorrow_ist.year, tomorrow_ist.month, tomorrow_ist.day, 0, 0, tzinfo=IST).astimezone(timezone.utc)

    # Orders fulfilled today
    orders_pipe = [
        {"$match": {"vendor_id": vendor_id, "created_at": {"$gte": day_start_utc, "$lt": day_end_utc}, "status": {"$nin": ["cancelled"]}}},
        {"$group": {"_id": None, "orders": {"$sum": 1}, "revenue": {"$sum": "$total_amount"}}},
    ]
    orders, revenue = 0, 0.0
    async for row in db.orders.aggregate(orders_pipe):
        orders = row.get("orders", 0)
        revenue = float(row.get("revenue", 0) or 0)

    # Refunds today
    refunds_pipe = [
        {"$match": {"vendor_id": vendor_id, "refund_at": {"$gte": day_start_utc, "$lt": day_end_utc}}},
        {"$group": {"_id": None, "refunds_count": {"$sum": 1}, "refunds_amount": {"$sum": "$refund_amount"}}},
    ]
    refunds_count, refunds_amount = 0, 0.0
    async for row in db.refunds.aggregate(refunds_pipe):
        refunds_count = row.get("refunds_count", 0)
        refunds_amount = float(row.get("refunds_amount", 0) or 0)

    # Top items today (by quantity)
    top_items_pipe = [
        {"$match": {"vendor_id": vendor_id, "created_at": {"$gte": day_start_utc, "$lt": day_end_utc}, "status": {"$nin": ["cancelled"]}}},
        {"$unwind": "$items"},
        {"$group": {
            "_id": "$items.menu_item_id",
            "name": {"$first": "$items.name"},
            "qty": {"$sum": "$items.quantity"},
            "revenue": {"$sum": {"$multiply": ["$items.price", "$items.quantity"]}},
        }},
        {"$sort": {"qty": -1}},
        {"$limit": 5},
    ]
    top_items: List[Dict[str, Any]] = []
    async for row in db.orders.aggregate(top_items_pipe):
        top_items.append({"name": row.get("name", "Item"), "qty": row.get("qty", 0), "revenue": float(row.get("revenue", 0) or 0)})

    # Pre-orders for tomorrow
    new_reservations = await db.reservations.count_documents({
        "vendor_id": vendor_id,
        "delivery_date": tomorrow_start_utc,
        "status": {"$in": ["reserved", "consumed"]},
    })

    return {
        "metrics": {
            "orders": orders,
            "revenue": revenue,
            "refunds_count": refunds_count,
            "refunds_amount": refunds_amount,
            "new_reservations_for_tomorrow": new_reservations,
        },
        "top_items": top_items,
    }


async def send_vendor_digest_to_user(db, user_doc: Dict[str, Any], ist_date) -> Dict[str, Any]:
    """Send vendor daily sales digest. Each vendor user with role='vendor' linked to a vendor_id."""
    prefs = _user_prefs(user_doc)
    if not prefs["daily_digest_email"]:
        return {"sent": False, "reason": "vendor opted out"}
    vendor_id = user_doc.get("vendor_id")
    if not vendor_id:
        return {"sent": False, "reason": "no vendor_id linked"}
    digest = await build_vendor_digest(db, vendor_id, ist_date)
    metrics = digest["metrics"]
    # Skip vendors with zero activity (no orders AND no reservations for tomorrow)
    if metrics["orders"] == 0 and metrics["new_reservations_for_tomorrow"] == 0:
        return {"sent": False, "reason": "no activity"}
    try:
        html, text = email_service.render_vendor_daily_digest_email(
            name=user_doc.get("name") or user_doc.get("email", ""),
            date_label=ist_date.strftime("%a, %d %b %Y"),
            metrics=metrics,
            top_items=digest["top_items"],
        )
        subject = f"Today's sales — {metrics['orders']} order(s), ₹{metrics['revenue']:,.0f}"
        ok = email_service.send_email(user_doc["email"], subject, html, text)
        return {"sent": bool(ok), "reason": "ok" if ok else "send failed"}
    except Exception as e:
        logger.warning(f"Vendor digest email failed for {user_doc.get('email')}: {e}")
        return {"sent": False, "reason": str(e)}


def make_router(db, safe_objectid, get_current_user):
    r = APIRouter()

    @r.get("/me/notification-preferences")
    async def get_my_prefs(user: dict = Depends(get_current_user)):
        u = await db.users.find_one({"_id": safe_objectid(user["id"], "User")})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        return {"preferences": _user_prefs(u)}

    @r.patch("/me/notification-preferences")
    async def update_my_prefs(data: PreferencesUpdate, user: dict = Depends(get_current_user)):
        updates = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No changes to apply")
        u = await db.users.find_one({"_id": safe_objectid(user["id"], "User")})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        current = _user_prefs(u)
        merged = {**current, **updates}
        await db.users.update_one(
            {"_id": u["_id"]},
            {"$set": {"notification_preferences": merged, "notification_preferences_updated_at": datetime.now(timezone.utc)}},
        )
        return {"preferences": merged}

    @r.post("/admin/digest/send-now")
    async def admin_send_digest_now(user: dict = Depends(get_current_user)):
        """Master Admin: fan out daily digest emails NOW (don't wait for scheduler).
        Sends both employee digests AND vendor sales digests."""
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Master admin only")
        ist_now = datetime.now(IST)
        ist_today = ist_now.date()
        # Employees
        emp_sent, emp_skipped = 0, 0
        cursor = db.users.find({"role": "employee"}, {"_id": 1, "email": 1, "name": 1, "notification_preferences": 1}).limit(2000)
        async for u in cursor:
            res = await send_daily_digest_to_user(db, u, ist_today)
            if res["sent"]:
                emp_sent += 1
            else:
                emp_skipped += 1
        # Vendors
        ven_sent, ven_skipped = 0, 0
        cursor = db.users.find({"role": "vendor"}, {"_id": 1, "email": 1, "name": 1, "vendor_id": 1, "notification_preferences": 1}).limit(500)
        async for u in cursor:
            res = await send_vendor_digest_to_user(db, u, ist_today)
            if res["sent"]:
                ven_sent += 1
            else:
                ven_skipped += 1
        return {
            "employees": {"sent": emp_sent, "skipped": emp_skipped},
            "vendors": {"sent": ven_sent, "skipped": ven_skipped},
            "ist_date": ist_today.isoformat(),
        }

    @r.get("/admin/digest/preview/{user_id}")
    async def admin_preview_digest(user_id: str, user: dict = Depends(get_current_user)):
        """Master Admin: preview what a user's digest would look like (no email sent)."""
        if user.get("role") != "master_admin":
            raise HTTPException(status_code=403, detail="Master admin only")
        u = await db.users.find_one({"_id": safe_objectid(user_id, "User")})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        ist_today = datetime.now(IST).date()
        digest = await build_daily_digest(db, str(u["_id"]), ist_today)
        return {
            "user_email": u.get("email"),
            "user_name": u.get("name"),
            "preferences": _user_prefs(u),
            "ist_date": ist_today.isoformat(),
            **digest,
        }

    return r
