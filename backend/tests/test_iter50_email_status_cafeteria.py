"""
Iter 50 backend tests:
  1. GET /api/admin/vendors/email-status — master-only aggregate of latest
     vendor_email_log entry per vendor.
  2. POST /api/onboarding/vendors/{onb_id}/master-decision with cafeteria_id —
     stores that cafeteria on vendor_site_mappings when valid for the site,
     falls back to the site's default when omitted or invalid.
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "admin@cravitoo.com"
ADMIN_PASSWORD = "admin123"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "cravitoo_db")


@pytest.fixture(scope="module")
def db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


# --- helpers ------------------------------------------------------------
def _make_site(db):
    slug = uuid.uuid4().hex[:6]
    doc = {
        "name": f"TEST_iter50_site_{slug}",
        "address": "QA",
        "corporate_id": None,
        "is_active": True,
        "created_at": datetime.now(timezone.utc),
    }
    ins = db.sites.insert_one(doc)
    return str(ins.inserted_id), doc["name"]


def _make_cafeteria(db, site_id, name, is_default=False):
    doc = {
        "site_id": site_id,
        "name": name,
        "is_default": is_default,
        "is_active": True,
        "created_at": datetime.now(timezone.utc),
    }
    ins = db.cafeterias.insert_one(doc)
    return str(ins.inserted_id)


def _make_onboarding(db, site_id=None, prefix="iter50"):
    slug = uuid.uuid4().hex[:6]
    email = f"TEST_{prefix}_{slug}@example.com"
    vname = f"TEST_iter50_vendor_{slug}"
    doc = {
        "vendor_name": vname,
        "company_name": vname,
        "email": email,
        "contact_person": "QA",
        "mobile_number": "+919000000002",
        "cuisine_type": "Indian",
        "business_address": "QA",
        "site_id": site_id,
        "draft_menu": [],
        "remarks": [],
        "checklist": {},
        "status": "under_master_review",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    ins = db.vendor_onboarding.insert_one(doc)
    return str(ins.inserted_id), email, vname


def _cleanup_onboarding(db, onb_id, email, vname):
    try:
        db.vendor_onboarding.delete_one({"_id": ObjectId(onb_id)})
        db.users.delete_many({"email": email})
        db.vendor_magic_links.delete_many({"email": email})
        db.vendor_email_log.delete_many({"email": email})
        vendors = list(db.vendors.find({"$or": [{"email": email}, {"name": vname}]}, {"_id": 1}))
        vids = [str(v["_id"]) for v in vendors]
        db.vendors.delete_many({"_id": {"$in": [v["_id"] for v in vendors]}})
        if vids:
            db.vendor_site_mappings.delete_many({"vendor_id": {"$in": vids}})
            db.menu_items.delete_many({"vendor_id": {"$in": vids}})
            db.vendor_email_log.delete_many({"vendor_id": {"$in": vids}})
    except Exception as e:
        print(f"onb cleanup err: {e}")


def _cleanup_site(db, site_id):
    try:
        db.cafeterias.delete_many({"site_id": site_id})
        db.sites.delete_one({"_id": ObjectId(site_id)})
    except Exception as e:
        print(f"site cleanup err: {e}")


# =====================================================================
# TEST 1: /api/admin/vendors/email-status
# =====================================================================
def test_email_status_requires_master(admin_session):
    """Non-authenticated → 401/403."""
    r = requests.get(f"{BASE_URL}/api/admin/vendors/email-status", timeout=30)
    assert r.status_code in (401, 403), f"unauth should be 401/403, got {r.status_code}"


def test_email_status_master_returns_map_after_resend(admin_session, db):
    """Approve a vendor (with a site — iter51 guard now blocks site-less
    approvals), then resend onboarding → email-status must contain that vendor
    with status 'sent' (preview mocks Resend as success)."""
    site_id, _ = _make_site(db)
    _make_cafeteria(db, site_id, "TEST_iter50_es_default", is_default=True)
    onb_id, email, vname = _make_onboarding(db, site_id=site_id, prefix="es")
    try:
        # Approve first so a vendors row exists to resend against
        r = admin_session.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/master-decision",
            json={"decision": "approve", "remarks": "iter50 email-status"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        vendor = db.vendors.find_one({"email": email})
        assert vendor is not None
        vid = str(vendor["_id"])

        # Resend onboarding email so a vendor_email_log entry is written
        rs = admin_session.post(
            f"{BASE_URL}/api/admin/vendors/{vid}/resend-onboarding",
            json={}, timeout=30,
        )
        assert rs.status_code == 200, f"resend failed: {rs.status_code} {rs.text}"

        # email-status must have this vendor
        es = admin_session.get(f"{BASE_URL}/api/admin/vendors/email-status", timeout=30)
        assert es.status_code == 200, es.text
        mp = es.json()
        assert isinstance(mp, dict), type(mp)
        assert vid in mp, f"vendor {vid} missing from map (keys={list(mp.keys())[:5]}...)"
        entry = mp[vid]
        assert entry.get("status") in ("sent", "failed"), entry
        # `at` must be an ISO string
        assert isinstance(entry.get("at"), str) and "T" in entry["at"], entry
    finally:
        _cleanup_onboarding(db, onb_id, email, vname)
        _cleanup_site(db, site_id)


# =====================================================================
# TEST 2: cafeteria on approval
# =====================================================================
def test_approve_with_valid_cafeteria_id_assigns_mapping(admin_session, db):
    site_id, sname = _make_site(db)
    caf_default = _make_cafeteria(db, site_id, "TEST_iter50_default_caf", is_default=True)
    caf_second = _make_cafeteria(db, site_id, "TEST_iter50_second_caf", is_default=False)
    onb_id, email, vname = _make_onboarding(db, site_id=site_id, prefix="cafok")
    try:
        r = admin_session.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/master-decision",
            json={"decision": "approve", "cafeteria_id": caf_second, "remarks": "iter50 caf-valid"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        vendor = db.vendors.find_one({"email": email})
        assert vendor is not None
        vid = str(vendor["_id"])
        mp = db.vendor_site_mappings.find_one({"vendor_id": vid, "site_id": site_id})
        assert mp is not None, "vendor_site_mappings row missing"
        assert mp.get("cafeteria_id") == caf_second, (
            f"expected chosen cafeteria {caf_second}, got {mp.get('cafeteria_id')}"
        )
    finally:
        _cleanup_onboarding(db, onb_id, email, vname)
        _cleanup_site(db, site_id)


def test_approve_with_invalid_cafeteria_id_falls_back_to_default(admin_session, db):
    site_id, sname = _make_site(db)
    caf_default = _make_cafeteria(db, site_id, "TEST_iter50_fb_default", is_default=True)
    # cafeteria on a DIFFERENT site — invalid for our onboarding's site
    other_site_id, _ = _make_site(db)
    caf_other = _make_cafeteria(db, other_site_id, "TEST_iter50_other_site_caf", is_default=True)
    onb_id, email, vname = _make_onboarding(db, site_id=site_id, prefix="caffb")
    try:
        r = admin_session.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/master-decision",
            json={"decision": "approve", "cafeteria_id": caf_other, "remarks": "iter50 caf-fb"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        vendor = db.vendors.find_one({"email": email})
        vid = str(vendor["_id"])
        mp = db.vendor_site_mappings.find_one({"vendor_id": vid, "site_id": site_id})
        assert mp is not None
        assert mp.get("cafeteria_id") == caf_default, (
            f"expected fallback to default {caf_default}, got {mp.get('cafeteria_id')}"
        )
    finally:
        _cleanup_onboarding(db, onb_id, email, vname)
        _cleanup_site(db, site_id)
        _cleanup_site(db, other_site_id)


def test_approve_without_cafeteria_id_uses_default(admin_session, db):
    site_id, sname = _make_site(db)
    caf_default = _make_cafeteria(db, site_id, "TEST_iter50_nodef_default", is_default=True)
    onb_id, email, vname = _make_onboarding(db, site_id=site_id, prefix="cafnone")
    try:
        r = admin_session.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/master-decision",
            json={"decision": "approve", "remarks": "iter50 caf-none"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        vendor = db.vendors.find_one({"email": email})
        vid = str(vendor["_id"])
        mp = db.vendor_site_mappings.find_one({"vendor_id": vid, "site_id": site_id})
        assert mp is not None
        assert mp.get("cafeteria_id") == caf_default, (
            f"expected default {caf_default}, got {mp.get('cafeteria_id')}"
        )
    finally:
        _cleanup_onboarding(db, onb_id, email, vname)
        _cleanup_site(db, site_id)
