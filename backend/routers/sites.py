"""
Sites, Vendor-Site mapping, Meal Schedules, Site Menu, Excel upload,
Admin (site/super/master/city_admin) creation/list/delete, Master/Site reports,
and Employee /my-site — extracted from server.py (iter17 phase 2 refactor).

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
        doc = {
            **data.model_dump(),
            "status": "active",
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
        return {"id": site_id, **data.model_dump()}

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
            if isinstance(s.get("created_at"), datetime):
                s["created_at"] = s["created_at"].isoformat()
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
        if isinstance(out.get("created_at"), datetime):
            out["created_at"] = out["created_at"].isoformat()
        return out

    @r.patch("/sites/{site_id}")
    async def update_site(site_id: str, updates: Dict[str, Any], user: dict = Depends(get_current_user)):
        if not can_access_site(user, site_id):
            raise HTTPException(status_code=403, detail="Access denied")
        allowed = {"name", "address", "city", "city_id", "contact_email", "contact_phone",
                   "allow_pre_order", "allow_cash_carry", "allow_company_paid", "allow_employee_paid"}
        # `status` field can only be changed by master_admin
        if is_master_admin(user):
            allowed = allowed | {"status"}
        cleaned = {k: v for k, v in updates.items() if k in allowed}
        if not cleaned:
            raise HTTPException(status_code=400, detail="No valid fields to update")
        await db.sites.update_one({"_id": safe_objectid(site_id, "Site")}, {"$set": cleaned})
        return {"message": "Site updated"}

    # Vendor-Site Mapping (Master/Super Admin)
    @r.post("/sites/{site_id}/vendors")
    async def map_vendor_to_site(site_id: str, data: VendorSiteMappingCreate, user: dict = Depends(get_current_user)):
        if not can_access_site(user, site_id):
            raise HTTPException(status_code=403, detail="Access denied")
        existing = await db.vendor_site_mappings.find_one({"vendor_id": data.vendor_id, "site_id": site_id})
        if existing:
            raise HTTPException(status_code=400, detail="Vendor already mapped to this site")
        await db.vendor_site_mappings.insert_one({
            "vendor_id": data.vendor_id,
            "site_id": site_id,
            "status": "active",
            "created_at": datetime.now(timezone.utc),
        })
        return {"message": "Vendor mapped to site"}

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
        vendors = await db.vendors.find({"_id": {"$in": vendor_ids}, "status": "active"}).to_list(500)
        out_list = []
        for v in vendors:
            doc = {**v}
            doc["id"] = str(doc.pop("_id"))
            out_list.append(doc)
        return out_list

    @r.delete("/sites/{site_id}/vendors/{vendor_id}")
    async def unmap_vendor(site_id: str, vendor_id: str, user: dict = Depends(get_current_user)):
        if not can_access_site(user, site_id):
            raise HTTPException(status_code=403, detail="Access denied")
        await db.vendor_site_mappings.delete_one({"vendor_id": vendor_id, "site_id": site_id})
        return {"message": "Vendor unmapped"}

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
        file: UploadFile = File(...),
        user: dict = Depends(get_current_user),
    ):
        """Upload an Excel (.xlsx) file with menu items.
        Expected columns: name, description, category, price, is_vegetarian, image_url (optional), meal_periods (comma-separated)
        """
        if not (is_master_admin(user) or can_access_site(user, site_id)):
            raise HTTPException(status_code=403, detail="Access denied")
    
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
    
        inserted = 0
        errors = []
        for i, row in enumerate(rows[1:], start=2):
            try:
                if not row[name_idx]:
                    continue
                meal_periods = ["lunch"]
                if meal_idx is not None and row[meal_idx]:
                    meal_periods = [m.strip().lower() for m in str(row[meal_idx]).split(",") if m.strip()]
                doc = {
                    "vendor_id": vendor_id,
                    "site_id": site_id,
                    "name": str(row[name_idx]).strip(),
                    "description": str(row[desc_idx] or "").strip(),
                    "category": str(row[cat_idx] or "Main Course").strip(),
                    "price": float(row[price_idx] or 0),
                    "is_vegetarian": bool(row[veg_idx]) if veg_idx is not None else True,
                    "is_available": True,
                    "show_price": True,
                    "meal_periods": meal_periods,
                    "image_url": str(row[img_idx]).strip() if img_idx is not None and row[img_idx] else None,
                    "created_at": datetime.now(timezone.utc),
                }
                await db.menu_items.insert_one(doc)
                inserted += 1
            except Exception as e:
                errors.append(f"Row {i}: {str(e)}")
    
        return {"inserted": inserted, "errors": errors, "site_id": site_id, "vendor_id": vendor_id}

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
        return {"id": str(result.inserted_id), "email": email_lower, "role": "site_admin", "site_id": data.site_id}

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
        return {"id": str(result.inserted_id), "email": email_lower, "role": "super_admin", "assigned_sites": data.assigned_sites}

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
        return {"id": str(result.inserted_id), "email": email_lower, "role": "master_admin"}

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
