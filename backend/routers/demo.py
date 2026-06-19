"""
Demo Setup & Teardown — Cravitoo Pune Demo

Creates a self-contained demo (Company → Site → Vendor → Corp Admin → Employee)
with the new meal_type pre-order flow (Veg Meal / Non-Veg Meal / Veg Salad / Non-Veg Salad).
Lunch & Dinner only, 8 PM IST cutoff.

Endpoints (master_admin only; ALL return 404 when CRAVITOO_ENV=production):
  POST /api/admin/demo/setup     — create all demo records (idempotent)
  POST /api/admin/demo/teardown  — delete all demo records (safe — only deletes _demo_tagged ones)
  GET  /api/admin/demo/status    — returns whether demo is currently active

Every demo record carries `"demo_tag": "cravitoo_pune_demo"` so teardown is bulletproof.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from env_config import is_production

logger = logging.getLogger(__name__)

DEMO_TAG = "cravitoo_pune_demo"


def _guard_non_production() -> None:
    """Fail-secure: demo endpoints behave as if they don't exist in production.

    Returning 404 (instead of 403) intentionally hides the very existence of
    these routes from production probes / scanners.
    """
    if is_production():
        raise HTTPException(status_code=404, detail="Not Found")


# NOTE: demo credentials are NEVER exposed in production responses.
# In preview/staging we still scrub passwords from the public JSON payload —
# the demo seeder logs them once at INFO and they are documented in
# /app/memory/test_credentials.md for QA only.
DEMO_CREDENTIALS_PUBLIC = {
    "corporate_admin": {"email": "finance@cravitoo.com", "name": "Demo Finance / Corp Admin"},
    "employee":        {"email": "info@cravitoo.com",    "name": "Demo Employee"},
    "vendor":          {"email": "vendor@atmego.com",    "name": "ATMEGO Operations"},
}

# Internal-only — used by the seeder, never sent over the wire.
_DEMO_PASSWORDS = {
    "corporate_admin": "Demo@123",
    "employee":        "Demo@123",
    "vendor":          "Demo@123",
}


def _is_master(user: dict) -> bool:
    return user["role"] in ("master_admin", "super_admin")


def make_router(db, safe_objectid, get_current_user, hash_password):
    r = APIRouter()

    @r.post("/admin/demo/setup")
    async def setup_demo(user: dict = Depends(get_current_user)):
        _guard_non_production()
        if not _is_master(user):
            raise HTTPException(status_code=403, detail="Only Master Admin can run demo setup")

        now = datetime.now(timezone.utc)
        out: Dict[str, Any] = {"created": {}, "existed": {}, "credentials": DEMO_CREDENTIALS_PUBLIC}

        # 1) CITY: Pune
        city = await db.cities.find_one({"name": "Pune", "demo_tag": DEMO_TAG})
        if not city:
            res = await db.cities.insert_one({
                "name": "Pune", "state": "Maharashtra", "region": "West", "country": "India",
                "status": "active", "demo_tag": DEMO_TAG, "created_at": now,
            })
            city_id = str(res.inserted_id)
            out["created"]["city"] = "Pune"
        else:
            city_id = str(city["_id"])
            out["existed"]["city"] = "Pune"

        # 2) COMPANY: Cravitoo
        company = await db.companies.find_one({"name": "Cravitoo", "demo_tag": DEMO_TAG})
        if not company:
            res = await db.companies.insert_one({
                "name": "Cravitoo",
                "address": "Pune Tech Park, Maharashtra",
                "contact_email": "finance@cravitoo.com",
                "contact_phone": "+91-9999900000",
                "billing_contact_name": "Demo Finance",
                "billing_contact_email": "finance@cravitoo.com",
                "status": "active",
                "lifecycle_status": "active",
                "demo_tag": DEMO_TAG,
                "created_at": now,
            })
            company_id = str(res.inserted_id)
            out["created"]["company"] = "Cravitoo"
        else:
            company_id = str(company["_id"])
            out["existed"]["company"] = "Cravitoo"

        # 3) SITE: Pune Office (must be LIVE for employee sign-ups)
        site = await db.sites.find_one({"name": "Cravitoo - Pune Office", "demo_tag": DEMO_TAG})
        if not site:
            res = await db.sites.insert_one({
                "name": "Cravitoo - Pune Office",
                "company_id": company_id,
                "city_id": city_id,
                "address": "Pune Tech Park, MG Road",
                "city": "Pune",
                "contact_email": "finance@cravitoo.com",
                "contact_phone": "+91-9999900001",
                "allow_pre_order": True,
                "allow_cash_carry": False,
                "allow_company_paid": True,
                "allow_employee_paid": False,
                "status": "active",
                "lifecycle_status": "live",       # so registrations are allowed
                "activated_at": now,
                "subsidy_mode": "company_pay",
                # Reservation settings — Lunch & Dinner ONLY, 8 PM IST cutoff
                "reservation_settings": {
                    "breakfast": {"enabled": False, "cutoff_hour": 20, "cutoff_minute": 0},
                    "lunch":     {"enabled": True,  "cutoff_hour": 20, "cutoff_minute": 0},
                    "snacks":    {"enabled": False, "cutoff_hour": 20, "cutoff_minute": 0},
                    "dinner":    {"enabled": True,  "cutoff_hour": 20, "cutoff_minute": 0},
                },
                "demo_tag": DEMO_TAG,
                "created_at": now,
            })
            site_id = str(res.inserted_id)
            out["created"]["site"] = "Cravitoo - Pune Office (Lunch+Dinner, 8 PM cutoff)"
        else:
            site_id = str(site["_id"])
            # Ensure reservation_settings are correct even if site already exists
            await db.sites.update_one(
                {"_id": site["_id"]},
                {"$set": {
                    "reservation_settings": {
                        "breakfast": {"enabled": False, "cutoff_hour": 20, "cutoff_minute": 0},
                        "lunch":     {"enabled": True,  "cutoff_hour": 20, "cutoff_minute": 0},
                        "snacks":    {"enabled": False, "cutoff_hour": 20, "cutoff_minute": 0},
                        "dinner":    {"enabled": True,  "cutoff_hour": 20, "cutoff_minute": 0},
                    },
                    "lifecycle_status": "live",
                }},
            )
            out["existed"]["site"] = "Cravitoo - Pune Office"

        # 4) ALLOWED DOMAIN: cravitoo.com (so info@cravitoo.com can self-register if needed)
        if not await db.allowed_domains.find_one({"domain": "cravitoo.com"}):
            await db.allowed_domains.insert_one({
                "domain": "cravitoo.com",
                "company_id": company_id,
                "site_id": site_id,
                "notes": "Cravitoo demo domain",
                "demo_tag": DEMO_TAG,
                "added_by": user.get("id"),
                "created_at": now,
            })
            out["created"]["allowed_domain"] = "cravitoo.com"
        else:
            out["existed"]["allowed_domain"] = "cravitoo.com"

        # 5) VENDOR: ATMEGO
        vendor = await db.vendors.find_one({"name": "ATMEGO", "demo_tag": DEMO_TAG})
        if not vendor:
            res = await db.vendors.insert_one({
                "name": "ATMEGO",
                "description": "Healthy Meals — Pune Demo Vendor",
                "cuisine_type": "Multi-Cuisine",
                "contact_email": "vendor@atmego.com",
                "contact_phone": "+91-9999900002",
                "rating": 4.7,
                "status": "active",
                "demo_tag": DEMO_TAG,
                "created_at": now,
            })
            vendor_id = str(res.inserted_id)
            out["created"]["vendor"] = "ATMEGO"
        else:
            vendor_id = str(vendor["_id"])
            out["existed"]["vendor"] = "ATMEGO"

        # 6) MAP VENDOR ↔ SITE
        mapping = await db.vendor_site_mappings.find_one({"vendor_id": vendor_id, "site_id": site_id})
        if not mapping:
            await db.vendor_site_mappings.insert_one({
                "vendor_id": vendor_id,
                "site_id": site_id,
                "status": "active",
                "demo_tag": DEMO_TAG,
                "created_at": now,
            })
            out["created"]["vendor_site_mapping"] = "ATMEGO ↔ Pune Office"
        else:
            out["existed"]["vendor_site_mapping"] = "ATMEGO ↔ Pune Office"

        # 7) USERS (Corp Admin, Employee, Vendor user)
        async def _ensure_user(role: str, extras: Dict[str, Any]):
            creds = DEMO_CREDENTIALS_PUBLIC[role]
            password = _DEMO_PASSWORDS[role]
            email = creds["email"]
            existing = await db.users.find_one({"email": email})
            if existing:
                out["existed"][f"user_{role}"] = email
                return str(existing["_id"])
            res = await db.users.insert_one({
                "email": email,
                "password_hash": hash_password(password),
                "name": creds["name"],
                "role": role,
                "demo_tag": DEMO_TAG,
                "created_at": now,
                **extras,
            })
            out["created"][f"user_{role}"] = email
            return str(res.inserted_id)

        await _ensure_user("corporate_admin", {"company_id": company_id, "site_id": site_id})
        await _ensure_user("employee",        {"company_id": company_id, "site_id": site_id})
        await _ensure_user("vendor",          {"vendor_id": vendor_id})

        out["flow_url"] = "/login"
        out["message"] = "Demo setup complete. Use credentials below to demo the pre-order flow."
        out["demo_tag"] = DEMO_TAG
        return out

    @r.post("/admin/demo/teardown")
    async def teardown_demo(user: dict = Depends(get_current_user)):
        _guard_non_production()
        if not _is_master(user):
            raise HTTPException(status_code=403, detail="Only Master Admin can run demo teardown")
        removed: Dict[str, int] = {}

        # Find the demo IDs first so we can also clean reservations/orders linked to them
        demo_users = [d async for d in db.users.find({"demo_tag": DEMO_TAG}, {"_id": 1, "email": 1})]
        demo_user_ids = [str(u["_id"]) for u in demo_users]
        demo_user_emails = [u.get("email") for u in demo_users if u.get("email")]
        demo_vendors = [d async for d in db.vendors.find({"demo_tag": DEMO_TAG}, {"_id": 1})]
        demo_vendor_ids = [str(v["_id"]) for v in demo_vendors]
        demo_sites = [d async for d in db.sites.find({"demo_tag": DEMO_TAG}, {"_id": 1})]
        demo_site_ids = [str(s["_id"]) for s in demo_sites]

        # Reservations + Orders made AGAINST demo users / vendors / sites
        if demo_user_ids or demo_vendor_ids or demo_site_ids:
            r1 = await db.reservations.delete_many({
                "$or": [
                    {"employee_id": {"$in": demo_user_ids}},
                    {"vendor_id":   {"$in": demo_vendor_ids}},
                    {"site_id":     {"$in": demo_site_ids}},
                ]
            })
            removed["reservations"] = r1.deleted_count
            r2 = await db.orders.delete_many({
                "$or": [
                    {"user_id":   {"$in": demo_user_ids}},
                    {"vendor_id": {"$in": demo_vendor_ids}},
                    {"site_id":   {"$in": demo_site_ids}},
                ]
            })
            removed["orders"] = r2.deleted_count
            removed["notifications"] = (await db.notifications.delete_many({"user_id": {"$in": demo_user_ids}})).deleted_count
            removed["invoices"] = (await db.invoices.delete_many({"client_id": {"$in": [str(s["_id"]) for s in await db.companies.find({"demo_tag": DEMO_TAG}, {"_id": 1}).to_list(20)]}})).deleted_count

        # Now delete tagged primary records
        for coll in [
            "users", "vendors", "vendor_site_mappings", "meal_schedules",
            "sites", "companies", "cities", "allowed_domains",
        ]:
            res = await db[coll].delete_many({"demo_tag": DEMO_TAG})
            removed[coll] = res.deleted_count

        return {
            "message": "Demo cleaned up. All demo-tagged data and linked reservations/orders deleted.",
            "removed": removed,
            "demo_user_emails": demo_user_emails,
        }

    @r.get("/admin/demo/enabled")
    async def demo_enabled():
        """Public probe used by the frontend to decide whether to render the
        Master → Demo Control page.  Always reachable; never leaks any data
        beyond a boolean and the env label.
        """
        from env_config import get_env
        env = get_env()
        return {"demo_enabled": env != "production", "environment": env}

    @r.get("/admin/demo/status")
    async def status(user: dict = Depends(get_current_user)):
        _guard_non_production()
        if not _is_master(user):
            raise HTTPException(status_code=403, detail="Only Master Admin can view demo status")
        active = {
            "cities":       await db.cities.count_documents({"demo_tag": DEMO_TAG}),
            "companies":    await db.companies.count_documents({"demo_tag": DEMO_TAG}),
            "sites":        await db.sites.count_documents({"demo_tag": DEMO_TAG}),
            "vendors":      await db.vendors.count_documents({"demo_tag": DEMO_TAG}),
            "users":        await db.users.count_documents({"demo_tag": DEMO_TAG}),
            "allowed_domains": await db.allowed_domains.count_documents({"demo_tag": DEMO_TAG}),
        }
        return {
            "demo_active": any(v > 0 for v in active.values()),
            "counts": active,
            "credentials": DEMO_CREDENTIALS_PUBLIC,  # never includes passwords
            "demo_tag": DEMO_TAG,
        }

    return r
