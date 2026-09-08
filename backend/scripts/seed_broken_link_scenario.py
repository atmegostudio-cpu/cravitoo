"""Seed a broken-link scenario mirroring live Ascendion to test the
/admin/integrity/link-client-site endpoint. Idempotent (purges LINKTEST rows).
Prints the IDs to use in the test curl.
"""
import asyncio
import os
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    # purge
    for coll in ["companies", "cities", "sites", "vendors"]:
        await db[coll].delete_many({"name": {"$regex": "^LINKTEST"}})
    await db.orders.delete_many({"collection_code": {"$regex": "^LINKTEST-"}})
    await db.vendor_site_mappings.delete_many({"note": "LINKTEST"})
    await db.allowed_domains.delete_many({"domain": "linktest.com"})

    now = datetime.now(timezone.utc)
    client = (await db.companies.insert_one({"name": "LINKTEST Client", "status": "active", "created_at": now})).inserted_id  # no city_id (broken)
    city = (await db.cities.insert_one({"name": "LINKTEST City", "status": "active"})).inserted_id
    # site: company_id/city_id both missing (broken), only city string set
    site = (await db.sites.insert_one({"name": "LINKTEST Site", "company_id": None, "city_id": None,
                                       "city": "LINKTEST City", "status": "active", "created_at": now})).inserted_id
    v1 = (await db.vendors.insert_one({"name": "LINKTEST Vendor A", "status": "active", "created_at": now})).inserted_id
    v_orphan = "6a00000000000000deadbeef"  # non-existent vendor -> should be left alone
    await db.vendor_site_mappings.insert_one({"vendor_id": str(v1), "site_id": str(site), "status": "active", "note": "LINKTEST", "created_at": now})
    await db.allowed_domains.insert_one({"domain": "linktest.com", "site_id": str(site), "company_id": None, "city_id": None})

    # orders: 3 with site set but no company; 2 null-site for v1 (recoverable); 1 null-site for orphan (leave alone)
    n = 0
    async def order(vendor_id, site_id, amt):
        nonlocal n
        n += 1
        await db.orders.insert_one({"vendor_id": str(vendor_id), "site_id": (str(site_id) if site_id else None),
                                    "company_id": None, "total_amount": amt, "status": "confirmed",
                                    "payment_status": "paid", "collection_code": f"LINKTEST-{n:03d}",
                                    "created_at": now})
    await order(v1, site, 100); await order(v1, site, 200); await order(v1, site, 150)
    await order(v1, None, 90); await order(v1, None, 60)
    await order(v_orphan, None, 500)

    print("client_id:", client)
    print("site_id:", site)
    print("city_id:", city)
    print("vendor_id (recover):", v1)
    print("Expected: site_fields set, client_city set, domain fields set, orders_company_to_stamp=3, orders_site_to_recover=2 (orphan order untouched)")


if __name__ == "__main__":
    asyncio.run(main())
