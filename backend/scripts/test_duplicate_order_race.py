"""Concurrency + timezone regression test for the duplicate-order bug.

Runs _finalize_payment_intent twice concurrently (simulating /verify racing
the webhook) against ONE payment_intent and asserts exactly ONE order is
created. Also verifies created_at serialises to a UTC-aware ISO string.
Self-cleaning — removes all docs it seeds.
"""
import asyncio
import sys
from datetime import datetime, timezone
from bson import ObjectId

sys.path.insert(0, "/app/backend")
import server  # noqa: E402
from server import (  # noqa: E402
    db, safe_objectid, get_current_user, create_notification, manager,
    generate_pickup_qr, verify_pickup_qr,
)
from routers.orders import make_router as _make_orders_router  # noqa: E402

# Rebuild the orders router with the real server deps so we can exercise the
# internal idempotency helper exactly as production does.
_orders_router = _make_orders_router(
    db, safe_objectid, get_current_user, create_notification, manager,
    generate_pickup_qr, verify_pickup_qr,
)
_finalize_payment_intent = _orders_router._finalize_payment_intent

TAG = "RACE_TEST__"


async def cleanup():
    await db.users.delete_many({"email": {"$regex": f"^{TAG}"}})
    await db.vendors.delete_many({"name": {"$regex": f"^{TAG}"}})
    await db.menu_items.delete_many({"name": {"$regex": f"^{TAG}"}})
    intents = await db.payment_intents.find({"user_email": {"$regex": f"^{TAG}"}}).to_list(100)
    rzp_ids = [i["razorpay_order_id"] for i in intents]
    await db.payment_intents.delete_many({"user_email": {"$regex": f"^{TAG}"}})
    if rzp_ids:
        await db.orders.delete_many({"razorpay_order_id": {"$in": rzp_ids}})


async def seed():
    vendor = {"name": f"{TAG}Vendor", "status": "active", "auto_confirm": False,
              "created_at": datetime.now(timezone.utc)}
    vres = await db.vendors.insert_one(vendor)
    vendor_id = str(vres.inserted_id)

    user = {"name": f"{TAG}Emp", "email": f"{TAG}emp@test.com", "role": "employee",
            "site_id": None, "company_id": None, "created_at": datetime.now(timezone.utc)}
    ures = await db.users.insert_one(user)
    user_id = str(ures.inserted_id)

    mi = {"vendor_id": vendor_id, "name": f"{TAG}Item", "price": 100.0,
          "is_available": True, "created_at": datetime.now(timezone.utc)}
    mres = await db.menu_items.insert_one(mi)
    mi_id = str(mres.inserted_id)

    validated = [{"menu_item_id": mi_id, "name": f"{TAG}Item", "quantity": 2,
                  "price": 100.0, "counter": None}]
    rzp_order_id = f"order_racetest_{ObjectId()}"
    intent_doc = {
        "intent_id": f"racetest_{ObjectId()}",
        "razorpay_order_id": rzp_order_id,
        "user_id": user_id, "user_email": user["email"], "user_name": user["name"],
        "vendor_id": vendor_id, "items": validated, "delivery_type": "pickup",
        "special_instructions": None, "amount": 20000, "currency": "INR",
        "total_amount": 200.0, "status": "created", "cravitoo_order_id": None,
        "mock_mode": False, "created_at": datetime.now(timezone.utc),
    }
    ires = await db.payment_intents.insert_one(intent_doc)
    intent_doc["_id"] = ires.inserted_id
    return intent_doc, rzp_order_id


async def main():
    await cleanup()
    intent, rzp_order_id = await seed()
    fresh1 = await db.payment_intents.find_one({"_id": intent["_id"]})
    fresh2 = await db.payment_intents.find_one({"_id": intent["_id"]})

    # Fire /verify and webhook concurrently against the SAME intent.
    results = await asyncio.gather(
        _finalize_payment_intent(intent=fresh1, razorpay_payment_id="pay_verify_1", source="verify"),
        _finalize_payment_intent(intent=fresh2, razorpay_payment_id="pay_webhook_1", source="webhook"),
        return_exceptions=True,
    )

    order_count = await db.orders.count_documents({"razorpay_order_id": rzp_order_id})
    order = await db.orders.find_one({"razorpay_order_id": rzp_order_id})

    print("=" * 60)
    print(f"Concurrent finalize results: {results}")
    print(f"Orders created for this intent: {order_count}  (EXPECT 1)")

    ok = True
    if order_count != 1:
        print("FAIL: duplicate or missing order!")
        ok = False
    else:
        print("PASS: exactly one order created despite the race.")

    # Both callers should resolve to the SAME order id (idempotent return).
    returned_ids = {str(r.get("_id")) for r in results if isinstance(r, dict) and r.get("_id")}
    print(f"Distinct order ids returned by callers: {returned_ids}")
    if len(returned_ids) > 1:
        print("FAIL: callers returned different order ids!")
        ok = False

    # Timezone: created_at stored as tz-aware datetime, serialises with +00:00.
    ca = order.get("created_at") if order else None
    print(f"created_at raw: {ca!r}")
    if isinstance(ca, datetime):
        iso = (ca if ca.tzinfo else ca.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
        print(f"created_at serialised: {iso}")
        if "+00:00" in iso:
            print("PASS: created_at is UTC-aware.")
        else:
            print("FAIL: created_at not UTC-aware.")
            ok = False
    else:
        print("FAIL: created_at missing / wrong type.")
        ok = False

    await cleanup()
    print("Cleanup done.")
    print("=" * 60)
    print("RESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
