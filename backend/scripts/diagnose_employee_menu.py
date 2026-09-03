"""READ-ONLY diagnostic: why is the menu empty for some employees?

Lists, per employee, whether they have a site, whether that site exists, and
how many ACTIVE vendor mappings their site has — plus allowed_domains rules
missing a site_id (the usual root cause). Makes no changes.
"""
import asyncio
import os

from bson import ObjectId
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()


def oid(s):
    try:
        return ObjectId(s)
    except Exception:
        return None


async def main():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]

    site_ids = {str(s["_id"]) async for s in db.sites.find({}, {"_id": 1})}
    # active mapping count per site
    active_by_site = {}
    async for m in db.vendor_site_mappings.find({"status": "active"}, {"site_id": 1}):
        active_by_site[m.get("site_id")] = active_by_site.get(m.get("site_id"), 0) + 1

    employees = [u async for u in db.users.find({"role": "employee"}, {"email": 1, "site_id": 1, "company_id": 1})]
    print(f"=== EMPLOYEES ({len(employees)}) ===")
    no_site = wrong_site = no_vendors = ok = 0
    for u in employees:
        sid = u.get("site_id")
        if not sid:
            no_site += 1
            print(f"  [NO SITE]      {u.get('email')}  company={u.get('company_id')}")
        elif sid not in site_ids:
            wrong_site += 1
            print(f"  [SITE MISSING] {u.get('email')}  site_id={sid} (site does not exist)")
        elif active_by_site.get(sid, 0) == 0:
            no_vendors += 1
            print(f"  [0 VENDORS]    {u.get('email')}  site_id={sid} has no active vendor mappings")
        else:
            ok += 1
    print(f"\n  summary: ok={ok} no_site={no_site} site_missing={wrong_site} zero_vendors={no_vendors}")

    print("\n=== allowed_domains rules ===")
    total = missing = 0
    async for d in db.allowed_domains.find({}):
        total += 1
        if not d.get("site_id"):
            missing += 1
            print(f"  [NO site_id] domain={d.get('domain') or d.get('email')} company={d.get('company_id')}")
    print(f"  domains total={total} missing_site_id={missing}")

    print("\n=== menu availability spot-check (vendors with 0 available items) ===")
    async for v in db.vendors.find({"status": "active"}, {"name": 1}):
        vid = str(v["_id"])
        total_items = await db.menu_items.count_documents({"vendor_id": vid})
        avail = await db.menu_items.count_documents({"vendor_id": vid, "is_available": True})
        if total_items > 0 and avail == 0:
            print(f"  [ALL UNAVAILABLE] {v.get('name')} ({total_items} items, 0 available)")


asyncio.run(main())
