"""One-off purge of leftover legacy TEST/demo data from the preview DB.

Preserves: master admin (admin@cravitoo.com) and the clean AUDIT_* hierarchy
(AUDIT_CorpA/B, AUDIT_SiteA/B, AUDIT_City, AUDIT_Vendor1/2 + audit_* users).
Deletes: TEST_/GateTest_/LCTest_/LCFlow_ sites, TEST_Corp company, TEST cities,
TEST__vendor_* vendors, and their orphan users/logins + all child records.
"""
import asyncio
import os

from bson import ObjectId
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

SITE_PREFIXES = ("TEST_Site", "LCTest", "GateTest", "LCFlow")
COMPANY_PREFIXES = ("TEST_Corp",)
CITY_PREFIXES = ("TESTCITY", "TEST_alrg_City")
VENDOR_PREFIXES = ("TEST__vendor",)
USER_EMAILS = {
    "reg-e0d561@techcorp.com", "u2@lcflow-7be658.com", "qa_employee@gatetest.com",
    "nosite_emp@corpa.com", "domainemp@domaintest.com",
    "test_cityadmin_a2be17@cravitoo.com",
}


def _pref(name, prefixes):
    return any((name or "").startswith(p) for p in prefixes)


async def main():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]

    sites = [s async for s in db.sites.find({}, {"name": 1})]
    companies = [s async for s in db.companies.find({}, {"name": 1})]
    cities = [s async for s in db.cities.find({}, {"name": 1})]
    vendors = [s async for s in db.vendors.find({}, {"name": 1})]

    site_ids = [str(s["_id"]) for s in sites if _pref(s.get("name"), SITE_PREFIXES)]
    company_ids = [str(s["_id"]) for s in companies if _pref(s.get("name"), COMPANY_PREFIXES)]
    city_ids = [str(s["_id"]) for s in cities if _pref(s.get("name"), CITY_PREFIXES)]
    vendor_ids = [str(s["_id"]) for s in vendors if _pref(s.get("name"), VENDOR_PREFIXES)]

    # users: explicit emails + all test vendor logins (approve_*@example.com)
    users = [u async for u in db.users.find({}, {"email": 1, "role": 1})]
    del_users = [u for u in users
                 if u.get("email") in USER_EMAILS
                 or (u.get("role") == "vendor" and (u.get("email") or "").startswith("approve_") and "@example.com" in (u.get("email") or ""))]
    del_user_ids = [str(u["_id"]) for u in del_users]
    del_user_emails = [u.get("email") for u in del_users]

    def oids(id_list):
        out = []
        for i in id_list:
            try:
                out.append(ObjectId(i))
            except Exception:
                pass
        return out

    print("Targets:")
    print(f"  sites={len(site_ids)} companies={len(company_ids)} cities={len(city_ids)} vendors={len(vendor_ids)} users={len(del_user_ids)}")

    counts = {}

    # Child records referencing target sites OR vendors
    site_vendor_filter = {"$or": [{"site_id": {"$in": site_ids}}, {"vendor_id": {"$in": vendor_ids}}]}
    for col in ("menu_items", "vendor_site_mappings", "reservations", "meal_schedules",
                "menu_upload_requests", "menu_versions"):
        counts[col] = (await db[col].delete_many(site_vendor_filter)).deleted_count

    # Orders: by site, vendor, or ordering user
    order_filter = {"$or": [{"site_id": {"$in": site_ids}}, {"vendor_id": {"$in": vendor_ids}},
                            {"user_id": {"$in": del_user_ids}}]}
    order_ids = [str(o["_id"]) async for o in db.orders.find(order_filter, {"_id": 1})]
    counts["orders"] = (await db.orders.delete_many(order_filter)).deleted_count
    counts["order_status_history"] = (await db.order_status_history.delete_many({"order_id": {"$in": order_ids}})).deleted_count

    # allowed_domains + vendor_onboarding referencing targets
    ad_filter = {"$or": [{"site_id": {"$in": site_ids}}, {"company_id": {"$in": company_ids}}]}
    counts["allowed_domains"] = (await db.allowed_domains.delete_many(ad_filter)).deleted_count
    vo_filter = {"$or": [{"site_id": {"$in": site_ids}}, {"vendor_id": {"$in": vendor_ids}}, {"company_id": {"$in": company_ids}}]}
    counts["vendor_onboarding"] = (await db.vendor_onboarding.delete_many(vo_filter)).deleted_count

    # The primary docs + users
    counts["users"] = (await db.users.delete_many({"email": {"$in": del_user_emails}})).deleted_count
    counts["vendors"] = (await db.vendors.delete_many({"_id": {"$in": oids(vendor_ids)}})).deleted_count
    counts["sites"] = (await db.sites.delete_many({"_id": {"$in": oids(site_ids)}})).deleted_count
    counts["companies"] = (await db.companies.delete_many({"_id": {"$in": oids(company_ids)}})).deleted_count
    counts["cities"] = (await db.cities.delete_many({"_id": {"$in": oids(city_ids)}})).deleted_count

    print("Deleted counts:")
    for k, v in counts.items():
        print(f"  {k}: {v}")

    print("\nRemaining:")
    for col in ("companies", "cities", "sites", "vendors", "users", "orders"):
        print(f"  {col}: {await db[col].count_documents({})}")


asyncio.run(main())
