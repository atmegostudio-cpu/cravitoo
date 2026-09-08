"""Seed a small DEMO hierarchy (Client -> City -> Site -> Vendor -> Orders)
so the Admin Sales Report cascading filters can be demonstrated & tested in
preview. All docs are name-prefixed 'DEMO ' and the script is idempotent
(it purges prior DEMO rows before re-inserting). Production DB is untouched.

Run: python3 scripts/seed_sales_report_demo.py
"""
import asyncio
import os
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # --- purge prior DEMO data (idempotent) -------------------------------
    demo_companies = [c async for c in db.companies.find({"name": {"$regex": "^DEMO "}})]
    demo_cities = [c async for c in db.cities.find({"name": {"$regex": "^DEMO "}})]
    demo_sites = [s async for s in db.sites.find({"name": {"$regex": "^DEMO "}})]
    demo_vendors = [v async for v in db.vendors.find({"name": {"$regex": "^DEMO "}})]
    old_site_ids = [str(s["_id"]) for s in demo_sites]
    old_vendor_ids = [str(v["_id"]) for v in demo_vendors]
    await db.orders.delete_many({"$or": [{"site_id": {"$in": old_site_ids}},
                                          {"vendor_id": {"$in": old_vendor_ids}},
                                          {"collection_code": {"$regex": "^DEMO-"}}]})
    await db.vendor_site_mappings.delete_many({"$or": [{"site_id": {"$in": old_site_ids}},
                                                        {"vendor_id": {"$in": old_vendor_ids}}]})
    await db.companies.delete_many({"name": {"$regex": "^DEMO "}})
    await db.cities.delete_many({"name": {"$regex": "^DEMO "}})
    await db.sites.delete_many({"name": {"$regex": "^DEMO "}})
    await db.vendors.delete_many({"name": {"$regex": "^DEMO "}})

    now = datetime.now(timezone.utc)

    # --- clients (companies) ---------------------------------------------
    acme = (await db.companies.insert_one({"name": "DEMO Acme Corp", "status": "active",
                                            "lifecycle_status": "active", "created_at": now})).inserted_id
    globex = (await db.companies.insert_one({"name": "DEMO Globex Ltd", "status": "active",
                                              "lifecycle_status": "active", "created_at": now})).inserted_id

    # --- cities -----------------------------------------------------------
    blr = (await db.cities.insert_one({"name": "DEMO Bengaluru", "state": "Karnataka",
                                        "country": "India", "status": "active"})).inserted_id
    mum = (await db.cities.insert_one({"name": "DEMO Mumbai", "state": "Maharashtra",
                                        "country": "India", "status": "active"})).inserted_id

    # --- sites ------------------------------------------------------------
    def site_doc(name, company_id, city_id, city):
        return {"name": name, "company_id": str(company_id), "city_id": str(city_id),
                "city": city, "address": name, "status": "active",
                "lifecycle_status": "live", "created_at": now}

    acme_blr = (await db.sites.insert_one(site_doc("DEMO Acme Bengaluru HQ", acme, blr, "DEMO Bengaluru"))).inserted_id
    acme_mum = (await db.sites.insert_one(site_doc("DEMO Acme Mumbai Office", acme, mum, "DEMO Mumbai"))).inserted_id
    globex_blr = (await db.sites.insert_one(site_doc("DEMO Globex Bengaluru", globex, blr, "DEMO Bengaluru"))).inserted_id

    # --- vendors ----------------------------------------------------------
    spice = (await db.vendors.insert_one({"name": "DEMO Spice Hub", "status": "active", "created_at": now})).inserted_id
    green = (await db.vendors.insert_one({"name": "DEMO Green Bowl", "status": "active", "created_at": now})).inserted_id
    wok = (await db.vendors.insert_one({"name": "DEMO Wok Express", "status": "active", "created_at": now})).inserted_id

    # --- vendor <-> site mappings (active) --------------------------------
    async def mapping(vendor_id, site_id):
        await db.vendor_site_mappings.insert_one({"vendor_id": str(vendor_id), "site_id": str(site_id),
                                                   "status": "active", "created_at": now})

    await mapping(spice, acme_blr)
    await mapping(green, acme_blr)
    await mapping(spice, acme_mum)
    await mapping(wok, globex_blr)

    # --- orders -----------------------------------------------------------
    # (site, company, vendor, day, amount)
    plan = [
        (acme_blr, acme, spice, 2, 250.0),
        (acme_blr, acme, spice, 4, 180.0),
        (acme_blr, acme, green, 4, 320.0),
        (acme_blr, acme, green, 7, 140.0),
        (acme_mum, acme, spice, 5, 500.0),
        (acme_mum, acme, spice, 9, 260.0),
        (acme_mum, acme, spice, 12, 410.0),
        (globex_blr, globex, wok, 3, 600.0),
        (globex_blr, globex, wok, 8, 275.0),
        (globex_blr, globex, wok, 14, 190.0),
        (acme_blr, acme, spice, 16, 330.0),
        (globex_blr, globex, wok, 18, 220.0),
    ]
    n = 0
    for site_id, company_id, vendor_id, day, amount in plan:
        n += 1
        created = datetime(2026, 6, day, 6, 30, tzinfo=timezone.utc)
        await db.orders.insert_one({
            "employee_name": "DEMO Employee",
            "employee_email": "demo.employee@example.com",
            "vendor_id": str(vendor_id),
            "site_id": str(site_id),
            "company_id": str(company_id),
            "items": [{"name": "DEMO Meal", "quantity": 1, "price": amount}],
            "total_amount": amount,
            "status": "confirmed",
            "payment_status": "paid",
            "payment_mode": "RAZORPAY",
            "payment_method": "razorpay",
            "collection_code": f"DEMO-{n:04d}",
            "created_at": created,
            "paid_at": created,
        })

    print(f"Seeded: 2 clients, 2 cities, 3 sites, 3 vendors, 4 mappings, {n} orders (June 2026).")
    grand = sum(p[4] for p in plan)
    print(f"DEMO grand total = Rs {grand:.2f}")


if __name__ == "__main__":
    asyncio.run(main())
