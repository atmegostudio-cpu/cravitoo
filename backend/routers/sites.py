"""
Sites, Vendor-Site mapping, Meal Schedules, Site Menu, Excel upload,
Admin (site/super/master/city_admin) creation/list/delete, Master/Site reports,
and Employee /my-site — extracted from server.py.

Built as a make_router(...) factory to avoid circular imports.
"""

from __future__ import annotations

import io
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import openpyxl
from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from models import (
    MasterAdminCreate,
    MealScheduleUpdate,
    MenuItemSiteUpdate,
    SiteAdminCreate,
    SiteCreate,
    SuperAdminCreate,
    VendorSiteMappingCreate,
)

logger = logging.getLogger(__name__)

MENU_TEMPLATE_HEADERS = ["name", "description", "category", "price",
                         "is_vegetarian", "image_url", "meal_periods", "counter"]


def build_menu_template_xlsx() -> bytes:
    """A ready-to-fill sample .xlsx with the exact columns the importer expects."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Menu"
    ws.append(MENU_TEMPLATE_HEADERS)
    ws.append(["Paneer Butter Masala", "Cottage cheese in rich tomato gravy",
               "Main Course", 180, "yes", "", "lunch,dinner", "Counter 1"])
    ws.append(["Masala Dosa", "Crispy dosa with spiced potato filling",
               "Breakfast", 90, "yes", "", "breakfast", "Counter 2"])
    ws.append(["Chicken Biryani", "Fragrant basmati rice with chicken",
               "Main Course", 220, "no", "", "lunch,dinner", "Counter 1"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def parse_menu_workbook(content: bytes):
    """Parse + validate an uploaded menu workbook. Returns (rows, errors) where
    each row is a normalized dict WITHOUT vendor_id/site_id/created_at (added at
    apply time). Duplicate names within the file are skipped. Never touches DB."""
    workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    sheet = workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    if len(rows) < 2:
        raise HTTPException(status_code=400, detail="Excel must contain a header row and at least one data row")
    headers = [str(h).strip().lower() if h else "" for h in rows[0]]
    required = ["name", "description", "category", "price"]
    missing = [c for c in required if c not in headers]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required columns: {', '.join(missing)}")
    idx = {c: headers.index(c) for c in headers if c}
    name_i = headers.index("name")
    veg_i = headers.index("is_vegetarian") if "is_vegetarian" in headers else None
    img_i = headers.index("image_url") if "image_url" in headers else None
    meal_i = headers.index("meal_periods") if "meal_periods" in headers else None
    counter_i = headers.index("counter") if "counter" in headers else None

    def _truthy(v):
        return str(v).strip().lower() in ("1", "true", "yes", "veg", "y", "vegetarian")

    parsed, errors, seen = [], [], set()
    for i, row in enumerate(rows[1:], start=2):
        try:
            if name_i >= len(row) or not row[name_i]:
                continue
            name = str(row[name_i]).strip()
            key = name.lower()
            if key in seen:
                errors.append(f"Row {i}: duplicate name '{name}' in file — skipped")
                continue
            seen.add(key)
            meal_periods = ["lunch"]
            if meal_i is not None and row[meal_i]:
                meal_periods = [m.strip().lower() for m in str(row[meal_i]).split(",") if m.strip()]
            parsed.append({
                "name": name,
                "description": str(row[idx["description"]] or "").strip(),
                "category": str(row[idx["category"]] or "Main Course").strip(),
                "price": float(row[idx["price"]] or 0),
                "is_vegetarian": _truthy(row[veg_i]) if (veg_i is not None and row[veg_i] is not None) else True,
                "is_available": True,
                "show_price": True,
                "meal_periods": meal_periods,
                "image_url": str(row[img_i]).strip() if (img_i is not None and row[img_i]) else None,
                "counter": str(row[counter_i]).strip() if (counter_i is not None and row[counter_i]) else None,
            })
        except Exception as e:
            errors.append(f"Row {i}: {str(e)}")
    return parsed, errors


def _is_master(user: dict) -> bool:
    return user.get("role") == "master_admin"


def _can_access_site(user: dict, site_id: str) -> bool:
    role = user.get("role")
    if role == "master_admin":
        return True
    if role == "super_admin":
        return site_id in (user.get("assigned_sites") or [])
    if role == "site_admin":
        return user.get("site_id") == site_id
    return False


def _send_invitation_safe(email: str, name: str, role: str) -> bool:
    """Best-effort send of the invitation email. Never raises — failures are logged.

    Returns True on Resend 2xx, False on any failure (transport, missing API key, etc.).
    Used by admin-creation endpoints + the resend-invite endpoint.
    """
    try:
        import email_service
        html, text = email_service.render_invitation_email(name=name, email=email, role=role)
        subj = "Welcome to Cravitoo — your account is ready"
        return bool(email_service.send_email(email, subj, html, text))
    except Exception as e:  # pragma: no cover — never let an email failure roll back a user creation
        logger.warning(f"Invitation email failed for {email} ({role}): {e}")
        return False


def make_router(db, safe_objectid, get_current_user, hash_password, current_meal_period):
    # Local aliases so existing code reads naturally without re-renaming
    is_master_admin = _is_master
    can_access_site = _can_access_site
    r = APIRouter()

    # Sites CRUD (Master Admin)
    @r.post("/sites")
    async def create_site(data: SiteCreate, user: dict = Depends(get_current_user)):
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin can create sites")
        # Guardrail: a site must belong to a client (company) and a city so it
        # links up the Client → City → Site hierarchy (used by the Sales Report).
        if not data.company_id or not data.city_id:
            raise HTTPException(status_code=400, detail="Please select both a client and a city for this site")
        if not await db.companies.find_one({"_id": safe_objectid(data.company_id, "Company")}):
            raise HTTPException(status_code=404, detail="Selected client not found")
        if not await db.cities.find_one({"_id": safe_objectid(data.city_id, "City")}):
            raise HTTPException(status_code=404, detail="Selected city not found")
        # Per master prompt PDF Module 3: Sites start in 'draft', advance to 'configured', then 'live'.
        # Only 'live' sites accept new employee registrations.
        doc = {
            **data.model_dump(),
            "status": "active",
            "lifecycle_status": "draft",
            "created_at": datetime.now(timezone.utc),
        }
        result = await db.sites.insert_one(doc)
        site_id = str(result.inserted_id)
        # Default meal schedule
        await db.meal_schedules.insert_one({
            "site_id": site_id,
            "schedules": [
                {"meal_period": "breakfast", "start_time": "07:30", "end_time": "10:30", "enabled": True},
                {"meal_period": "lunch", "start_time": "12:00", "end_time": "15:00", "enabled": True},
                {"meal_period": "snacks", "start_time": "16:00", "end_time": "18:00", "enabled": True},
                {"meal_period": "dinner", "start_time": "19:00", "end_time": "22:00", "enabled": False},
            ],
            "updated_at": datetime.now(timezone.utc),
        })
        return {"id": site_id, "lifecycle_status": "draft", **data.model_dump()}

    @r.post("/sites/{site_id}/lifecycle")
    async def transition_site_lifecycle(
        site_id: str,
        payload: Dict[str, Any],
        user: dict = Depends(get_current_user),
    ):
        """Advance a site through Draft → Configured → Live (PDF Module 3).

        Body: { "to": "configured" | "live", "poc_name"?: str }

        - Only master_admin can transition.
        - Only 'live' sites accept new employee registrations.
        - Going Live fires the 'Site Activated' email to the site's POC contact_email.
        """
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin can change site lifecycle")
        target = (payload or {}).get("to", "").lower().strip()
        if target not in ("draft", "configured", "live"):
            raise HTTPException(status_code=400, detail="`to` must be one of: draft, configured, live")

        site = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")})
        if not site:
            raise HTTPException(status_code=404, detail="Site not found")

        current = site.get("lifecycle_status", "draft")
        # Valid transitions: draft → configured, configured → live, live → configured (rollback), any → draft (master reset)
        legal = {
            "draft": {"configured"},
            "configured": {"draft", "live"},
            "live": {"configured"},
        }
        if target == current:
            return {"message": f"Site is already in '{current}' state", "lifecycle_status": current}
        if target not in legal.get(current, set()):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot transition from '{current}' to '{target}'. Valid next states: {sorted(legal.get(current, set()))}",
            )

        update_fields: Dict[str, Any] = {"lifecycle_status": target}
        if target == "live":
            update_fields["activated_at"] = datetime.now(timezone.utc)
        await db.sites.update_one({"_id": site["_id"]}, {"$set": update_fields})

        # Fire 'Site Activated' email on Live transition (best-effort)
        email_sent = False
        if target == "live":
            poc_email = (site.get("contact_email") or "").strip()
            if poc_email:
                try:
                    import email_service as _email_service
                    poc_name = (payload or {}).get("poc_name") or "there"
                    # Try to resolve company name from city/company_id if available
                    company_name = ""
                    if site.get("company_id"):
                        co = await db.companies.find_one({"_id": safe_objectid(site["company_id"], "Company")})
                        if co:
                            company_name = co.get("name", "")
                    html, text = _email_service.render_site_activated_email(
                        poc_name=poc_name,
                        site_name=site.get("name", "Your site"),
                        company_name=company_name,
                    )
                    ok, err = _email_service.send_email(
                        poc_email,
                        f"🎉 {site.get('name', 'Your site')} is now Live on Cravitoo",
                        html, text,
                    )
                    email_sent = bool(ok)
                    if not ok:
                        logger.warning(f"Site activation email send failed for {poc_email}: {err}")
                except Exception as e:
                    logger.warning(f"Site activation email exception for {poc_email}: {e}")

        return {
            "message": f"Site lifecycle moved to '{target}'",
            "lifecycle_status": target,
            "site_activated_email_sent": email_sent,
        }

    @r.get("/sites")
    async def list_sites(user: dict = Depends(get_current_user)):
        query = {}
        if user.get("role") == "super_admin":
            ids = [safe_objectid(s, "Site") for s in (user.get("assigned_sites") or [])]
            if not ids:
                return []
            query["_id"] = {"$in": ids}
        elif user.get("role") == "site_admin":
            sid = user.get("site_id")
            if not sid:
                return []
            query["_id"] = safe_objectid(sid, "Site")
        elif user.get("role") == "employee":
            sid = user.get("site_id")
            if not sid:
                return []
            query["_id"] = safe_objectid(sid, "Site")
        elif user.get("role") == "vendor":
            # Vendor sees sites they're mapped to
            mappings = await db.vendor_site_mappings.find({"vendor_id": user.get("vendor_id")}).to_list(500)
            site_ids = [safe_objectid(m["site_id"], "Site") for m in mappings]
            if not site_ids:
                return []
            query["_id"] = {"$in": site_ids}
        # master_admin sees all sites
    
        sites = await db.sites.find(query).sort("name", 1).to_list(1000)
        for s in sites:
            s["id"] = str(s.pop("_id"))
            # Default for legacy sites that don't have lifecycle_status set yet
            if not s.get("lifecycle_status"):
                s["lifecycle_status"] = "live"
            if isinstance(s.get("created_at"), datetime):
                s["created_at"] = s["created_at"].isoformat()
            if isinstance(s.get("activated_at"), datetime):
                s["activated_at"] = s["activated_at"].isoformat()
        return sites

    @r.get("/sites/{site_id}")
    async def get_site(site_id: str, user: dict = Depends(get_current_user)):
        if not (is_master_admin(user) or can_access_site(user, site_id) or
                user.get("role") == "employee" and user.get("site_id") == site_id):
            raise HTTPException(status_code=403, detail="Access denied")
        site = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")})
        if not site:
            raise HTTPException(status_code=404, detail="Site not found")
        out = {**site}
        out["id"] = str(out.pop("_id"))
        if not out.get("lifecycle_status"):
            out["lifecycle_status"] = "live"
        if isinstance(out.get("created_at"), datetime):
            out["created_at"] = out["created_at"].isoformat()
        if isinstance(out.get("activated_at"), datetime):
            out["activated_at"] = out["activated_at"].isoformat()
        return out

    @r.patch("/sites/{site_id}")
    async def update_site(site_id: str, updates: Dict[str, Any], user: dict = Depends(get_current_user)):
        if not can_access_site(user, site_id):
            raise HTTPException(status_code=403, detail="Access denied")
        allowed = {"name", "address", "city", "city_id", "contact_email", "contact_phone",
                   "allow_pre_order", "allow_cash_carry", "allow_company_paid", "allow_employee_paid"}
        # `status`, per-site `meal_prices` and the client link (`company_id`)
        # can only be changed by master_admin
        if is_master_admin(user):
            allowed = allowed | {"status", "meal_prices", "company_id"}
        cleaned = {k: v for k, v in updates.items() if k in allowed}
        # Sanitize meal_prices → dict of the 4 known meal types coerced to float.
        if "meal_prices" in cleaned:
            raw = cleaned["meal_prices"] or {}
            valid_keys = {"veg_meal", "non_veg_meal", "veg_salad", "non_veg_salad"}
            mp = {}
            for k, v in (raw.items() if isinstance(raw, dict) else []):
                if k in valid_keys:
                    try:
                        fv = float(v)
                    except (TypeError, ValueError):
                        raise HTTPException(status_code=400, detail=f"meal_prices.{k} must be a number")
                    if fv < 0:
                        raise HTTPException(status_code=400, detail=f"meal_prices.{k} cannot be negative")
                    mp[k] = round(fv, 2)
            if not mp:
                # Caller sent a meal_prices object with no recognised keys — reject
                # instead of silently persisting {} and wiping the saved prices.
                raise HTTPException(status_code=400, detail="meal_prices must include at least one of: veg_meal, non_veg_meal, veg_salad, non_veg_salad")
            # Merge onto existing prices so a partial update never drops other meals.
            existing_site = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")}, {"meal_prices": 1})
            existing_prices = (existing_site or {}).get("meal_prices") or {}
            cleaned["meal_prices"] = {**existing_prices, **mp}
        if not cleaned:
            raise HTTPException(status_code=400, detail="No valid fields to update")
        await db.sites.update_one({"_id": safe_objectid(site_id, "Site")}, {"$set": cleaned})
        return {"message": "Site updated"}

    @r.delete("/sites/{site_id}")
    async def delete_site(site_id: str, user: dict = Depends(get_current_user)):
        """Hard-delete a site and cascade-clean every child record.

        Master Admin only. Removes: site row, meal_schedules, vendor_site_mappings,
        menu_items, reservations, orders, order_status_history, and unbinds any
        users (site_admin/employee) that pointed to this site.
        """
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin can delete sites")
        site = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")})
        if not site:
            raise HTTPException(status_code=404, detail="Site not found")

        removed: Dict[str, int] = {}

        # 1) Collect order IDs at this site so we can wipe their history too.
        order_ids = [str(o["_id"]) async for o in db.orders.find({"site_id": site_id}, {"_id": 1})]
        if order_ids:
            removed["order_status_history"] = (await db.order_status_history.delete_many(
                {"order_id": {"$in": order_ids}}
            )).deleted_count

        # 2) Cascade deletes for direct children
        removed["orders"] = (await db.orders.delete_many({"site_id": site_id})).deleted_count
        removed["reservations"] = (await db.reservations.delete_many({"site_id": site_id})).deleted_count
        removed["pre_order_reservations"] = (
            await db.pre_order_reservations.delete_many({"site_id": site_id})
        ).deleted_count
        removed["menu_items"] = (await db.menu_items.delete_many({"site_id": site_id})).deleted_count
        removed["vendor_site_mappings"] = (
            await db.vendor_site_mappings.delete_many({"site_id": site_id})
        ).deleted_count
        removed["meal_schedules"] = (await db.meal_schedules.delete_many({"site_id": site_id})).deleted_count
        removed["allowed_domains"] = (
            await db.allowed_domains.update_many(
                {"site_id": site_id}, {"$unset": {"site_id": ""}}
            )
        ).modified_count

        # 3) Unbind users that were tied to this site (do NOT delete the accounts).
        removed["users_unbound"] = (
            await db.users.update_many(
                {"site_id": site_id},
                {"$unset": {"site_id": ""}}
            )
        ).modified_count
        # Super admins may have this site in assigned_sites — pull it.
        await db.users.update_many(
            {"assigned_sites": site_id},
            {"$pull": {"assigned_sites": site_id}},
        )

        # 4) Finally drop the site itself.
        await db.sites.delete_one({"_id": site["_id"]})
        return {"message": f"Site '{site.get('name')}' deleted", "removed": removed}

    # Vendor-Site Mapping (Master/Super Admin)
    @r.post("/sites/{site_id}/vendors")
    async def map_vendor_to_site(site_id: str, data: VendorSiteMappingCreate, user: dict = Depends(get_current_user)):
        if not can_access_site(user, site_id):
            raise HTTPException(status_code=403, detail="Access denied")
        existing = await db.vendor_site_mappings.find_one({"vendor_id": data.vendor_id, "site_id": site_id})
        if existing:
            raise HTTPException(status_code=400, detail="Vendor already mapped to this site")
        from routers.cafeterias import _default_cafeteria_id
        cafeteria_id = data.cafeteria_id
        if cafeteria_id:
            caf = await db.cafeterias.find_one({"_id": safe_objectid(cafeteria_id, "Cafeteria")})
            if not caf or caf["site_id"] != site_id:
                raise HTTPException(status_code=404, detail="Cafeteria not found at this site")
        else:
            cafeteria_id = await _default_cafeteria_id(db, site_id)
        await db.vendor_site_mappings.insert_one({
            "vendor_id": data.vendor_id,
            "site_id": site_id,
            "cafeteria_id": cafeteria_id,
            "status": "active",
            "created_at": datetime.now(timezone.utc),
        })
        return {"message": "Vendor mapped to site", "cafeteria_id": cafeteria_id}

    @r.get("/sites/{site_id}/vendors")
    async def list_site_vendors(site_id: str, user: dict = Depends(get_current_user)):
        # Allow employees of this site to list vendors too
        if not (can_access_site(user, site_id) or
                (user.get("role") == "employee" and user.get("site_id") == site_id)):
            raise HTTPException(status_code=403, detail="Access denied")
        mappings = await db.vendor_site_mappings.find({"site_id": site_id, "status": "active"}).to_list(500)
        vendor_ids = [safe_objectid(m["vendor_id"], "Vendor") for m in mappings]
        if not vendor_ids:
            return []
        # Build vendor_id -> cafeteria_id lookup and fetch cafeteria names.
        caf_by_vendor = {m["vendor_id"]: m.get("cafeteria_id") for m in mappings}
        caf_names = {}
        cafs = await db.cafeterias.find({"site_id": site_id}).to_list(500)
        for c in cafs:
            caf_names[str(c["_id"])] = c.get("name")
        vendors = await db.vendors.find({"_id": {"$in": vendor_ids}, "status": "active"}).to_list(500)
        out_list = []
        for v in vendors:
            doc = {**v}
            doc["id"] = str(doc.pop("_id"))
            cid = caf_by_vendor.get(doc["id"])
            doc["cafeteria_id"] = cid
            doc["cafeteria_name"] = caf_names.get(cid) if cid else None
            out_list.append(doc)
        return out_list

    @r.delete("/sites/{site_id}/vendors/{vendor_id}")
    async def unmap_vendor(site_id: str, vendor_id: str, user: dict = Depends(get_current_user)):
        if not can_access_site(user, site_id):
            raise HTTPException(status_code=403, detail="Access denied")
        await db.vendor_site_mappings.delete_one({"vendor_id": vendor_id, "site_id": site_id})
        return {"message": "Vendor unmapped"}

    @r.put("/sites/{site_id}/vendors/swap")
    async def swap_vendor(site_id: str, payload: Dict[str, Any], user: dict = Depends(get_current_user)):
        """Replace one mapped vendor with another in a single atomic call.

        Body: { old_vendor_id, new_vendor_id }
        Master Admin / City Admin / Site Admin only.
        """
        if not can_access_site(user, site_id):
            raise HTTPException(status_code=403, detail="Access denied")
        old_vendor_id = (payload or {}).get("old_vendor_id")
        new_vendor_id = (payload or {}).get("new_vendor_id")
        if not old_vendor_id or not new_vendor_id:
            raise HTTPException(status_code=400, detail="old_vendor_id and new_vendor_id are required")
        if old_vendor_id == new_vendor_id:
            raise HTTPException(status_code=400, detail="old and new vendor are the same")

        # The new vendor must exist and be active
        new_vendor = await db.vendors.find_one({"_id": safe_objectid(new_vendor_id, "Vendor"), "status": "active"})
        if not new_vendor:
            raise HTTPException(status_code=404, detail="New vendor not found or not active")
        # Block if new vendor is already mapped to this site
        already = await db.vendor_site_mappings.find_one({"vendor_id": new_vendor_id, "site_id": site_id})
        if already:
            raise HTTPException(status_code=400, detail="New vendor is already mapped to this site")

        now = datetime.now(timezone.utc)
        # Preserve the old vendor's cafeteria assignment for the replacement.
        old_map = await db.vendor_site_mappings.find_one({"vendor_id": old_vendor_id, "site_id": site_id})
        cafeteria_id = (old_map or {}).get("cafeteria_id")
        if not cafeteria_id:
            from routers.cafeterias import _default_cafeteria_id
            cafeteria_id = await _default_cafeteria_id(db, site_id)
        # Atomic-ish: remove old, insert new
        await db.vendor_site_mappings.delete_one({"vendor_id": old_vendor_id, "site_id": site_id})
        await db.vendor_site_mappings.insert_one({
            "vendor_id": new_vendor_id,
            "site_id": site_id,
            "cafeteria_id": cafeteria_id,
            "status": "active",
            "created_at": now,
            "swapped_from": old_vendor_id,
            "swapped_by": user.get("id"),
        })
        return {
            "message": "Vendor swapped",
            "old_vendor_id": old_vendor_id,
            "new_vendor_id": new_vendor_id,
            "new_vendor_name": new_vendor.get("name"),
        }

    # Meal Schedules per Site
    @r.get("/sites/{site_id}/schedule")
    async def get_site_schedule(site_id: str, user: dict = Depends(get_current_user)):
        if not (can_access_site(user, site_id) or
                (user.get("role") == "employee" and user.get("site_id") == site_id)):
            raise HTTPException(status_code=403, detail="Access denied")
        sched = await db.meal_schedules.find_one({"site_id": site_id})
        if not sched:
            return {"site_id": site_id, "schedules": []}
        return {
            "site_id": site_id,
            "schedules": sched.get("schedules", []),
        }

    @r.put("/sites/{site_id}/schedule")
    async def update_site_schedule(site_id: str, data: MealScheduleUpdate, user: dict = Depends(get_current_user)):
        if not can_access_site(user, site_id):
            raise HTTPException(status_code=403, detail="Access denied")
        await db.meal_schedules.update_one(
            {"site_id": site_id},
            {"$set": {"schedules": [s.model_dump() for s in data.schedules], "updated_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
        return {"message": "Schedule updated"}

    # Current meal period helper now defined at the top of this file

    # Site Menu (Site Admin / Employee dynamic)
    @r.get("/sites/{site_id}/menu")
    async def get_site_menu(
        site_id: str,
        meal_period: Optional[str] = None,
        user: dict = Depends(get_current_user),
    ):
        # Allow employees of this site
        if not (can_access_site(user, site_id) or
                (user.get("role") == "employee" and user.get("site_id") == site_id) or
                user.get("role") == "vendor"):
            raise HTTPException(status_code=403, detail="Access denied")
    
        query = {"site_id": site_id}
        if meal_period:
            query["meal_periods"] = meal_period
        # Site admin / Master sees all; Employee sees only available
        if user.get("role") == "employee":
            query["is_available"] = True
    
        items = await db.menu_items.find(query).to_list(2000)
        out_items = []
        for item in items:
            doc = {**item}
            doc["id"] = str(doc.pop("_id"))
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            out_items.append(doc)
        return out_items

    @r.patch("/menu/{item_id}/site-control")
    async def site_admin_menu_control(item_id: str, data: MenuItemSiteUpdate, user: dict = Depends(get_current_user)):
        """Site admin (or master/super) toggles availability, pricing, show_price, or meal_periods on a menu item."""
        item = await db.menu_items.find_one({"_id": safe_objectid(item_id, "Menu item")})
        if not item:
            raise HTTPException(status_code=404, detail="Menu item not found")
        if not (is_master_admin(user) or can_access_site(user, item.get("site_id", ""))):
            raise HTTPException(status_code=403, detail="Access denied")
        cleaned = {k: v for k, v in data.model_dump().items() if v is not None}
        if not cleaned:
            raise HTTPException(status_code=400, detail="No fields to update")
        await db.menu_items.update_one({"_id": safe_objectid(item_id, "Menu item")}, {"$set": cleaned})
        return {"message": "Menu item updated"}

    # Excel Menu Upload (Site Admin)
    @r.post("/sites/{site_id}/menu/upload-excel")
    async def upload_menu_excel(
        site_id: str,
        vendor_id: str = Query(...),
        mode: str = Query("replace"),
        file: UploadFile = File(...),
        user: dict = Depends(get_current_user),
    ):
        """Upload an Excel (.xlsx) file with menu items.
        Expected columns: name, description, category, price, is_vegetarian, image_url (optional), meal_periods (comma-separated)

        mode:
          - ``replace`` (default): wipe this vendor's existing menu at this site,
            then insert the uploaded rows. Guarantees no leftover / duplicate items.
          - ``append``: keep existing items but upsert by name so re-uploading the
            same dish updates it in place instead of creating a duplicate.
        """
        if not (is_master_admin(user) or can_access_site(user, site_id)):
            raise HTTPException(status_code=403, detail="Access denied")
        if mode not in ("replace", "append"):
            raise HTTPException(status_code=400, detail="mode must be 'replace' or 'append'")
    
        if not file.filename.endswith((".xlsx", ".xls")):
            raise HTTPException(status_code=400, detail="Only .xlsx/.xls files are supported")
    
        content = await file.read()
        if len(content) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large (max 5 MB)")
    
        try:
            workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            sheet = workbook.active
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read Excel file: {str(e)}")
    
        rows = list(sheet.iter_rows(values_only=True))
        if len(rows) < 2:
            raise HTTPException(status_code=400, detail="Excel must contain at least a header row and one data row")
    
        headers = [str(h).strip().lower() if h else "" for h in rows[0]]
        required = ["name", "description", "category", "price"]
        missing = [c for c in required if c not in headers]
        if missing:
            raise HTTPException(status_code=400, detail=f"Missing required columns: {', '.join(missing)}")
    
        name_idx = headers.index("name")
        desc_idx = headers.index("description")
        cat_idx = headers.index("category")
        price_idx = headers.index("price")
        veg_idx = headers.index("is_vegetarian") if "is_vegetarian" in headers else None
        img_idx = headers.index("image_url") if "image_url" in headers else None
        meal_idx = headers.index("meal_periods") if "meal_periods" in headers else None
        counter_idx = headers.index("counter") if "counter" in headers else None

        # Parse + validate every row FIRST so a bad file never partially wipes a menu.
        parsed = []
        errors = []
        seen_names = set()
        for i, row in enumerate(rows[1:], start=2):
            try:
                if not row[name_idx]:
                    continue
                name = str(row[name_idx]).strip()
                key = name.lower()
                if key in seen_names:
                    errors.append(f"Row {i}: duplicate name '{name}' in file — skipped")
                    continue
                seen_names.add(key)
                meal_periods = ["lunch"]
                if meal_idx is not None and row[meal_idx]:
                    meal_periods = [m.strip().lower() for m in str(row[meal_idx]).split(",") if m.strip()]
                parsed.append({
                    "vendor_id": vendor_id,
                    "site_id": site_id,
                    "name": name,
                    "description": str(row[desc_idx] or "").strip(),
                    "category": str(row[cat_idx] or "Main Course").strip(),
                    "price": float(row[price_idx] or 0),
                    "is_vegetarian": bool(row[veg_idx]) if veg_idx is not None else True,
                    "is_available": True,
                    "show_price": True,
                    "meal_periods": meal_periods,
                    "image_url": str(row[img_idx]).strip() if img_idx is not None and row[img_idx] else None,
                    "counter": str(row[counter_idx]).strip() if (counter_idx is not None and row[counter_idx]) else None,
                    "created_at": datetime.now(timezone.utc),
                })
            except Exception as e:
                errors.append(f"Row {i}: {str(e)}")

        if not parsed:
            raise HTTPException(status_code=400, detail="No valid menu rows found in the file. " + ("; ".join(errors) if errors else ""))

        removed = 0
        inserted = 0
        updated = 0
        if mode == "replace":
            removed = (await db.menu_items.delete_many({"vendor_id": vendor_id, "site_id": site_id})).deleted_count
            await db.menu_items.insert_many(parsed)
            inserted = len(parsed)
        else:  # append — upsert by name to avoid duplicates
            for doc in parsed:
                res = await db.menu_items.update_one(
                    {"vendor_id": vendor_id, "site_id": site_id, "name": doc["name"]},
                    {"$set": {k: v for k, v in doc.items() if k != "created_at"},
                     "$setOnInsert": {"created_at": doc["created_at"]}},
                    upsert=True,
                )
                if res.upserted_id is not None:
                    inserted += 1
                else:
                    updated += 1

        return {"mode": mode, "removed": removed, "inserted": inserted, "updated": updated,
                "errors": errors, "site_id": site_id, "vendor_id": vendor_id}

    @r.delete("/sites/{site_id}/menu")
    async def clear_site_menu(
        site_id: str,
        vendor_id: str = Query(...),
        user: dict = Depends(get_current_user),
    ):
        """Delete/clear an entire vendor's menu at this site in one action.
        Master admin or an admin with access to the site. Reads across the Web,
        Customer and Vendor apps reflect the empty menu immediately (live query)."""
        if not (is_master_admin(user) or can_access_site(user, site_id)):
            raise HTTPException(status_code=403, detail="Access denied")
        removed = (await db.menu_items.delete_many({"vendor_id": vendor_id, "site_id": site_id})).deleted_count
        return {"removed": removed, "site_id": site_id, "vendor_id": vendor_id}

    # ---------- Excel template download ----------
    @r.get("/admin/menu-excel-template")
    async def download_menu_template(user: dict = Depends(get_current_user)):
        data = build_menu_template_xlsx()
        return StreamingResponse(
            io.BytesIO(data),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=cravitoo_menu_template.xlsx"},
        )

    # ---------- Upload preview (dry-run diff) ----------
    @r.post("/sites/{site_id}/menu/preview")
    async def preview_menu_upload(
        site_id: str,
        vendor_id: str = Query(...),
        file: UploadFile = File(...),
        user: dict = Depends(get_current_user),
    ):
        if not (is_master_admin(user) or can_access_site(user, site_id)):
            raise HTTPException(status_code=403, detail="Access denied")
        if not file.filename.endswith((".xlsx", ".xls")):
            raise HTTPException(status_code=400, detail="Only .xlsx/.xls files are supported")
        content = await file.read()
        parsed, errors = parse_menu_workbook(content)
        existing = await db.menu_items.find({"vendor_id": vendor_id, "site_id": site_id}, {"name": 1}).to_list(2000)
        existing_names = {str(e.get("name", "")).strip().lower() for e in existing}
        new_names = {p["name"].strip().lower() for p in parsed}
        added = [p["name"] for p in parsed if p["name"].strip().lower() not in existing_names]
        updated = [p["name"] for p in parsed if p["name"].strip().lower() in existing_names]
        removed = [e.get("name") for e in existing if str(e.get("name", "")).strip().lower() not in new_names]
        return {"added": added, "updated": updated, "removed": removed,
                "total_in_file": len(parsed), "current_count": len(existing), "errors": errors}

    # ---------- Menu version history + restore ----------
    async def _snapshot_menu(vendor_id: str, site_id: str, action: str, actor: dict):
        items = await db.menu_items.find({"vendor_id": vendor_id, "site_id": site_id}).to_list(2000)
        for it in items:
            it.pop("_id", None)
        await db.menu_versions.insert_one({
            "vendor_id": vendor_id, "site_id": site_id, "action": action,
            "items": items, "item_count": len(items),
            "created_at": datetime.now(timezone.utc),
            "created_by": actor.get("email"),
        })
        # keep only the last 5 snapshots per vendor+site
        olds = await db.menu_versions.find(
            {"vendor_id": vendor_id, "site_id": site_id}, {"_id": 1}
        ).sort("created_at", -1).to_list(1000)
        for stale in olds[5:]:
            await db.menu_versions.delete_one({"_id": stale["_id"]})

    async def _apply_menu(vendor_id: str, site_id: str, parsed: list, actor: dict, action: str):
        await _snapshot_menu(vendor_id, site_id, f"before_{action}", actor)
        await db.menu_items.delete_many({"vendor_id": vendor_id, "site_id": site_id})
        now = datetime.now(timezone.utc)
        docs = [{**p, "vendor_id": vendor_id, "site_id": site_id, "created_at": now} for p in parsed]
        if docs:
            await db.menu_items.insert_many(docs)
        return len(docs)

    @r.get("/sites/{site_id}/menu/versions")
    async def list_menu_versions(site_id: str, vendor_id: str = Query(...), user: dict = Depends(get_current_user)):
        if not (is_master_admin(user) or can_access_site(user, site_id)):
            raise HTTPException(status_code=403, detail="Access denied")
        vers = await db.menu_versions.find(
            {"vendor_id": vendor_id, "site_id": site_id}
        ).sort("created_at", -1).to_list(20)
        out = []
        for v in vers:
            out.append({
                "id": str(v["_id"]), "action": v.get("action"),
                "item_count": v.get("item_count", 0),
                "created_at": v["created_at"].isoformat() if isinstance(v.get("created_at"), datetime) else v.get("created_at"),
                "created_by": v.get("created_by"),
            })
        return out

    @r.post("/sites/{site_id}/menu/versions/{version_id}/restore")
    async def restore_menu_version(site_id: str, version_id: str, vendor_id: str = Query(...), user: dict = Depends(get_current_user)):
        if not (is_master_admin(user) or can_access_site(user, site_id)):
            raise HTTPException(status_code=403, detail="Access denied")
        ver = await db.menu_versions.find_one({"_id": safe_objectid(version_id, "Version")})
        if not ver or ver.get("vendor_id") != vendor_id or ver.get("site_id") != site_id:
            raise HTTPException(status_code=404, detail="Version not found")
        await _snapshot_menu(vendor_id, site_id, "before_restore", user)
        await db.menu_items.delete_many({"vendor_id": vendor_id, "site_id": site_id})
        now = datetime.now(timezone.utc)
        docs = [{**it, "vendor_id": vendor_id, "site_id": site_id} for it in ver.get("items", [])]
        for d in docs:
            d.setdefault("created_at", now)
        if docs:
            await db.menu_items.insert_many(docs)
        return {"restored": len(docs), "version_id": version_id}

    # ================= VENDOR BULK UPLOAD → ADMIN APPROVAL =================
    @r.post("/vendor/menu-uploads")
    async def vendor_submit_menu_upload(
        site_id: str = Query(...),
        file: UploadFile = File(...),
        user: dict = Depends(get_current_user),
    ):
        """Vendor uploads an Excel menu for a site and submits it for admin
        approval. It is NOT applied to the live menu — status stays 'pending'
        until an admin approves. Vendors cannot publish directly."""
        if user.get("role") != "vendor":
            raise HTTPException(status_code=403, detail="Only vendors can submit menu uploads")
        vendor_id = user.get("vendor_id")
        if not vendor_id:
            raise HTTPException(status_code=400, detail="No vendor linked to this account")
        mapping = await db.vendor_site_mappings.find_one({"vendor_id": vendor_id, "site_id": site_id, "status": "active"})
        if not mapping:
            raise HTTPException(status_code=403, detail="You are not assigned to this site")
        if not file.filename.endswith((".xlsx", ".xls")):
            raise HTTPException(status_code=400, detail="Only .xlsx/.xls files are supported")
        content = await file.read()
        if len(content) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large (max 5 MB)")
        parsed, errors = parse_menu_workbook(content)
        if not parsed:
            raise HTTPException(status_code=400, detail="No valid menu rows found. " + ("; ".join(errors) if errors else ""))
        doc = {
            "vendor_id": vendor_id, "site_id": site_id,
            "status": "pending", "items": parsed, "item_count": len(parsed),
            "file_name": file.filename, "parse_errors": errors,
            "submitted_by": user.get("email"),
            "created_at": datetime.now(timezone.utc),
        }
        res = await db.menu_upload_requests.insert_one(doc)
        return {"id": str(res.inserted_id), "status": "pending", "item_count": len(parsed), "errors": errors}

    @r.get("/vendor/menu-uploads")
    async def vendor_list_menu_uploads(user: dict = Depends(get_current_user)):
        if user.get("role") != "vendor":
            raise HTTPException(status_code=403, detail="Only vendors")
        cur = await db.menu_upload_requests.find(
            {"vendor_id": user.get("vendor_id")}
        ).sort("created_at", -1).to_list(50)
        out = []
        for d in cur:
            out.append({
                "id": str(d["_id"]), "status": d.get("status"),
                "item_count": d.get("item_count", 0), "file_name": d.get("file_name"),
                "site_id": d.get("site_id"),
                "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else d.get("created_at"),
                "decision_note": d.get("decision_note"),
                "decided_by": d.get("decided_by"),
            })
        return out

    @r.get("/admin/menu-uploads")
    async def admin_list_menu_uploads(status: Optional[str] = None, site_id: Optional[str] = None, user: dict = Depends(get_current_user)):
        if not (is_master_admin(user) or user.get("role") in ("site_admin", "city_admin", "super_admin")):
            raise HTTPException(status_code=403, detail="Access denied")
        q: dict = {}
        if status == "decided":
            q["status"] = {"$in": ["approved", "rejected"]}
        elif status:
            q["status"] = status
        if site_id:
            q["site_id"] = site_id
        elif user.get("role") == "site_admin" and user.get("site_id"):
            q["site_id"] = user.get("site_id")
        cur = await db.menu_upload_requests.find(q).sort("created_at", -1).to_list(200)
        vids = {d.get("vendor_id") for d in cur}
        vmap = {}
        for vid in vids:
            v = await db.vendors.find_one({"_id": safe_objectid(vid, "Vendor")}, {"name": 1}) if vid else None
            vmap[vid] = (v or {}).get("name", "Unknown")
        out = []
        for d in cur:
            out.append({
                "id": str(d["_id"]), "status": d.get("status"),
                "vendor_id": d.get("vendor_id"), "vendor_name": vmap.get(d.get("vendor_id")),
                "site_id": d.get("site_id"), "item_count": d.get("item_count", 0),
                "file_name": d.get("file_name"), "submitted_by": d.get("submitted_by"),
                "items": d.get("items", []),
                "decided_by": d.get("decided_by"), "decision_note": d.get("decision_note"),
                "decided_at": d["decided_at"].isoformat() if isinstance(d.get("decided_at"), datetime) else d.get("decided_at"),
                "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else d.get("created_at"),
            })
        return out

    @r.patch("/admin/menu-uploads/{req_id}/items")
    async def admin_edit_menu_upload_items(req_id: str, payload: Dict[str, Any], user: dict = Depends(get_current_user)):
        """Admin tweaks a PENDING upload before publishing — adjust prices, drop
        items, edit names. Body: {items:[{name, price, description?, category?,
        is_vegetarian?, counter?, meal_periods?, image_url?}]}."""
        req = await db.menu_upload_requests.find_one({"_id": safe_objectid(req_id, "Request")})
        if not req:
            raise HTTPException(status_code=404, detail="Upload request not found")
        if not (is_master_admin(user) or can_access_site(user, req.get("site_id"))):
            raise HTTPException(status_code=403, detail="Access denied")
        if req.get("status") != "pending":
            raise HTTPException(status_code=400, detail=f"Already {req.get('status')}")
        raw_items = payload.get("items")
        if not isinstance(raw_items, list) or not raw_items:
            raise HTTPException(status_code=400, detail="items must be a non-empty list")
        cleaned = []
        seen = set()
        for it in raw_items:
            name = str(it.get("name", "")).strip()
            if not name or name.lower() in seen:
                continue
            seen.add(name.lower())
            try:
                price = float(it.get("price", 0))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"Invalid price for '{name}'")
            if price < 0:
                raise HTTPException(status_code=400, detail=f"Price cannot be negative for '{name}'")
            mp = it.get("meal_periods") or ["lunch"]
            if isinstance(mp, str):
                mp = [m.strip().lower() for m in mp.split(",") if m.strip()]
            cleaned.append({
                "name": name,
                "description": str(it.get("description", "")).strip(),
                "category": str(it.get("category", "Main Course")).strip() or "Main Course",
                "price": round(price, 2),
                "is_vegetarian": bool(it.get("is_vegetarian", True)),
                "is_available": True, "show_price": True,
                "meal_periods": mp,
                "image_url": it.get("image_url") or None,
                "counter": (str(it.get("counter")).strip() or None) if it.get("counter") else None,
            })
        if not cleaned:
            raise HTTPException(status_code=400, detail="No valid items after edit")
        await db.menu_upload_requests.update_one(
            {"_id": req["_id"]},
            {"$set": {"items": cleaned, "item_count": len(cleaned), "edited_by": user.get("email"),
                      "edited_at": datetime.now(timezone.utc)}},
        )
        return {"item_count": len(cleaned), "items": cleaned}

    def _notify_vendor_menu_decision(req: dict, decision: str, actor: dict, note: str = ""):
        """Best-effort email to the vendor who submitted the upload."""
        to = req.get("submitted_by")
        if not to:
            return
        try:
            import email_service
            vname = req.get("vendor_name") or "your"
            approved = decision == "approved"
            title = "Menu upload approved ✅" if approved else "Menu upload needs changes"
            intro = (f"Your menu upload (<strong>{req.get('file_name', 'menu')}</strong>, "
                     f"{req.get('item_count', 0)} items) has been <strong>{decision}</strong> "
                     f"by {actor.get('email', 'an admin')}.")
            body = ("<p>Your updated menu is now live across the app.</p>" if approved
                    else f"<p>Reason: {note or 'No reason provided.'}</p><p>Please review and re-submit.</p>")
            html = email_service._brand_wrapper(title, intro, body)
            email_service.send_email(to, f"Cravitoo — {title}", html)
        except Exception as e:
            logger.warning(f"menu decision email failed: {e}")

    @r.post("/admin/menu-uploads/{req_id}/approve")
    async def admin_approve_menu_upload(req_id: str, user: dict = Depends(get_current_user)):
        req = await db.menu_upload_requests.find_one({"_id": safe_objectid(req_id, "Request")})
        if not req:
            raise HTTPException(status_code=404, detail="Upload request not found")
        if not (is_master_admin(user) or can_access_site(user, req.get("site_id"))):
            raise HTTPException(status_code=403, detail="Access denied")
        if req.get("status") != "pending":
            raise HTTPException(status_code=400, detail=f"Already {req.get('status')}")
        applied = await _apply_menu(req["vendor_id"], req["site_id"], req.get("items", []), user, "approve_upload")
        await db.menu_upload_requests.update_one(
            {"_id": req["_id"]},
            {"$set": {"status": "approved", "decided_by": user.get("email"),
                      "decided_at": datetime.now(timezone.utc)}},
        )
        v = await db.vendors.find_one({"_id": safe_objectid(req["vendor_id"], "Vendor")}, {"name": 1})
        _notify_vendor_menu_decision({**req, "vendor_name": (v or {}).get("name")}, "approved", user)
        return {"status": "approved", "applied": applied}

    @r.post("/admin/menu-uploads/{req_id}/reject")
    async def admin_reject_menu_upload(req_id: str, payload: Dict[str, Any] = None, user: dict = Depends(get_current_user)):
        req = await db.menu_upload_requests.find_one({"_id": safe_objectid(req_id, "Request")})
        if not req:
            raise HTTPException(status_code=404, detail="Upload request not found")
        if not (is_master_admin(user) or can_access_site(user, req.get("site_id"))):
            raise HTTPException(status_code=403, detail="Access denied")
        if req.get("status") != "pending":
            raise HTTPException(status_code=400, detail=f"Already {req.get('status')}")
        note = (payload or {}).get("note", "")
        await db.menu_upload_requests.update_one(
            {"_id": req["_id"]},
            {"$set": {"status": "rejected", "decision_note": note,
                      "decided_by": user.get("email"), "decided_at": datetime.now(timezone.utc)}},
        )
        v = await db.vendors.find_one({"_id": safe_objectid(req["vendor_id"], "Vendor")}, {"name": 1})
        _notify_vendor_menu_decision({**req, "vendor_name": (v or {}).get("name")}, "rejected", user, note)
        return {"status": "rejected"}

    # Master Admin: Create Site Admin / Super Admin
    @r.post("/admin/site-admins")
    async def create_site_admin(data: SiteAdminCreate, user: dict = Depends(get_current_user)):
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin can create site admins")
        email_lower = data.email.lower()
        if await db.users.find_one({"email": email_lower}):
            raise HTTPException(status_code=400, detail="Email already registered")
        # Validate site exists
        site = await db.sites.find_one({"_id": safe_objectid(data.site_id, "Site")})
        if not site:
            raise HTTPException(status_code=404, detail="Site not found")
        result = await db.users.insert_one({
            "email": email_lower,
            "password_hash": hash_password(data.password),
            "name": data.name,
            "role": "site_admin",
            "site_id": data.site_id,
            "created_at": datetime.now(timezone.utc),
        })
        _send_invitation_safe(email_lower, data.name, "site_admin")
        return {"id": str(result.inserted_id), "email": email_lower, "role": "site_admin", "site_id": data.site_id, "invite_sent": True}

    @r.post("/admin/super-admins")
    async def create_super_admin(data: SuperAdminCreate, user: dict = Depends(get_current_user)):
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin can create super admins")
        email_lower = data.email.lower()
        if await db.users.find_one({"email": email_lower}):
            raise HTTPException(status_code=400, detail="Email already registered")
        # Validate assigned_sites exist
        if data.assigned_sites:
            site_oids = [safe_objectid(sid, "Site") for sid in data.assigned_sites]
            existing = await db.sites.count_documents({"_id": {"$in": site_oids}})
            if existing != len(data.assigned_sites):
                raise HTTPException(status_code=404, detail="One or more assigned_sites not found")
        result = await db.users.insert_one({
            "email": email_lower,
            "password_hash": hash_password(data.password),
            "name": data.name,
            "role": "super_admin",
            "assigned_sites": data.assigned_sites,
            "created_at": datetime.now(timezone.utc),
        })
        _send_invitation_safe(email_lower, data.name, "super_admin")
        return {"id": str(result.inserted_id), "email": email_lower, "role": "super_admin", "assigned_sites": data.assigned_sites, "invite_sent": True}

    @r.post("/admin/master-admins")
    async def create_master_admin(data: MasterAdminCreate, user: dict = Depends(get_current_user)):
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin can create master admins")
        email_lower = data.email.lower()
        if not email_lower.endswith("@cravitoo.com"):
            raise HTTPException(status_code=400, detail="Master admin email must be @cravitoo.com")
        if await db.users.find_one({"email": email_lower}):
            raise HTTPException(status_code=400, detail="Email already registered")
        result = await db.users.insert_one({
            "email": email_lower,
            "password_hash": hash_password(data.password),
            "name": data.name,
            "role": "master_admin",
            "created_at": datetime.now(timezone.utc),
        })
        _send_invitation_safe(email_lower, data.name, "master_admin")
        return {"id": str(result.inserted_id), "email": email_lower, "role": "master_admin", "invite_sent": True}

    @r.post("/admin/users/{user_id}/resend-invite")
    async def resend_invite(user_id: str, user: dict = Depends(get_current_user)):
        """Master Admin: re-send the invitation email to any admin/vendor/employee."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin can resend invites")
        u = await db.users.find_one({"_id": safe_objectid(user_id, "User")})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        ok = _send_invitation_safe(u["email"], u.get("name", ""), u.get("role", "employee"))
        if not ok:
            raise HTTPException(status_code=502, detail="Could not send invite email — check email provider configuration")
        return {"sent": True, "email": u["email"]}

    @r.post("/vendors/{vendor_id}/resend-invite")
    async def resend_vendor_invite(vendor_id: str, user: dict = Depends(get_current_user)):
        """Master Admin: re-send the invitation email to the vendor user associated with this vendor business."""
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin can resend invites")
        u = await db.users.find_one({"vendor_id": vendor_id, "role": "vendor"})
        if not u:
            raise HTTPException(status_code=404, detail="No vendor login user is linked to this vendor yet")
        ok = _send_invitation_safe(u["email"], u.get("name", ""), "vendor")
        if not ok:
            raise HTTPException(status_code=502, detail="Could not send invite email")
        return {"sent": True, "email": u["email"]}

    @r.get("/admin/admins")
    async def list_admins(user: dict = Depends(get_current_user)):
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin can list admins")
        admins = await db.users.find(
            {"role": {"$in": ["master_admin", "super_admin", "site_admin", "city_admin"]}},
            {"_id": 1, "email": 1, "name": 1, "role": 1, "site_id": 1, "city_id": 1, "assigned_sites": 1, "created_at": 1}
        ).to_list(1000)
        out_admins = []
        for a in admins:
            doc = {**a}
            doc["id"] = str(doc.pop("_id"))
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            out_admins.append(doc)
        return out_admins

    @r.delete("/admin/admins/{admin_id}")
    async def delete_admin(admin_id: str, user: dict = Depends(get_current_user)):
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Only master admin can delete admins")
        admin = await db.users.find_one({"_id": safe_objectid(admin_id, "Admin"), "role": {"$in": ["super_admin", "site_admin", "master_admin", "city_admin"]}})
        if not admin:
            raise HTTPException(status_code=404, detail="Admin not found")
        if admin.get("email") == os.environ.get("ADMIN_EMAIL", "admin@cravitoo.com"):
            raise HTTPException(status_code=400, detail="Cannot delete the seed master admin")
        await db.users.delete_one({"_id": safe_objectid(admin_id, "Admin")})
        return {"message": "Admin deleted"}

    # Reports
    @r.get("/reports/master-dashboard")
    async def master_dashboard(user: dict = Depends(get_current_user)):
        if not is_master_admin(user):
            raise HTTPException(status_code=403, detail="Master admin only")
        total_sites = await db.sites.count_documents({"status": "active"})
        total_vendors = await db.vendors.count_documents({"status": "active"})
        total_users = await db.users.count_documents({})
        total_employees = await db.users.count_documents({"role": "employee"})
        total_orders = await db.orders.count_documents({})
        paid_orders = await db.orders.count_documents({"payment_status": "paid"})
    
        rev_pipe = [
            {"$match": {"payment_status": "paid"}},
            {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}}
        ]
        rev = await db.orders.aggregate(rev_pipe).to_list(1)
        total_revenue = rev[0]["total"] if rev else 0
    
        # Top sites
        site_pipe = [
            {"$match": {"payment_status": "paid", "site_id": {"$exists": True, "$ne": None}}},
            {"$group": {"_id": "$site_id", "orders": {"$sum": 1}, "revenue": {"$sum": "$total_amount"}}},
            {"$sort": {"revenue": -1}},
            {"$limit": 5}
        ]
        top_sites_raw = await db.orders.aggregate(site_pipe).to_list(5)
        top_sites = []
        for ts in top_sites_raw:
            if not ts.get("_id") or not ObjectId.is_valid(ts["_id"]):
                continue
            site = await db.sites.find_one({"_id": ObjectId(ts["_id"])})
            if site:
                top_sites.append({
                    "site_id": ts["_id"],
                    "name": site.get("name", "Unknown"),
                    "orders": ts["orders"],
                    "revenue": ts["revenue"],
                })
    
        # Top vendors
        vendor_pipe = [
            {"$match": {"payment_status": "paid"}},
            {"$group": {"_id": "$vendor_id", "orders": {"$sum": 1}, "revenue": {"$sum": "$total_amount"}}},
            {"$sort": {"revenue": -1}},
            {"$limit": 5}
        ]
        top_vendors_raw = await db.orders.aggregate(vendor_pipe).to_list(5)
        top_vendors = []
        for tv in top_vendors_raw:
            if not tv.get("_id") or not ObjectId.is_valid(tv["_id"]):
                continue
            vendor = await db.vendors.find_one({"_id": ObjectId(tv["_id"])})
            if vendor:
                top_vendors.append({
                    "vendor_id": tv["_id"],
                    "name": vendor.get("name", "Unknown"),
                    "orders": tv["orders"],
                    "revenue": tv["revenue"],
                })
    
        return {
            "total_sites": total_sites,
            "total_vendors": total_vendors,
            "total_users": total_users,
            "total_employees": total_employees,
            "total_orders": total_orders,
            "paid_orders": paid_orders,
            "total_revenue": round(total_revenue, 2),
            "top_sites": top_sites,
            "top_vendors": top_vendors,
        }

    @r.get("/reports/site/{site_id}")
    async def site_report(site_id: str, user: dict = Depends(get_current_user)):
        if not can_access_site(user, site_id):
            raise HTTPException(status_code=403, detail="Access denied")
        total_orders = await db.orders.count_documents({"site_id": site_id})
        paid_orders = await db.orders.count_documents({"site_id": site_id, "payment_status": "paid"})
        rev_pipe = [
            {"$match": {"site_id": site_id, "payment_status": "paid"}},
            {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}}
        ]
        rev = await db.orders.aggregate(rev_pipe).to_list(1)
        total_revenue = rev[0]["total"] if rev else 0
    
        # By vendor
        by_vendor_pipe = [
            {"$match": {"site_id": site_id, "payment_status": "paid"}},
            {"$group": {"_id": "$vendor_id", "orders": {"$sum": 1}, "revenue": {"$sum": "$total_amount"}}},
            {"$sort": {"revenue": -1}}
        ]
        by_vendor_raw = await db.orders.aggregate(by_vendor_pipe).to_list(100)
        by_vendor = []
        for bv in by_vendor_raw:
            vendor = await db.vendors.find_one({"_id": safe_objectid(bv["_id"], "Vendor")})
            if vendor:
                by_vendor.append({
                    "vendor_id": bv["_id"],
                    "name": vendor.get("name", "Unknown"),
                    "orders": bv["orders"],
                    "revenue": round(bv["revenue"], 2),
                })
    
        employees_at_site = await db.users.count_documents({"site_id": site_id, "role": "employee"})
    
        return {
            "site_id": site_id,
            "total_orders": total_orders,
            "paid_orders": paid_orders,
            "total_revenue": round(total_revenue, 2),
            "employees": employees_at_site,
            "vendors": by_vendor,
        }

    # Add site_id to order creation
    @r.get("/employee/my-site")
    async def get_my_site(user: dict = Depends(get_current_user)):
        """Helper for employee app: returns the employee's site + vendors + meal schedule + ordering options."""
        if user.get("role") != "employee":
            raise HTTPException(status_code=403, detail="Employee only")
        site_id = user.get("site_id")
        if not site_id:
            raise HTTPException(status_code=404, detail="No site assigned to your account")
        site = await db.sites.find_one({"_id": safe_objectid(site_id, "Site")})
        if not site:
            raise HTTPException(status_code=404, detail="Site not found")
        site["id"] = str(site.pop("_id"))
        if isinstance(site.get("created_at"), datetime):
            site["created_at"] = site["created_at"].isoformat()
        schedule = await db.meal_schedules.find_one({"site_id": site_id})
        schedules = schedule.get("schedules", []) if schedule else []
        current_period = current_meal_period(schedules)
    
        mappings = await db.vendor_site_mappings.find({"site_id": site_id, "status": "active"}).to_list(500)
        vendor_ids = [safe_objectid(m["vendor_id"], "Vendor") for m in mappings]
        vendors = []
        if vendor_ids:
            vlist = await db.vendors.find({"_id": {"$in": vendor_ids}, "status": "active"}).to_list(500)
            for v in vlist:
                v["id"] = str(v.pop("_id"))
                vendors.append(v)
    
        return {
            "site": site,
            "vendors": vendors,
            "meal_schedule": schedules,
            "current_meal_period": current_period,
            "ordering_modes": {
                "pre_order": site.get("allow_pre_order", True),
                "cash_carry": site.get("allow_cash_carry", True),
                "company_paid": site.get("allow_company_paid", False),
                "employee_paid": site.get("allow_employee_paid", True),
            },
        }

    return r
