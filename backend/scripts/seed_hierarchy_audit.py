"""Seed a clean, fully-linked hierarchy for auditing cross-level scoping.

Client(Company) -> City -> Site -> Vendor -> Counter -> Menu -> Employee -> Order

Creates TWO companies/sites so we can prove isolation between them.
All entities prefixed AUDIT_ for easy identification. Idempotent (re-runnable).
"""
import asyncio, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from datetime import datetime, timezone
from bson import ObjectId
from server import hash_password
load_dotenv()

PW = "Audit#1234"

async def upsert(db, coll, match, doc):
    await db[coll].update_one(match, {"$set": doc}, upsert=True)
    return str((await db[coll].find_one(match))["_id"])

async def main():
    c = AsyncIOMotorClient(os.environ['MONGO_URL']); db = c[os.environ['DB_NAME']]
    now = datetime.now(timezone.utc)

    city_id = await upsert(db, "cities", {"name": "AUDIT_City"},
                           {"name": "AUDIT_City", "state": "Karnataka", "region": "South",
                            "country": "India", "status": "active"})

    comp_a = await upsert(db, "companies", {"name": "AUDIT_CorpA"},
                          {"name": "AUDIT_CorpA", "city_id": city_id, "lifecycle_status": "active"})
    comp_b = await upsert(db, "companies", {"name": "AUDIT_CorpB"},
                          {"name": "AUDIT_CorpB", "city_id": city_id, "lifecycle_status": "active"})

    site_a = await upsert(db, "sites", {"name": "AUDIT_SiteA"},
                          {"name": "AUDIT_SiteA", "city_id": city_id, "company_id": comp_a,
                           "lifecycle_status": "live", "status": "active"})
    site_b = await upsert(db, "sites", {"name": "AUDIT_SiteB"},
                          {"name": "AUDIT_SiteB", "city_id": city_id, "company_id": comp_b,
                           "lifecycle_status": "live", "status": "active"})

    v1 = await upsert(db, "vendors", {"name": "AUDIT_Vendor1"},
                      {"name": "AUDIT_Vendor1", "status": "active", "cuisine_type": "North Indian"})
    v2 = await upsert(db, "vendors", {"name": "AUDIT_Vendor2"},
                      {"name": "AUDIT_Vendor2", "status": "active", "cuisine_type": "South Indian"})

    # Mappings: V1->A, V2->A, V1->B (shared vendor across sites)
    for (v, s) in [(v1, site_a), (v2, site_a), (v1, site_b)]:
        await db.vendor_site_mappings.update_one(
            {"vendor_id": v, "site_id": s},
            {"$set": {"vendor_id": v, "site_id": s, "status": "active", "created_at": now}},
            upsert=True)

    # Menu items with counters (Counter -> Menu link)
    async def menu(vid, sid, name, price, counter):
        await db.menu_items.update_one(
            {"vendor_id": vid, "site_id": sid, "name": name},
            {"$set": {"vendor_id": vid, "site_id": sid, "name": name, "price": price,
                      "counter": counter, "category": "Main", "is_vegetarian": True,
                      "is_available": True, "meal_periods": ["lunch"], "allergens": []}},
            upsert=True)
    await menu(v1, site_a, "AUDIT_Paneer", 120, "Counter 1")
    await menu(v1, site_a, "AUDIT_Dal", 90, "Counter 1")
    await menu(v2, site_a, "AUDIT_Dosa", 80, "Counter 2")
    await menu(v1, site_b, "AUDIT_Paneer", 120, "Counter 1")

    # Users
    users = {
        "audit_corpadmin_a@corpa.com":  {"role": "corporate_admin", "company_id": comp_a},
        "audit_siteadmin_a@corpa.com":  {"role": "site_admin", "company_id": comp_a, "site_id": site_a},
        "audit_emp_a@corpa.com":        {"role": "employee", "company_id": comp_a, "site_id": site_a},
        "audit_emp_b@corpb.com":        {"role": "employee", "company_id": comp_b, "site_id": site_b},
    }
    uid = {}
    for email, extra in users.items():
        await db.users.update_one({"email": email},
            {"$set": {"email": email, "name": email.split("@")[0], "is_active": True,
                      "password_hash": hash_password(PW), **extra}}, upsert=True)
        uid[email] = str((await db.users.find_one({"email": email}))["_id"])

    # Vendor login user for V1
    await db.users.update_one({"email": "audit_vendor1@corpa.com"},
        {"$set": {"email": "audit_vendor1@corpa.com", "name": "AUDIT_Vendor1 Login",
                  "role": "vendor", "vendor_id": v1, "is_active": True,
                  "password_hash": hash_password(PW)}}, upsert=True)

    # Orders (linked): EA -> V1 @ SiteA/CorpA ; EB -> V1 @ SiteB/CorpB
    await db.orders.delete_many({"_audit_seed": True})
    orders = [
        {"user_id": uid["audit_emp_a@corpa.com"], "vendor_id": v1, "site_id": site_a,
         "company_id": comp_a, "total_amount": 210.0, "payment_status": "paid", "status": "confirmed",
         "collection_code": "CRV-AUDA01", "created_at": now, "_audit_seed": True,
         "items": [{"name": "AUDIT_Paneer", "quantity": 1, "price": 120.0},
                   {"name": "AUDIT_Dal", "quantity": 1, "price": 90.0}]},
        {"user_id": uid["audit_emp_b@corpb.com"], "vendor_id": v1, "site_id": site_b,
         "company_id": comp_b, "total_amount": 120.0, "payment_status": "pending", "status": "pending",
         "collection_code": "CRV-AUDB01", "created_at": now, "_audit_seed": True,
         "items": [{"name": "AUDIT_Paneer", "quantity": 1, "price": 120.0}]},
    ]
    await db.orders.insert_many(orders)

    print("=== AUDIT HIERARCHY SEEDED ===")
    print(f"City={city_id}")
    print(f"CorpA={comp_a}  SiteA={site_a}  (V1={v1}, V2={v2})")
    print(f"CorpB={comp_b}  SiteB={site_b}")
    print(f"Password for all AUDIT users: {PW}")
    print("Users: audit_corpadmin_a@corpa.com, audit_siteadmin_a@corpa.com, audit_emp_a@corpa.com, audit_emp_b@corpb.com, audit_vendor1@corpa.com")
    print("Expected scoping:")
    print("  corp_admin A  -> 1 order (CRV-AUDA01), NOT CRV-AUDB01")
    print("  site_admin A  -> 1 order (CRV-AUDA01)")
    print("  employee A    -> vendors [AUDIT_Vendor1, AUDIT_Vendor2]; own 1 order")
    print("  employee B    -> vendors [AUDIT_Vendor1]; own 1 order")

asyncio.run(main())
