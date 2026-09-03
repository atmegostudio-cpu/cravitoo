"""Temporary scenario to validate the empty-menu diagnostic + backfill + UI empty-state."""
import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bson import ObjectId
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

from server import hash_password  # type: ignore

load_dotenv()
PWD = "Diag#1234"


async def main():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]

    # Single-site company
    corp1 = (await db.companies.insert_one({"name": "DIAG_Corp", "created_at": datetime.now(timezone.utc)})).inserted_id
    site1 = (await db.sites.insert_one({"name": "DIAG_Site", "company_id": str(corp1), "lifecycle_status": "live", "created_at": datetime.now(timezone.utc)})).inserted_id
    vend1 = (await db.vendors.insert_one({"name": "DIAG_Vendor", "status": "active", "created_at": datetime.now(timezone.utc)})).inserted_id
    await db.vendor_site_mappings.insert_one({"vendor_id": str(vend1), "site_id": str(site1), "status": "active", "created_at": datetime.now(timezone.utc)})
    await db.menu_items.insert_one({"vendor_id": str(vend1), "site_id": str(site1), "name": "Diag Dish", "price": 100, "category": "Main", "is_available": True, "is_vegetarian": True, "meal_periods": ["lunch"], "created_at": datetime.now(timezone.utc)})

    # Multi-site company (2 sites) → backfill can't auto-resolve
    corp2 = (await db.companies.insert_one({"name": "DIAG_MultiCorp", "created_at": datetime.now(timezone.utc)})).inserted_id
    await db.sites.insert_one({"name": "DIAG_MSiteA", "company_id": str(corp2), "lifecycle_status": "live", "created_at": datetime.now(timezone.utc)})
    await db.sites.insert_one({"name": "DIAG_MSiteB", "company_id": str(corp2), "lifecycle_status": "live", "created_at": datetime.now(timezone.utc)})

    # domain missing site_id
    await db.allowed_domains.insert_one({"domain": "diag.com", "company_id": str(corp1), "created_at": datetime.now(timezone.utc)})

    async def emp(email, company_id, site_id=None):
        doc = {"email": email, "password_hash": hash_password(PWD), "name": email.split("@")[0], "role": "employee", "company_id": company_id, "created_at": datetime.now(timezone.utc)}
        if site_id:
            doc["site_id"] = site_id
        await db.users.insert_one(doc)

    await emp("diag_single@diag.com", str(corp1))          # no site, single-site company → backfill fixes
    await emp("diag_multi@diag.com", str(corp2))            # no site, multi-site company → unresolved → empty-state
    await emp("diag_zero@diag.com", str(corp1), site_id=str(site1))  # has site w/ vendor (control - should see menu)

    print("scenario seeded. password:", PWD)
    print("  corp1(single-site) DIAG_Corp site=", str(site1), "vendor=", str(vend1))
    print("  employees: diag_single@diag.com(no site), diag_multi@diag.com(no site,multi), diag_zero@diag.com(site set)")


asyncio.run(main())
