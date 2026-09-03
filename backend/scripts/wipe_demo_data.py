"""Wipe ALL demo/test data from the preview DB, keeping only the master admin.

Preserves: users with role 'master_admin'. Empties every operational collection
so the preview starts from a clean slate.
"""
import asyncio
import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

WIPE_COLLECTIONS = [
    "companies", "cities", "sites", "vendors", "vendor_site_mappings",
    "menu_items", "orders", "order_status_history", "reservations",
    "meal_schedules", "menu_upload_requests", "menu_versions",
    "allowed_domains", "vendor_onboarding",
]


async def main():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]

    for col in WIPE_COLLECTIONS:
        n = (await db[col].delete_many({})).deleted_count
        print(f"  {col}: deleted {n}")

    # Users: keep only master admins.
    kept = [u.get("email") async for u in db.users.find({"role": "master_admin"}, {"email": 1})]
    n = (await db.users.delete_many({"role": {"$ne": "master_admin"}})).deleted_count
    print(f"  users: deleted {n}, kept master_admin: {kept}")

    print("\nRemaining:")
    for col in WIPE_COLLECTIONS + ["users"]:
        print(f"  {col}: {await db[col].count_documents({})}")


asyncio.run(main())
