"""
Vendor → Cravitoo Menu Change Request routes (iter14).

Vendors are read-only on menus (iter10 lock-down). They submit change requests
that Master Admin (and optionally Site Admin for "remove"+"edit_description")
review and approve. On approval, the menu is auto-updated.

Endpoints:
  POST   /api/menu-change-requests
  GET    /api/menu-change-requests
  GET    /api/menu-change-requests/{id}
  POST   /api/menu-change-requests/{id}/decision
  DELETE /api/menu-change-requests/{id}

Built as a make_router(...) factory to avoid circular imports.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class MenuChangeRequestCreate(BaseModel):
    request_type: str  # "add" | "edit" | "remove"
    item_id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    price: Optional[float] = None
    image_url: Optional[str] = None
    is_vegetarian: Optional[bool] = None
    reason: Optional[str] = None


class MenuChangeDecision(BaseModel):
    decision: str  # "approve" | "reject"
    remarks: Optional[str] = None
    auto_apply: bool = True


def _request_can_auto_route_to_site_admin(request_type: str, has_price_change: bool) -> bool:
    """Site Admin can approve 'remove' + 'edit_description'-only.
    Master Admin owns: 'add', any price change, any vegetarian-flag change."""
    if request_type == "remove":
        return True
    if request_type == "edit" and not has_price_change:
        return True
    return False


def make_router(db, safe_objectid, get_current_user, create_notification, UPLOAD_DIR: Optional[Path] = None):
    r = APIRouter()

    @r.post("/menu-change-requests/{request_id}/upload-photo")
    async def upload_request_photo(
        request_id: str,
        file: UploadFile = File(...),
        user: dict = Depends(get_current_user),
    ):
        """Vendor attaches a photo to their menu-change request (e.g. proposed dish photo).
        Stored in UPLOAD_DIR with `mcr_` prefix; URL set on the request's `image_url` field."""
        if UPLOAD_DIR is None:
            raise HTTPException(status_code=500, detail="Upload storage is not configured.")
        req = await db.menu_change_requests.find_one({"_id": safe_objectid(request_id, "Menu request")})
        if not req:
            raise HTTPException(status_code=404, detail="Menu change request not found")

        # Permission: the requesting vendor OR a Cravitoo admin can attach a photo
        is_owner = user.get("role") == "vendor" and req.get("vendor_id") == user.get("vendor_id")
        is_admin = user.get("role") in ("master_admin", "site_admin", "city_admin")
        if not (is_owner or is_admin):
            raise HTTPException(status_code=403, detail="Not your request")

        if req.get("status") not in ("pending", None):
            raise HTTPException(status_code=400, detail=f"Cannot attach photo — request status is '{req.get('status')}'")

        # File validation
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename")
        ext = file.filename.rsplit(".", 1)[-1].lower()[:5]
        if ext not in ("png", "jpg", "jpeg", "webp"):
            raise HTTPException(status_code=400, detail="Allowed: PNG, JPG, JPEG, WEBP")
        content = await file.read()
        if len(content) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File must be under 5 MB")

        fname = f"mcr_{uuid.uuid4().hex}.{ext}"
        fpath = UPLOAD_DIR / fname
        try:
            with open(fpath, "wb") as f:
                f.write(content)
        except Exception as e:
            logger.error(f"Failed to save menu-request photo {fname}: {e}")
            raise HTTPException(status_code=500, detail="Could not save uploaded photo")

        base = os.environ.get("PUBLIC_BACKEND_URL", "").rstrip("/")
        url = f"{base}/api/uploads/{fname}" if base else f"/api/uploads/{fname}"

        await db.menu_change_requests.update_one(
            {"_id": req["_id"]},
            {"$set": {
                "image_url": url,
                "image_filename": fname,
                "image_uploaded_at": datetime.now(timezone.utc),
                "image_uploaded_by": user["email"],
            }},
        )
        return {"image_url": url, "filename": fname, "size": len(content)}

    @r.post("/menu-change-requests")
    async def create_menu_change_request(data: MenuChangeRequestCreate, user: dict = Depends(get_current_user)):
        if user["role"] != "vendor":
            raise HTTPException(status_code=403, detail="Only vendors can submit menu change requests")

        vendor_id = user.get("vendor_id")
        if not vendor_id:
            raise HTTPException(status_code=400, detail="No vendor record linked to this account")

        rt = data.request_type.lower()
        if rt not in ("add", "edit", "remove"):
            raise HTTPException(status_code=400, detail="request_type must be 'add', 'edit', or 'remove'")

        if rt == "add":
            if not all([data.name, data.description, data.category, data.price is not None]):
                raise HTTPException(status_code=400, detail="Add request requires name, description, category, price")
        elif rt == "edit":
            if not data.item_id:
                raise HTTPException(status_code=400, detail="Edit request requires item_id")
            change_fields = [data.name, data.description, data.price, data.image_url, data.is_vegetarian]
            if all(v is None for v in change_fields):
                raise HTTPException(status_code=400, detail="At least one field must be provided for edit")
        elif rt == "remove":
            if not data.item_id:
                raise HTTPException(status_code=400, detail="Remove request requires item_id")

        existing_item = None
        if data.item_id:
            existing_item = await db.menu_items.find_one({"_id": safe_objectid(data.item_id, "Menu item")})
            if not existing_item:
                raise HTTPException(status_code=404, detail="Menu item not found")
            if str(existing_item.get("vendor_id")) != str(vendor_id):
                raise HTTPException(status_code=403, detail="You can only request changes to your own menu")

        has_price_change = data.price is not None and (
            rt == "add" or (existing_item and abs(float(existing_item.get("price", 0)) - float(data.price)) > 0.001)
        )
        can_site_approve = _request_can_auto_route_to_site_admin(rt, has_price_change)

        existing_snapshot = None
        if existing_item:
            existing_snapshot = {
                "name": existing_item.get("name"),
                "description": existing_item.get("description"),
                "category": existing_item.get("category"),
                "price": existing_item.get("price"),
                "image_url": existing_item.get("image_url"),
                "is_vegetarian": existing_item.get("is_vegetarian"),
            }

        now = datetime.now(timezone.utc)
        request_doc = {
            "vendor_id": vendor_id,
            "submitted_by": user["id"],
            "submitted_by_email": user["email"],
            "request_type": rt,
            "item_id": data.item_id,
            "existing_snapshot": existing_snapshot,
            "proposed": {
                "name": data.name,
                "description": data.description,
                "category": data.category,
                "price": data.price,
                "image_url": data.image_url,
                "is_vegetarian": data.is_vegetarian,
            },
            "reason": data.reason,
            "has_price_change": has_price_change,
            "can_site_approve": can_site_approve,
            "status": "pending",
            "audit_trail": [{
                "event": "submitted",
                "by": user["id"],
                "by_email": user["email"],
                "at": now,
            }],
            "created_at": now,
        }
        result = await db.menu_change_requests.insert_one(request_doc)
        req_id = str(result.inserted_id)

        vendor_doc = await db.vendors.find_one({"_id": safe_objectid(vendor_id, "Vendor")})
        vendor_name = (vendor_doc or {}).get("name", "Vendor")

        target_roles = ["master_admin"]
        if can_site_approve:
            target_roles.append("site_admin")

        admin_users = await db.users.find({"role": {"$in": target_roles}}).to_list(500)
        for admin in admin_users:
            await create_notification(
                user_id=str(admin["_id"]),
                title=f"New menu request from {vendor_name}",
                message=f"{rt.capitalize()} request — review in admin dashboard.",
                notif_type="menu_request",
                push_data={"screen": "MenuChangeRequests", "request_id": req_id},
            )

        return {"id": req_id, "status": "pending", "can_site_approve": can_site_approve}

    @r.get("/menu-change-requests")
    async def list_menu_change_requests(
        status: Optional[str] = Query(None),
        user: dict = Depends(get_current_user),
    ):
        role = user["role"]
        query: Dict[str, Any] = {}
        if status and status != "all":
            query["status"] = status

        if role == "vendor":
            vendor_id = user.get("vendor_id")
            if not vendor_id:
                return []
            query["vendor_id"] = vendor_id
        elif role == "site_admin":
            site_id = user.get("site_id")
            if not site_id:
                return []
            mappings = await db.vendor_site_mappings.find({"site_id": site_id}).to_list(500)
            vendor_ids = [m["vendor_id"] for m in mappings]
            query["vendor_id"] = {"$in": vendor_ids}
            query["can_site_approve"] = True
        elif role in ("master_admin", "super_admin"):
            pass
        else:
            raise HTTPException(status_code=403, detail="Not authorised")

        docs = await db.menu_change_requests.find(query).sort("created_at", -1).to_list(500)

        vendor_id_strs = list({d.get("vendor_id") for d in docs if d.get("vendor_id")})
        vendor_id_objs = []
        for vid in vendor_id_strs:
            try:
                vendor_id_objs.append(safe_objectid(vid, "Vendor"))
            except Exception:
                continue
        vendor_name_cache: Dict[str, str] = {}
        if vendor_id_objs:
            vendors_cursor = db.vendors.find({"_id": {"$in": vendor_id_objs}}, {"_id": 1, "name": 1})
            async for vdoc in vendors_cursor:
                vendor_name_cache[str(vdoc["_id"])] = vdoc.get("name", "Unknown Vendor")

        out = []
        for d in docs:
            vid = d.get("vendor_id")
            vname = vendor_name_cache.get(vid, "Unknown Vendor")
            d["id"] = str(d.pop("_id"))
            d["vendor_name"] = vname
            for k in ("created_at",):
                if isinstance(d.get(k), datetime):
                    d[k] = d[k].isoformat()
            for entry in d.get("audit_trail", []):
                if isinstance(entry.get("at"), datetime):
                    entry["at"] = entry["at"].isoformat()
            out.append(d)
        return out

    @r.get("/menu-change-requests/{request_id}")
    async def get_menu_change_request(request_id: str, user: dict = Depends(get_current_user)):
        doc = await db.menu_change_requests.find_one({"_id": safe_objectid(request_id, "Menu change request")})
        if not doc:
            raise HTTPException(status_code=404, detail="Request not found")

        role = user["role"]
        if role == "vendor" and doc.get("vendor_id") != user.get("vendor_id"):
            raise HTTPException(status_code=403, detail="Not authorised")
        if role == "site_admin" and not doc.get("can_site_approve"):
            raise HTTPException(status_code=403, detail="This request requires Master Admin approval")

        def _iso(v):
            return v.isoformat() if isinstance(v, datetime) else v

        # Build a JSON-safe dict explicitly (no raw ObjectId / datetime leakage)
        vendor_name = "Unknown Vendor"
        try:
            vdoc = await db.vendors.find_one({"_id": safe_objectid(doc.get("vendor_id"), "Vendor")})
            vendor_name = (vdoc or {}).get("name", "Unknown Vendor")
        except Exception:
            pass

        audit_trail = []
        for entry in doc.get("audit_trail", []) or []:
            audit_trail.append({**{k: v for k, v in entry.items() if k != "at"}, "at": _iso(entry.get("at"))})

        result: Dict[str, Any] = {
            "id": str(doc["_id"]),
            "vendor_id": doc.get("vendor_id"),
            "vendor_name": vendor_name,
            "submitted_by": doc.get("submitted_by"),
            "submitted_by_email": doc.get("submitted_by_email"),
            "request_type": doc.get("request_type"),
            "item_id": doc.get("item_id"),
            "existing_snapshot": doc.get("existing_snapshot"),
            "proposed": doc.get("proposed"),
            "reason": doc.get("reason"),
            "has_price_change": doc.get("has_price_change"),
            "can_site_approve": doc.get("can_site_approve"),
            "status": doc.get("status"),
            "audit_trail": audit_trail,
            "applied": doc.get("applied"),
            "applied_item_id": doc.get("applied_item_id"),
            "image_url": doc.get("image_url"),
            "image_filename": doc.get("image_filename"),
            "decided_by": doc.get("decided_by"),
            "decided_by_role": doc.get("decided_by_role"),
            "created_at": _iso(doc.get("created_at")),
            "decided_at": _iso(doc.get("decided_at")),
            "cancelled_at": _iso(doc.get("cancelled_at")),
        }
        return result

    @r.post("/menu-change-requests/{request_id}/decision")
    async def decide_menu_change_request(
        request_id: str,
        decision: MenuChangeDecision,
        user: dict = Depends(get_current_user),
    ):
        role = user["role"]
        if role not in ("master_admin", "site_admin"):
            raise HTTPException(status_code=403, detail="Only Master or Site Admin can decide")

        doc = await db.menu_change_requests.find_one({"_id": safe_objectid(request_id, "Menu change request")})
        if not doc:
            raise HTTPException(status_code=404, detail="Request not found")
        if doc.get("status") != "pending":
            raise HTTPException(status_code=400, detail=f"Request already {doc['status']}")
        if role == "site_admin" and not doc.get("can_site_approve"):
            raise HTTPException(
                status_code=403,
                detail="This request requires Master Admin approval (price changes / new items)",
            )

        decision_value = decision.decision.lower()
        if decision_value not in ("approve", "reject"):
            raise HTTPException(status_code=400, detail="decision must be 'approve' or 'reject'")

        now = datetime.now(timezone.utc)
        rt = doc["request_type"]
        vendor_id = doc["vendor_id"]

        if decision_value == "reject":
            await db.menu_change_requests.update_one(
                {"_id": doc["_id"]},
                {
                    "$set": {"status": "rejected", "decided_at": now, "decided_by": user["id"], "decided_by_role": role},
                    "$push": {"audit_trail": {"event": "rejected", "by": user["id"], "by_email": user["email"], "at": now, "remarks": decision.remarks}},
                },
            )
        else:
            applied = False
            applied_item_id = None
            if decision.auto_apply:
                proposed = doc.get("proposed", {}) or {}
                # Prefer the uploaded photo (root `image_url`) over the URL the vendor pasted
                effective_image_url = doc.get("image_url") or proposed.get("image_url")
                if rt == "add":
                    new_doc = {
                        "vendor_id": vendor_id,
                        "name": proposed.get("name"),
                        "description": proposed.get("description"),
                        "category": proposed.get("category"),
                        "price": float(proposed.get("price") or 0),
                        "image_url": effective_image_url,
                        "is_vegetarian": bool(proposed.get("is_vegetarian", False)),
                        "is_available": True,
                        "created_at": now,
                        "created_via": "menu_change_request",
                        "menu_change_request_id": str(doc["_id"]),
                    }
                    ins = await db.menu_items.insert_one(new_doc)
                    applied_item_id = str(ins.inserted_id)
                    applied = True
                elif rt == "edit":
                    set_fields = {}
                    for k in ("name", "description", "category", "price", "is_vegetarian"):
                        if proposed.get(k) is not None:
                            set_fields[k] = proposed[k]
                    if effective_image_url:
                        set_fields["image_url"] = effective_image_url
                    if set_fields:
                        await db.menu_items.update_one(
                            {"_id": safe_objectid(doc["item_id"], "Menu item")},
                            {"$set": set_fields},
                        )
                        applied_item_id = doc["item_id"]
                        applied = True
                elif rt == "remove":
                    await db.menu_items.delete_one({"_id": safe_objectid(doc["item_id"], "Menu item")})
                    applied_item_id = doc["item_id"]
                    applied = True

            await db.menu_change_requests.update_one(
                {"_id": doc["_id"]},
                {
                    "$set": {
                        "status": "approved",
                        "decided_at": now,
                        "decided_by": user["id"],
                        "decided_by_role": role,
                        "applied": applied,
                        "applied_item_id": applied_item_id,
                    },
                    "$push": {"audit_trail": {"event": "approved", "by": user["id"], "by_email": user["email"], "at": now, "remarks": decision.remarks, "applied": applied}},
                },
            )

        submitted_by = doc.get("submitted_by")
        if submitted_by:
            vendor_doc = await db.vendors.find_one({"_id": safe_objectid(vendor_id, "Vendor")})
            vname = (vendor_doc or {}).get("name", "your")
            verb = "approved" if decision_value == "approve" else "rejected"
            await create_notification(
                user_id=submitted_by,
                title=f"Menu request {verb}",
                message=f"Your {rt} request for {vname} has been {verb} by Cravitoo." + (f" Note: {decision.remarks}" if decision.remarks else ""),
                notif_type="menu_request_decision",
                push_data={"screen": "MenuChangeRequests", "request_id": str(doc["_id"])},
            )

        return {"ok": True, "status": "approved" if decision_value == "approve" else "rejected"}

    @r.delete("/menu-change-requests/{request_id}")
    async def cancel_menu_change_request(request_id: str, user: dict = Depends(get_current_user)):
        doc = await db.menu_change_requests.find_one({"_id": safe_objectid(request_id, "Menu change request")})
        if not doc:
            raise HTTPException(status_code=404, detail="Request not found")
        if user["role"] != "vendor" or doc.get("vendor_id") != user.get("vendor_id"):
            raise HTTPException(status_code=403, detail="Only the submitting vendor can cancel")
        if doc["status"] != "pending":
            raise HTTPException(status_code=400, detail="Only pending requests can be cancelled")
        now = datetime.now(timezone.utc)
        await db.menu_change_requests.update_one(
            {"_id": doc["_id"]},
            {
                "$set": {"status": "cancelled", "cancelled_at": now},
                "$push": {"audit_trail": {"event": "cancelled_by_vendor", "by": user["id"], "by_email": user["email"], "at": now}},
            },
        )
        return {"ok": True}

    return r
