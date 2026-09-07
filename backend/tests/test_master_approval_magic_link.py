"""
Backend tests for MASTER APPROVAL magic-link flow (iter 49).

Verifies: POST /api/onboarding/vendors/{onb_id}/master-decision {decision:'approve'}
returns status=active + non-empty token + magic_url on preview host, GET verify
works, complete sets password + role=vendor, second verify -> 410 (single-use),
email/password login succeeds, reject branch does NOT include magic_url/token.
"""
import os
import re
import uuid
from datetime import datetime, timezone

import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
PREVIEW_ORIGIN = "https://duplicate-prevention-4.preview.emergentagent.com"

ADMIN_EMAIL = "admin@cravitoo.com"
ADMIN_PASSWORD = "admin123"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "cravitoo_db")

TOKEN_RE = re.compile(r"/auth/magic/([A-Za-z0-9_\-]+)")


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


def _make_onboarding(db, prefix="approve"):
    slug = uuid.uuid4().hex[:6]
    email = f"TEST_{prefix}_{slug}@example.com"
    vendor_name = f"TEST_ApprVendor_{slug}"
    doc = {
        "vendor_name": vendor_name,
        "company_name": vendor_name,
        "email": email,
        "contact_person": "QA Approve",
        "mobile_number": "+919000000001",
        "cuisine_type": "Indian",
        "business_address": "QA Test Address",
        "site_id": None,
        "draft_menu": [],
        "remarks": [],
        "checklist": {},
        "status": "under_master_review",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    ins = db.vendor_onboarding.insert_one(doc)
    return str(ins.inserted_id), email, vendor_name


def _cleanup(db, onb_id, email, vendor_name):
    try:
        db.vendor_onboarding.delete_one({"_id": ObjectId(onb_id)})
        db.users.delete_many({"email": email})
        db.vendor_magic_links.delete_many({"email": email})
        db.vendor_email_log.delete_many({"email": email})
        vendors = list(db.vendors.find({"$or": [{"email": email}, {"name": vendor_name}]}, {"_id": 1}))
        vids = [str(v["_id"]) for v in vendors]
        db.vendors.delete_many({"_id": {"$in": [v["_id"] for v in vendors]}})
        if vids:
            db.vendor_site_mappings.delete_many({"vendor_id": {"$in": vids}})
            db.menu_items.delete_many({"vendor_id": {"$in": vids}})
    except Exception as e:
        print(f"cleanup err: {e}")


# ---------- Test 1: approve returns magic_url + token, verify, complete, single-use, login ----------
def test_master_approval_end_to_end(admin_session, db):
    onb_id, email, vname = _make_onboarding(db)
    try:
        r = admin_session.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/master-decision",
            json={"decision": "approve", "remarks": "QA approve"}, timeout=30,
        )
        assert r.status_code == 200, f"approve failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("status") == "active", data
        token = data.get("token")
        magic_url = data.get("magic_url")
        assert token and isinstance(token, str) and len(token) > 10, data
        assert magic_url and magic_url.startswith(f"{PREVIEW_ORIGIN}/auth/magic/"), magic_url
        assert magic_url.endswith(f"/auth/magic/{token}"), magic_url
        assert "app.cravitoo.com" not in magic_url
        assert "emergentcf.cloud" not in magic_url

        # verify token (non-consuming)
        v = requests.get(f"{BASE_URL}/api/auth/magic/{token}", timeout=30)
        assert v.status_code == 200, f"verify failed: {v.status_code} {v.text}"
        vd = v.json()
        assert (vd.get("email") or "").lower() == email.lower()
        assert vd.get("purpose") == "onboarding"

        # complete
        c = requests.post(f"{BASE_URL}/api/auth/magic/{token}/complete",
                          json={"password": "ApprPass123"}, timeout=30)
        assert c.status_code == 200, f"complete failed: {c.status_code} {c.text}"
        cd = c.json()
        assert cd.get("success") is True
        assert cd.get("role") == "vendor"

        # single-use: 410
        v2 = requests.get(f"{BASE_URL}/api/auth/magic/{token}", timeout=30)
        assert v2.status_code == 410, f"expected 410, got {v2.status_code} {v2.text}"

        # login with new password
        ls = requests.Session()
        lr = ls.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": "ApprPass123"}, timeout=30)
        assert lr.status_code == 200, f"login failed: {lr.status_code} {lr.text}"
        ld = lr.json()
        role = ld.get("role") or (ld.get("user") or {}).get("role")
        assert role == "vendor", ld
    finally:
        _cleanup(db, onb_id, email, vname)


# ---------- Test 2: reject must NOT include magic_url/token ----------
def test_master_rejection_no_magic_link(admin_session, db):
    onb_id, email, vname = _make_onboarding(db, prefix="reject")
    try:
        r = admin_session.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/master-decision",
            json={"decision": "reject", "remarks": "QA reject"}, timeout=30,
        )
        assert r.status_code == 200, f"reject failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("status") == "rejected", data
        assert "magic_url" not in data, f"reject must not include magic_url: {data}"
        assert "token" not in data, f"reject must not include token: {data}"
    finally:
        _cleanup(db, onb_id, email, vname)
