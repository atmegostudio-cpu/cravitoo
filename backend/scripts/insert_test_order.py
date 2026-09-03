import asyncio, os, random
from datetime import datetime, timezone
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import hash_password  # noqa

load_dotenv()

async def main():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"]); db = c[os.environ["DB_NAME"]]
    v = await db.vendors.find_one({"name": "DIAG_Vendor"})
    emp = await db.users.find_one({"email": "diag_zero@diag.com"})
    if not v or not emp:
        print("scenario missing; run scenario_diag.py first"); return
    vid = str(v["_id"])
    # ensure a vendor LOGIN account tied to DIAG_Vendor
    await db.users.update_one(
        {"email": "diag_vendor@diag.com"},
        {"$set": {"email": "diag_vendor@diag.com", "name": "Diag Vendor Mgr", "role": "vendor",
                  "vendor_id": vid, "password_hash": hash_password("Diag#1234")}},
        upsert=True,
    )
    order = {
        "user_id": str(emp["_id"]),
        "employee_name": emp.get("name") or emp.get("email"),
        "employee_email": emp.get("email"),
        "vendor_id": vid,
        "site_id": emp.get("site_id"),
        "company_id": emp.get("company_id"),
        "items": [{"name": "Tea", "quantity": 2, "price": 15.0, "counter": None},
                  {"name": "Samosa", "quantity": 1, "price": 25.0, "counter": None}],
        "total_amount": 55.0,
        "status": "pending",
        "payment_status": "paid",
        "payment_method": "razorpay",
        "collection_code": f"CRV-{random.randint(100000,999999)}",
        "created_at": datetime.now(timezone.utc),
    }
    res = await db.orders.insert_one(order)
    print("vendor_id=", vid, "vendor_login=diag_vendor@diag.com/Diag#1234", "order=", str(res.inserted_id))

asyncio.run(main())
