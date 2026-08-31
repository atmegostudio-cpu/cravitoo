import asyncio, os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from datetime import datetime, timezone
load_dotenv()

VENDOR = "6a85521d239a34f6433984ea"  # approve_0b71c6@example.com / vendor123

async def main():
    c = AsyncIOMotorClient(os.environ['MONGO_URL']); db = c[os.environ['DB_NAME']]
    now = datetime.now(timezone.utc)
    # Clean any prior seed rows
    await db.orders.delete_many({"vendor_id": VENDOR, "_seed_today": True})
    docs = [
        {"vendor_id": VENDOR, "user_id": "seed", "payment_status": "paid",
         "status": "confirmed", "total_amount": 250.0, "created_at": now, "_seed_today": True,
         "collection_code": "CRV-900001",
         "items": [{"name": "Veg Thali", "quantity": 3, "price": 50.0},
                   {"name": "Masala Chai", "quantity": 2, "price": 20.0}]},
        {"vendor_id": VENDOR, "user_id": "seed", "payment_status": "paid",
         "status": "confirmed", "total_amount": 150.0, "created_at": now, "_seed_today": True,
         "collection_code": "CRV-900002",
         "items": [{"name": "Veg Thali", "quantity": 2, "price": 50.0}]},
        {"vendor_id": VENDOR, "user_id": "seed", "payment_status": "pending",
         "status": "pending", "total_amount": 120.0, "created_at": now, "_seed_today": True,
         "collection_code": "CRV-900003",
         "items": [{"name": "Paneer Combo", "quantity": 1, "price": 120.0}]},
    ]
    await db.orders.insert_many(docs)
    print(f"Seeded {len(docs)} today orders for vendor {VENDOR}")
    print("Expected: today_revenue=400.00, today_paid_orders=2, top_item=Veg Thali (5), pending includes 120.00 x1 (+ any pre-existing pending)")

asyncio.run(main())
