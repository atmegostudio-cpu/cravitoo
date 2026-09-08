"""Targeted removal of the DEV-seeded demo clients 'DEMO Acme Corp' and
'DEMO Globex Ltd' and ALL their related rows (sites, vendors, mappings,
menu_items, orders). Leaves 'Demo Cravitoo', 'Demo Cafeteria Site', TimeFix
data and every other client untouched. Prints before/after counts.
"""
import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

TARGET_CLIENT_NAMES = ["DEMO Acme Corp", "DEMO Globex Ltd"]
TARGET_CITY_NAMES = ["DEMO Bengaluru", "DEMO Mumbai"]


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    companies = [c async for c in db.companies.find({"name": {"$in": TARGET_CLIENT_NAMES}})]
    company_ids = [str(c["_id"]) for c in companies]
    print("Matched clients:", [c["name"] for c in companies] or "NONE")

    # sites belonging to those clients (by company_id) OR clearly-named demo sites
    sites = [s async for s in db.sites.find({"$or": [
        {"company_id": {"$in": company_ids}},
        {"name": {"$regex": "^DEMO (Acme|Globex)"}},
    ]})]
    site_ids = [str(s["_id"]) for s in sites]
    print("Matched demo sites:", [s["name"] for s in sites] or "NONE")

    # demo vendors created by the seed (name-prefixed 'DEMO ')
    vendors = [v async for v in db.vendors.find({"name": {"$regex": "^DEMO "}})]
    vendor_ids = [str(v["_id"]) for v in vendors]
    print("Matched demo vendors:", [v["name"] for v in vendors] or "NONE")

    orders_q = {"$or": [
        {"collection_code": {"$regex": "^DEMO-"}},
        {"site_id": {"$in": site_ids}},
        {"vendor_id": {"$in": vendor_ids}},
    ]}
    n_orders = await db.orders.count_documents(orders_q)
    n_maps = await db.vendor_site_mappings.count_documents({"$or": [
        {"site_id": {"$in": site_ids}}, {"vendor_id": {"$in": vendor_ids}}]})
    n_menu = await db.menu_items.count_documents({"$or": [
        {"site_id": {"$in": site_ids}}, {"vendor_id": {"$in": vendor_ids}}]})
    n_cafes = await db.cafeterias.count_documents({"site_id": {"$in": site_ids}})
    print(f"Related rows -> orders:{n_orders} mappings:{n_maps} menu_items:{n_menu} cafeterias:{n_cafes}")

    # ---- delete ----
    await db.orders.delete_many(orders_q)
    await db.vendor_site_mappings.delete_many({"$or": [
        {"site_id": {"$in": site_ids}}, {"vendor_id": {"$in": vendor_ids}}]})
    await db.menu_items.delete_many({"$or": [
        {"site_id": {"$in": site_ids}}, {"vendor_id": {"$in": vendor_ids}}]})
    await db.cafeterias.delete_many({"site_id": {"$in": site_ids}})
    if site_ids:
        await db.sites.delete_many({"_id": {"$in": [s["_id"] for s in sites]}})
    if vendor_ids:
        await db.vendors.delete_many({"_id": {"$in": [v["_id"] for v in vendors]}})
    if companies:
        await db.companies.delete_many({"_id": {"$in": [c["_id"] for c in companies]}})
    await db.cities.delete_many({"name": {"$in": TARGET_CITY_NAMES}})
    # demo employee inline user (if any)
    await db.users.delete_many({"email": "demo.employee@example.com"})

    print("\n--- REMOVED. Remaining state ---")
    for coll in ["companies", "cities", "sites", "vendors", "orders"]:
        n = await db[coll].count_documents({})
        print(f"{coll}: {n}")
    print("Remaining clients:", [c["name"] async for c in db.companies.find({}, {"name": 1})])


if __name__ == "__main__":
    asyncio.run(main())
