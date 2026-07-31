"""Seed script: create city -> client -> site -> allowed-domain -> vendor -> menu items.
Then register scratch employee. Returns credentials.
"""
import os, sys, json, requests, uuid

BASE = os.environ.get('REACT_APP_BACKEND_URL', 'https://corporate-feast.preview.emergentagent.com').rstrip('/')
API = f"{BASE}/api"
s = requests.Session()

def die(msg, r=None):
    print("FAIL:", msg)
    if r is not None:
        print(r.status_code, r.text[:500])
    sys.exit(1)

# 1. Login as master admin
r = s.post(f"{API}/auth/login", json={"email": "admin@cravitoo.com", "password": "admin123"})
if r.status_code != 200:
    die("admin login", r)
token = r.json().get("access_token") or r.json().get("token")
s.headers.update({"Authorization": f"Bearer {token}"})
print("admin logged in")

created = {}
u6 = uuid.uuid4().hex[:6]

# 2. City
r = s.post(f"{API}/cities", json={"name": f"TESTCITY_{u6}", "state": "TS", "country": "IN"})
print("cities", r.status_code)
if r.status_code not in (200, 201): die("city", r)
created["city_id"] = r.json()["id"]

# 3. Corporate client
r = s.post(f"{API}/master/corporate-clients", json={
    "name": f"TESTCLIENT_{u6}",
    "address": "1 Test Rd",
    "contact_email": "clientadmin@cravitootest.com",
    "contact_phone": "9999999999",
})
print("client", r.status_code, r.text[:200])
if r.status_code not in (200, 201): die("client", r)
client_id = r.json()["id"]
created["client_id"] = client_id

# 4. Site
r = s.post(f"{API}/sites", json={
    "name": f"TESTSITE_{u6}",
    "company_id": client_id,
    "city_id": created["city_id"],
    "address": "Test address",
    "city": "TestCity",
    "contact_email": f"site@cravitootest.com",
    "contact_phone": "8888888888",
})
print("sites", r.status_code, r.text[:200])
if r.status_code not in (200, 201): die("site", r)
site_id = r.json()["id"]
created["site_id"] = site_id

# 5. Allowed domain — link to company but NOT site (avoid lifecycle gate)
domain = f"cravitootest{u6}.com"
r = s.post(f"{API}/admin/allowed-domains", json={
    "domain": domain,
    "company_id": client_id,
})
print("domain", r.status_code, r.text[:200])
if r.status_code not in (200, 201): die("domain", r)
created["domain"] = domain

# 6. Vendor
r = s.post(f"{API}/vendors", json={
    "name": f"TESTVENDOR_{u6}",
    "description": "Test vendor for mobile UI",
    "cuisine_type": "Indian",
    "email": f"vendor_{u6}@cravitootest.com",
    "phone": "8888888888",
})
print("vendor", r.status_code, r.text[:200])
if r.status_code not in (200, 201): die("vendor", r)
vendor_id = r.json()["id"]
created["vendor_id"] = vendor_id

# 7. Second vendor (for the vendor-tab scroll test)
r = s.post(f"{API}/vendors", json={
    "name": f"TESTVENDOR2_{u6}",
    "description": "Second test vendor",
    "cuisine_type": "Chinese",
    "email": f"vendor2_{u6}@cravitootest.com",
    "phone": "7777777777",
})
print("vendor2", r.status_code, r.text[:200])
if r.status_code in (200, 201):
    created["vendor_id_2"] = r.json()["id"]

# 8. Menu items (3)
menu_ids = []
for i, (name, price, veg) in enumerate([("Test Paneer Tikka", 180, True), ("Test Chicken Roll", 220, False), ("Test Veg Biryani", 200, True)]):
    r = s.post(f"{API}/menu", json={
        "vendor_id": vendor_id,
        "name": name,
        "description": f"Delicious {name}",
        "price": price,
        "is_vegetarian": veg,
        "category": "Main",
    })
    print("menu", i, r.status_code, r.text[:200])
    if r.status_code not in (200, 201): die(f"menu {i}", r)
    menu_ids.append(r.json()["id"])
created["menu_ids"] = menu_ids

# 9. Register scratch employee
emp_email = f"employee_{u6}@{domain}"
emp_pw = "Empl0yee!Pass"
r = s.post(f"{API}/auth/register", json={
    "email": emp_email,
    "password": emp_pw,
    "name": "Test Employee",
    "phone": "7777777777",
})
print("register", r.status_code, r.text[:300])
if r.status_code not in (200, 201): die("register employee", r)
created["employee_email"] = emp_email
created["employee_password"] = emp_pw

with open("/tmp/seed_data.json", "w") as f:
    json.dump(created, f, indent=2)
print("SEED_OK")
print(json.dumps(created, indent=2))
