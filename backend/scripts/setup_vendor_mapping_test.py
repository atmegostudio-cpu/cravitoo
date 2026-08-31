import asyncio, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from datetime import datetime, timezone
from bson import ObjectId
from server import hash_password
load_dotenv()

SITE = "6a855f3aba5f84a7d670e0c3"          # GateTest_2ba209 (has 9 active mappings)
INACTIVE_MAP_VENDOR = "6a89470ca3d33f4be9f1272c"  # make this mapping inactive
SUSPEND_VENDOR = "6a8946e88de95440e23f21cb"       # suspend this vendor (mapping stays)
EMP_EMAIL = "qa_employee@gatetest.com"
EMP_PW = "employee123"

async def main():
    c = AsyncIOMotorClient(os.environ['MONGO_URL']); db = c[os.environ['DB_NAME']]

    # 1. QA employee bound to the GateTest site
    await db.users.update_one(
        {"email": EMP_EMAIL},
        {"$set": {
            "email": EMP_EMAIL, "name": "QA Employee", "role": "employee",
            "site_id": SITE, "is_active": True,
            "password_hash": hash_password(EMP_PW),
        }},
        upsert=True,
    )

    # 2. Make one mapping inactive (deactivated mapping must NOT show)
    await db.vendor_site_mappings.update_one(
        {"site_id": SITE, "vendor_id": INACTIVE_MAP_VENDOR},
        {"$set": {"status": "inactive", "deactivated_at": datetime.now(timezone.utc),
                  "deactivation_reason": "qa_test"}},
    )

    # 3. Suspend a vendor whose mapping is still active (suspended vendor must NOT show)
    await db.vendors.update_one({"_id": ObjectId(SUSPEND_VENDOR)}, {"$set": {"status": "suspended"}})

    # Report expected visible vendors
    maps = await db.vendor_site_mappings.find({"site_id": SITE, "status": "active"}, {"vendor_id": 1}).to_list(100)
    active_map_ids = [m["vendor_id"] for m in maps]
    visible = []
    for vid in active_map_ids:
        v = await db.vendors.find_one({"_id": ObjectId(vid), "status": "active"}, {"name": 1})
        if v:
            visible.append((vid, v["name"]))
    print(f"Employee: {EMP_EMAIL} / {EMP_PW}  site={SITE}")
    print(f"Active mappings on site: {len(active_map_ids)}")
    print(f"EXPECTED visible vendors ({len(visible)}):")
    for vid, name in visible:
        print("   ", vid, name)
    print(f"Inactive-mapping vendor (hidden): {INACTIVE_MAP_VENDOR}")
    print(f"Suspended vendor (hidden): {SUSPEND_VENDOR}")

asyncio.run(main())
