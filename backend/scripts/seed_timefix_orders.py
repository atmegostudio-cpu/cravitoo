"""Seed a login-able employee + vendor and two PAID orders with known UTC
timestamps so QA can verify (a) each order shows exactly once and (b) the
order time renders in correct local time. Idempotent — safe to re-run.
"""
import asyncio
import sys
from datetime import datetime, timezone
from bson import ObjectId

sys.path.insert(0, "/app/backend")
from server import db, hash_password  # noqa: E402

EMP_EMAIL = "timefix_emp@cravitoo.com"
VENDOR_EMAIL = "timefix_vendor@cravitoo.com"
PWD = "Test#1234"
VENDOR_NAME = "TimeFix Kitchen"


async def main():
    # Vendor doc
    vendor = await db.vendors.find_one({"name": VENDOR_NAME})
    if not vendor:
        vres = await db.vendors.insert_one({
            "name": VENDOR_NAME, "status": "active", "auto_confirm": False,
            "created_at": datetime.now(timezone.utc),
        })
        vendor_id = str(vres.inserted_id)
    else:
        vendor_id = str(vendor["_id"])

    # Vendor user
    await db.users.update_one(
        {"email": VENDOR_EMAIL},
        {"$set": {"name": "TimeFix Vendor", "email": VENDOR_EMAIL, "role": "vendor",
                  "vendor_id": vendor_id, "is_active": True,
                  "password_hash": hash_password(PWD),
                  "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )

    # Employee user
    await db.users.update_one(
        {"email": EMP_EMAIL},
        {"$set": {"name": "TimeFix Employee", "email": EMP_EMAIL, "role": "employee",
                  "is_active": True, "password_hash": hash_password(PWD),
                  "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    emp = await db.users.find_one({"email": EMP_EMAIL})
    emp_id = str(emp["_id"])

    # Menu item
    mi = await db.menu_items.find_one({"vendor_id": vendor_id, "name": "TimeFix Thali"})
    if not mi:
        mres = await db.menu_items.insert_one({
            "vendor_id": vendor_id, "name": "TimeFix Thali", "price": 150.0,
            "is_available": True, "created_at": datetime.now(timezone.utc),
        })
        mi_id = str(mres.inserted_id)
    else:
        mi_id = str(mi["_id"])

    # Two paid orders with KNOWN, distinct UTC times (tz-aware).
    seeds = [
        ("CRV-TIMEFIX1", datetime(2026, 6, 15, 4, 0, 0, tzinfo=timezone.utc)),   # 09:30 IST
        ("CRV-TIMEFIX2", datetime(2026, 6, 15, 13, 45, 0, tzinfo=timezone.utc)), # 19:15 IST
    ]
    for code, ts in seeds:
        existing = await db.orders.find_one({"collection_code": code})
        doc = {
            "user_id": emp_id, "employee_name": "TimeFix Employee",
            "employee_email": EMP_EMAIL, "vendor_id": vendor_id,
            "site_id": None, "company_id": None,
            "items": [{"menu_item_id": mi_id, "name": "TimeFix Thali",
                       "quantity": 1, "price": 150.0, "counter": None}],
            "total_amount": 150.0, "status": "confirmed", "payment_status": "paid",
            "collection_code": code, "payment_mode": "RAZORPAY",
            "payment_method": "razorpay", "delivery_type": "pickup",
            "special_instructions": None, "counter": None,
            "created_at": ts, "paid_at": ts,
        }
        if existing:
            await db.orders.update_one({"_id": existing["_id"]}, {"$set": doc})
        else:
            await db.orders.insert_one(doc)

    n = await db.orders.count_documents({"vendor_id": vendor_id})
    print(f"Seeded. employee={EMP_EMAIL} vendor={VENDOR_EMAIL} pwd={PWD}")
    print(f"vendor_id={vendor_id}  orders_for_vendor={n} (EXPECT 2, no duplicates)")


if __name__ == "__main__":
    asyncio.run(main())
