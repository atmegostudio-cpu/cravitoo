"""Iteration 53 — Employee lookup + manual assign-site backend tests.

Covers:
  - GET  /api/admin/employees/lookup?q=  (domain, full email, partial, empty, non-master)
  - POST /api/admin/employees/assign-site (success, unknown emp, unknown site, non-master)
  - End-to-end visibility: seed employee without site_id + site with vendor mapping;
    assign-site => /api/vendors returns the vendor.
"""
import os
import uuid
import bcrypt
import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

PREFIX = "TEST_ITER53_"
DOMAIN = f"iter53dom{uuid.uuid4().hex[:6]}.com".lower()

_client = MongoClient(MONGO_URL)
db = _client[DB_NAME]


def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


@pytest.fixture(scope="module")
def master_token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": "admin@cravitoo.com", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def mh(master_token):
    return {"Authorization": f"Bearer {master_token}"}


@pytest.fixture(scope="module")
def seed():
    """Seed 2 sites, 1 vendor mapped to site B, 3 employees (2 in domain, 1 not)."""
    # Sites
    site_a = db.sites.insert_one({"name": f"{PREFIX}SiteA", "city": "TC", "address": "x", "is_active": True}).inserted_id
    site_b = db.sites.insert_one({"name": f"{PREFIX}SiteB", "city": "TC", "address": "x", "is_active": True}).inserted_id
    # Vendor + active mapping to site_b
    vendor_id = db.vendors.insert_one({
        "name": f"{PREFIX}Vendor",
        "cuisine_type": "Indian",
        "email": f"{PREFIX}vendor@x.com",
        "status": "active",
        "is_active": True,
    }).inserted_id
    db.vendor_site_mappings.insert_one({
        "vendor_id": str(vendor_id),
        "site_id": str(site_b),
        "status": "active",
    })
    # Employees
    emp_nosite_email = f"nosite_{uuid.uuid4().hex[:6]}@{DOMAIN}"
    emp_nosite_id = db.users.insert_one({
        "email": emp_nosite_email,
        "name": f"{PREFIX}NoSite",
        "role": "employee",
        "password_hash": _hash("pass1234"),
        "is_active": True,
    }).inserted_id
    emp_hassite_email = f"has_{uuid.uuid4().hex[:6]}@{DOMAIN}"
    db.users.insert_one({
        "email": emp_hassite_email,
        "name": f"{PREFIX}HasSite",
        "role": "employee",
        "password_hash": _hash("pass1234"),
        "site_id": str(site_a),
        "is_active": True,
    })
    other_email = f"{PREFIX}other_{uuid.uuid4().hex[:6]}@other-notmatching.com"
    db.users.insert_one({
        "email": other_email,
        "name": f"{PREFIX}Other",
        "role": "employee",
        "password_hash": _hash("pass1234"),
        "is_active": True,
    })
    data = {
        "site_a": str(site_a), "site_b": str(site_b),
        "vendor_id": str(vendor_id),
        "emp_nosite_email": emp_nosite_email, "emp_nosite_id": str(emp_nosite_id),
        "emp_hassite_email": emp_hassite_email,
        "other_email": other_email,
        "domain": DOMAIN,
    }
    yield data
    # Cleanup
    db.users.delete_many({"name": {"$regex": f"^{PREFIX}"}})
    db.sites.delete_many({"name": {"$regex": f"^{PREFIX}"}})
    db.vendors.delete_many({"name": {"$regex": f"^{PREFIX}"}})
    db.vendor_site_mappings.delete_many({"vendor_id": data["vendor_id"]})


# -------- LOOKUP --------

def test_lookup_by_domain(mh, seed):
    r = requests.get(f"{BASE}/api/admin/employees/lookup", params={"q": f"@{seed['domain']}"}, headers=mh)
    assert r.status_code == 200, r.text
    data = r.json()
    emails = {e["email"] for e in data}
    assert seed["emp_nosite_email"] in emails
    assert seed["emp_hassite_email"] in emails
    assert seed["other_email"] not in emails
    # Structure
    row_has = next(e for e in data if e["email"] == seed["emp_hassite_email"])
    assert row_has["site_id"] == seed["site_a"]
    assert row_has["site_name"] and row_has["site_name"].startswith(PREFIX)
    row_no = next(e for e in data if e["email"] == seed["emp_nosite_email"])
    assert row_no.get("site_id") in (None, "")


def test_lookup_by_full_email(mh, seed):
    r = requests.get(f"{BASE}/api/admin/employees/lookup", params={"q": seed["emp_nosite_email"]}, headers=mh)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["email"] == seed["emp_nosite_email"]


def test_lookup_partial(mh, seed):
    partial = seed["emp_nosite_email"].split("@")[0][:6]
    r = requests.get(f"{BASE}/api/admin/employees/lookup", params={"q": partial}, headers=mh)
    assert r.status_code == 200
    emails = {e["email"] for e in r.json()}
    assert seed["emp_nosite_email"] in emails


def test_lookup_empty_q(mh):
    r = requests.get(f"{BASE}/api/admin/employees/lookup", params={"q": ""}, headers=mh)
    assert r.status_code == 200
    assert r.json() == []


def test_lookup_non_master_forbidden(seed):
    # Login as an employee we seeded
    lr = requests.post(f"{BASE}/api/auth/login", json={"email": seed["emp_hassite_email"], "password": "pass1234"})
    assert lr.status_code == 200, lr.text
    tok = lr.json()["access_token"]
    r = requests.get(
        f"{BASE}/api/admin/employees/lookup",
        params={"q": f"@{seed['domain']}"},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r.status_code == 403


# -------- ASSIGN --------

def test_assign_unknown_email(mh, seed):
    r = requests.post(f"{BASE}/api/admin/employees/assign-site", json={
        "email": f"nobody_{uuid.uuid4().hex[:6]}@nowhere.com",
        "site_id": seed["site_b"],
    }, headers=mh)
    assert r.status_code == 404


def test_assign_unknown_site(mh, seed):
    r = requests.post(f"{BASE}/api/admin/employees/assign-site", json={
        "email": seed["emp_nosite_email"],
        "site_id": "0" * 24,
    }, headers=mh)
    assert r.status_code == 404


def test_assign_non_master_forbidden(seed):
    lr = requests.post(f"{BASE}/api/auth/login", json={"email": seed["emp_hassite_email"], "password": "pass1234"})
    tok = lr.json()["access_token"]
    r = requests.post(
        f"{BASE}/api/admin/employees/assign-site",
        json={"email": seed["emp_nosite_email"], "site_id": seed["site_b"]},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r.status_code == 403


def test_assign_success_and_visibility_end_to_end(mh, seed):
    # Before: employee has no site_id -> /api/vendors returns []
    lr = requests.post(f"{BASE}/api/auth/login", json={"email": seed["emp_nosite_email"], "password": "pass1234"})
    assert lr.status_code == 200, lr.text
    etok = lr.json()["access_token"]
    eh = {"Authorization": f"Bearer {etok}"}
    r = requests.get(f"{BASE}/api/vendors", headers=eh)
    assert r.status_code == 200
    assert r.json() == [], f"Expected [] before assign, got {r.json()}"

    # Assign
    r = requests.post(f"{BASE}/api/admin/employees/assign-site", json={
        "email": seed["emp_nosite_email"],
        "site_id": seed["site_b"],
    }, headers=mh)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["email"] == seed["emp_nosite_email"]
    assert body["site_id"] == seed["site_b"]
    assert body["site_name"] and body["site_name"].startswith(PREFIX)

    # DB persisted
    u = db.users.find_one({"email": seed["emp_nosite_email"]})
    assert u["site_id"] == seed["site_b"]

    # Integrity endpoint reflects new site
    ir = requests.get(
        f"{BASE}/api/admin/integrity/employee-visibility",
        params={"email": seed["emp_nosite_email"]}, headers=mh,
    )
    assert ir.status_code == 200, ir.text
    ij = ir.json()
    # tolerate either flat or nested response
    eff = ij.get("effective_site_id") or ij.get("user", {}).get("site_id") or ij.get("employee", {}).get("site_id")
    assert eff == seed["site_b"], f"integrity didn't reflect new site: {ij}"

    # After: employee /api/vendors now returns the mapped vendor
    r = requests.get(f"{BASE}/api/vendors", headers=eh)
    assert r.status_code == 200
    vids = {v.get("id") or v.get("_id") for v in r.json()}
    assert seed["vendor_id"] in vids, f"vendor {seed['vendor_id']} not visible; got {r.json()}"
