import asyncio, os
from collections import Counter
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from bson import ObjectId
load_dotenv()

def oid(s):
    try:
        return ObjectId(s)
    except Exception:
        return None

async def main():
    c = AsyncIOMotorClient(os.environ['MONGO_URL']); db = c[os.environ['DB_NAME']]

    companies = {str(x['_id']): x async for x in db.companies.find({})}
    cities = {str(x['_id']): x async for x in db.cities.find({})}
    sites = {str(x['_id']): x async for x in db.sites.find({})}
    vendors = {str(x['_id']): x async for x in db.vendors.find({})}
    print(f"Counts: companies={len(companies)} cities={len(cities)} sites={len(sites)} vendors={len(vendors)}")
    print(f"        users={await db.users.count_documents({})} orders={await db.orders.count_documents({})} menu_items={await db.menu_items.count_documents({})} mappings={await db.vendor_site_mappings.count_documents({})}")

    print("\n--- SITES: broken city_id / company_id ---")
    for sid, s in sites.items():
        cid = s.get('city_id'); coid = s.get('company_id')
        if cid and cid not in cities: print(f"  Site {sid} ({s.get('name')}) -> missing city_id {cid}")
        if coid and coid not in companies: print(f"  Site {sid} ({s.get('name')}) -> missing company_id {coid}")
        if not cid: print(f"  Site {sid} ({s.get('name')}) has NO city_id")
        if not coid: print(f"  Site {sid} ({s.get('name')}) has NO company_id")

    print("\n--- COMPANIES: city link ---")
    for coid, co in companies.items():
        if not co.get('city_id'): print(f"  Company {coid} ({co.get('name')}) has NO city_id")

    print("\n--- VENDOR_SITE_MAPPINGS: broken / duplicate / status-mismatch ---")
    seen = Counter()
    async for m in db.vendor_site_mappings.find({}):
        v = m.get('vendor_id'); s = m.get('site_id'); st = m.get('status')
        seen[(v, s)] += 1
        if v not in vendors: print(f"  Mapping {m['_id']} -> missing vendor {v}")
        if s not in sites: print(f"  Mapping {m['_id']} -> missing site {s}")
        if st == 'active' and v in vendors and vendors[v].get('status') != 'active':
            print(f"  Mapping {m['_id']} ACTIVE but vendor {v} status={vendors[v].get('status')}")
    for key, n in seen.items():
        if n > 1: print(f"  DUPLICATE mapping vendor={key[0]} site={key[1]} count={n}")

    print("\n--- MENU_ITEMS: orphan vendor / site, missing site_id ---")
    dup = Counter()
    async for mi in db.menu_items.find({}):
        v = mi.get('vendor_id'); s = mi.get('site_id')
        dup[(v, s, (mi.get('name') or '').strip().lower())] += 1
        if v and v not in vendors: print(f"  MenuItem {mi['_id']} ({mi.get('name')}) -> missing vendor {v}")
        if not s: print(f"  MenuItem {mi['_id']} ({mi.get('name')}) vendor={v} has NO site_id")
        elif s not in sites: print(f"  MenuItem {mi['_id']} ({mi.get('name')}) -> missing site {s}")
        # menu item whose vendor is NOT mapped to its site
        if v and s:
            mp = await db.vendor_site_mappings.find_one({"vendor_id": v, "site_id": s})
            if not mp: print(f"  MenuItem {mi['_id']} ({mi.get('name')}) vendor {v} NOT mapped to its site {s}")
    for key, n in dup.items():
        if n > 1 and key[2]: print(f"  DUP menu item name='{key[2]}' vendor={key[0]} site={key[1]} count={n}")

    print("\n--- USERS(employees): broken site_id / company_id ---")
    async for u in db.users.find({"role": "employee"}):
        s = u.get('site_id'); co = u.get('company_id')
        if not s: print(f"  Employee {u.get('email')} has NO site_id")
        elif s not in sites: print(f"  Employee {u.get('email')} -> missing site {s}")
        if not co: print(f"  Employee {u.get('email')} has NO company_id")
        elif co not in companies: print(f"  Employee {u.get('email')} -> missing company {co}")
        # cross-check: employee.site_id belongs to employee.company_id
        if s in sites and co and sites[s].get('company_id') and sites[s].get('company_id') != co:
            print(f"  Employee {u.get('email')} site.company({sites[s].get('company_id')}) != employee.company({co})")

    print("\n--- ORDERS: linkage (site_id/company_id present? vendor/user valid?) ---")
    no_site = 0; no_company = 0; bad_vendor = 0; total = 0
    async for o in db.orders.find({}):
        total += 1
        if not o.get('site_id'): no_site += 1
        if not o.get('company_id'): no_company += 1
        if o.get('vendor_id') and o.get('vendor_id') not in vendors: bad_vendor += 1
    print(f"  orders total={total} | missing site_id={no_site} | missing company_id={no_company} | bad vendor ref={bad_vendor}")

    print("\n--- VENDOR login users: broken vendor_id ---")
    async for u in db.users.find({"role": "vendor"}):
        v = u.get('vendor_id')
        if not v or v not in vendors: print(f"  Vendor user {u.get('email')} -> vendor_id {v} missing/invalid")

asyncio.run(main())
