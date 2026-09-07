"""Backend regression tests for the employee → GET /api/vendors visibility fix.

Bug context (Jan 2026): employees with a correctly-mapped vendor but whose
vendor_site_mappings row lacked a `status` field OR stored site_id as ObjectId
saw a BLANK 'Available Vendors' list. The fix in server.py::get_vendors treats
missing/null status as active AND matches site_id in both string+ObjectId form.

These tests seed throwaway data directly in Mongo (all names/emails prefixed
with TEST_EMPVIS_) and clean up in teardown. Master admin data is untouched.
"""
import os
import time
import bcrypt
import pytest
import requests
from pymongo import MongoClient
from bson import ObjectId

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "cravitoo_db")

ADMIN_EMAIL = "admin@cravitoo.com"
ADMIN_PASS = "admin123"

PREFIX = "TEST_EMPVIS_"


# ---------- helpers ----------

def _hash(pwd: str) -> str:
    return bcrypt.hashpw(pwd.encode(), bcrypt.gensalt()).decode()


def _login(email, password):
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=30,
    )
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok, f"no token in {body}"
    return tok


def _vendors(tok):
    r = requests.get(
        f"{BASE_URL}/api/vendors",
        headers={"Authorization": f"Bearer {tok}"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def seed(db):
    """Seed: 1 company, 2 sites (A, B), 4 vendors, mappings with varied statuses,
    plus one single-site company + no-site employee case."""
    ctx = {"cleanup": {"users": [], "sites": [], "vendors": [], "companies": [], "maps": []}}

    # Company + two sites
    comp_id = db.companies.insert_one({
        "name": f"{PREFIX}Company",
        "created_at": time.time(),
    }).inserted_id
    ctx["cleanup"]["companies"].append(comp_id)
    ctx["company_id"] = str(comp_id)

    site_a = db.sites.insert_one({
        "name": f"{PREFIX}SiteA",
        "company_id": str(comp_id),
        "status": "active",
    }).inserted_id
    site_b = db.sites.insert_one({
        "name": f"{PREFIX}SiteB",
        "company_id": str(comp_id),
        "status": "active",
    }).inserted_id
    ctx["cleanup"]["sites"] += [site_a, site_b]
    ctx["site_a"] = str(site_a)
    ctx["site_b"] = str(site_b)

    # Vendors
    def mkvendor(name, status="active"):
        vid = db.vendors.insert_one({
            "name": f"{PREFIX}{name}",
            "email": f"{PREFIX}{name}@x.com".lower(),
            "phone": "0000000000",
            "status": status,
            "cuisine_type": "test",
        }).inserted_id
        ctx["cleanup"]["vendors"].append(vid)
        return str(vid)

    ctx["v_missing_status"] = mkvendor("VMissing")   # mapping has NO status field
    ctx["v_active"] = mkvendor("VActive")             # mapping status='active'
    ctx["v_inactive_map"] = mkvendor("VInactiveMap")  # mapping status='inactive'
    ctx["v_inactive_vendor"] = mkvendor("VInactiveVendor", status="inactive")  # active mapping
    ctx["v_other_site"] = mkvendor("VOtherSite")      # mapped only to site_b
    ctx["v_oid_site"] = mkvendor("VOidSite")          # mapping stores site_id as ObjectId

    # Mappings for site_a (employee A's site)
    def mkmap(vendor_id, site_id, status=..., site_as_oid=False):
        doc = {"vendor_id": vendor_id, "site_id": ObjectId(site_id) if site_as_oid else site_id}
        if status is not ...:
            doc["status"] = status
        mid = db.vendor_site_mappings.insert_one(doc).inserted_id
        ctx["cleanup"]["maps"].append(mid)
        return mid

    mkmap(ctx["v_missing_status"], ctx["site_a"])                       # no status
    mkmap(ctx["v_active"], ctx["site_a"], status="active")
    mkmap(ctx["v_inactive_map"], ctx["site_a"], status="inactive")
    mkmap(ctx["v_inactive_vendor"], ctx["site_a"], status="active")
    mkmap(ctx["v_other_site"], ctx["site_b"], status="active")
    mkmap(ctx["v_oid_site"], ctx["site_a"], status="active", site_as_oid=True)

    # Employee A (site_a)
    emp_a_email = f"{PREFIX}empa@x.com".lower()
    emp_a_id = db.users.insert_one({
        "email": emp_a_email,
        "password_hash": _hash("pass1234"),
        "role": "employee",
        "name": f"{PREFIX}EmpA",
        "site_id": ctx["site_a"],
        "company_id": ctx["company_id"],
        "is_active": True,
    }).inserted_id
    ctx["cleanup"]["users"].append(emp_a_id)
    ctx["emp_a_email"] = emp_a_email

    # Employee B (site_b) — isolation
    emp_b_email = f"{PREFIX}empb@x.com".lower()
    emp_b_id = db.users.insert_one({
        "email": emp_b_email,
        "password_hash": _hash("pass1234"),
        "role": "employee",
        "name": f"{PREFIX}EmpB",
        "site_id": ctx["site_b"],
        "company_id": ctx["company_id"],
        "is_active": True,
    }).inserted_id
    ctx["cleanup"]["users"].append(emp_b_id)
    ctx["emp_b_email"] = emp_b_email

    # Employee with no site + multi-site company -> should get []
    emp_nosite_multi_email = f"{PREFIX}empnositemulti@x.com".lower()
    emp_nosite_multi_id = db.users.insert_one({
        "email": emp_nosite_multi_email,
        "password_hash": _hash("pass1234"),
        "role": "employee",
        "name": f"{PREFIX}EmpNoSiteMulti",
        "company_id": ctx["company_id"],  # has 2 sites
        "is_active": True,
    }).inserted_id
    ctx["cleanup"]["users"].append(emp_nosite_multi_id)
    ctx["emp_nosite_multi_email"] = emp_nosite_multi_email

    # Single-site company + no-site employee -> should auto-resolve
    comp2_id = db.companies.insert_one({"name": f"{PREFIX}CompanySolo"}).inserted_id
    ctx["cleanup"]["companies"].append(comp2_id)
    site_solo = db.sites.insert_one({
        "name": f"{PREFIX}SiteSolo",
        "company_id": str(comp2_id),
        "status": "active",
    }).inserted_id
    ctx["cleanup"]["sites"].append(site_solo)

    v_solo = mkvendor("VSolo")
    mkmap(v_solo, str(site_solo), status="active")
    ctx["v_solo"] = v_solo

    emp_solo_email = f"{PREFIX}empsolo@x.com".lower()
    emp_solo_id = db.users.insert_one({
        "email": emp_solo_email,
        "password_hash": _hash("pass1234"),
        "role": "employee",
        "name": f"{PREFIX}EmpSolo",
        "company_id": str(comp2_id),
        "is_active": True,
    }).inserted_id
    ctx["cleanup"]["users"].append(emp_solo_id)
    ctx["emp_solo_email"] = emp_solo_email

    yield ctx

    # ---- teardown ----
    c = ctx["cleanup"]
    if c["users"]:
        db.users.delete_many({"_id": {"$in": c["users"]}})
    if c["maps"]:
        db.vendor_site_mappings.delete_many({"_id": {"$in": c["maps"]}})
    if c["vendors"]:
        db.vendors.delete_many({"_id": {"$in": c["vendors"]}})
    if c["sites"]:
        db.sites.delete_many({"_id": {"$in": c["sites"]}})
    if c["companies"]:
        db.companies.delete_many({"_id": {"$in": c["companies"]}})


# ---------- tests ----------

def test_employee_sees_vendor_with_missing_status_mapping(seed):
    tok = _login(seed["emp_a_email"], "pass1234")
    ids = {v["id"] for v in _vendors(tok)}
    assert seed["v_missing_status"] in ids, (
        f"Vendor with missing-status mapping should be visible. Got {ids}"
    )


def test_employee_sees_vendor_with_active_mapping(seed):
    tok = _login(seed["emp_a_email"], "pass1234")
    ids = {v["id"] for v in _vendors(tok)}
    assert seed["v_active"] in ids


def test_employee_sees_vendor_with_objectid_site_mapping(seed):
    """site_id stored as ObjectId should still match employee's string site_id."""
    tok = _login(seed["emp_a_email"], "pass1234")
    ids = {v["id"] for v in _vendors(tok)}
    assert seed["v_oid_site"] in ids, (
        f"Vendor with ObjectId-typed site_id in mapping must still appear. Got {ids}"
    )


def test_employee_hides_inactive_mapping(seed):
    tok = _login(seed["emp_a_email"], "pass1234")
    ids = {v["id"] for v in _vendors(tok)}
    assert seed["v_inactive_map"] not in ids


def test_employee_hides_inactive_vendor_even_with_active_mapping(seed):
    tok = _login(seed["emp_a_email"], "pass1234")
    ids = {v["id"] for v in _vendors(tok)}
    assert seed["v_inactive_vendor"] not in ids


def test_employee_isolation_cross_site(seed):
    """Employee A must NOT see vendor mapped only to site B."""
    tok = _login(seed["emp_a_email"], "pass1234")
    ids = {v["id"] for v in _vendors(tok)}
    assert seed["v_other_site"] not in ids

    # And vice-versa: emp B sees only its site's vendor (not site A's)
    tok_b = _login(seed["emp_b_email"], "pass1234")
    ids_b = {v["id"] for v in _vendors(tok_b)}
    assert seed["v_other_site"] in ids_b
    assert seed["v_missing_status"] not in ids_b
    assert seed["v_active"] not in ids_b


def test_employee_no_site_multi_site_company_returns_empty(seed):
    tok = _login(seed["emp_nosite_multi_email"], "pass1234")
    vendors = _vendors(tok)
    assert vendors == [], f"Expected [], got {vendors}"


def test_employee_no_site_single_site_company_auto_resolves(seed):
    tok = _login(seed["emp_solo_email"], "pass1234")
    ids = {v["id"] for v in _vendors(tok)}
    assert seed["v_solo"] in ids, (
        f"Employee with no site but single-site company should auto-resolve. Got {ids}"
    )


def test_admin_sees_full_platform_list_unaffected(seed):
    """Admin GET /api/vendors should include ALL our test active vendors,
    unrestricted by mapping. (Inactive vendor still excluded due to
    vendor.status=='active' filter.)"""
    tok = _login(ADMIN_EMAIL, ADMIN_PASS)
    ids = {v["id"] for v in _vendors(tok)}
    expected_visible = [
        seed["v_missing_status"], seed["v_active"], seed["v_inactive_map"],
        seed["v_other_site"], seed["v_oid_site"], seed["v_solo"],
    ]
    for vid in expected_visible:
        assert vid in ids, f"Admin should see vendor {vid}"
    # Inactive vendor is filtered by vendor_filter status==active
    assert seed["v_inactive_vendor"] not in ids
