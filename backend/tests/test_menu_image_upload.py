"""Tests for iteration-25 Menu Item Image feature.

Covers:
  POST   /api/menu/{item_id}/image           (live menu photo upload)
  DELETE /api/menu/{item_id}/image           (live menu photo clear)
  POST   /api/onboarding/vendors/{onb}/menu/{item}/image  (draft menu upload)
  DELETE /api/onboarding/vendors/{onb}/menu/{item}/image  (draft menu clear)
  POST   /api/ai/menu-photos/regenerate/{id} — vendor RBAC + paid gating

Vendor auth is faked by inserting user docs directly into Mongo (bcrypt
password hash) — same pattern used by test_free_menu_photos.py — because
the auto-provisioning /onboarding/vendors/{id}/publish flow is too
expensive to run per test.
"""
import io
import os
import uuid
from datetime import datetime, timezone

import bcrypt
import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient

# ── env / base URL ─────────────────────────────────────────────────────────
_BASE = os.environ.get("REACT_APP_BACKEND_URL")
if not _BASE:
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    _BASE = line.split("=", 1)[1].strip()
                    break
    except Exception:
        pass
assert _BASE, "REACT_APP_BACKEND_URL not set"
BASE_URL = _BASE.rstrip("/")
API = f"{BASE_URL}/api"

MASTER_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@cravitoo.com")
MASTER_PASS = os.environ.get("ADMIN_PASSWORD", "admin123")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "cravitoo_db")


# ── DB / login fixtures ────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


def _login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def master_session():
    return _login(MASTER_EMAIL, MASTER_PASS)


def _make_user(db, role: str, email: str, extras: dict | None = None) -> ObjectId:
    pwd_hash = bcrypt.hashpw(b"Test1234!", bcrypt.gensalt()).decode()
    email = email.lower()  # login endpoint lower-cases; DB row must match
    doc = {
        "email": email,
        "password_hash": pwd_hash,
        "name": f"TEST {role}",
        "role": role,
        "is_active": True,
        "created_at": datetime.now(timezone.utc),
    }
    if extras:
        doc.update(extras)
    return db.users.insert_one(doc).inserted_id


@pytest.fixture(scope="module")
def scratch_state(db):
    """Set up two vendors + one employee + two menu items (one per vendor).

    Vendor-A owns item-A, Vendor-B owns item-B. Cleanup wipes everything.
    """
    tag = uuid.uuid4().hex[:8]
    vendor_a_id = str(ObjectId())
    vendor_b_id = str(ObjectId())

    # user docs
    va = _make_user(db, "vendor", f"TEST_va_{tag}@example.com", {"vendor_id": vendor_a_id})
    vb = _make_user(db, "vendor", f"TEST_vb_{tag}@example.com", {"vendor_id": vendor_b_id})
    emp = _make_user(db, "employee", f"TEST_emp_{tag}@example.com")

    # menu items — insert directly to bypass the vendor→site mapping req
    item_a = db.menu_items.insert_one({
        "name": f"TEST_ItemA_{tag}",
        "description": "veg paneer",
        "category": "Main",
        "price": 150.0,
        "is_vegetarian": True,
        "is_available": True,
        "vendor_id": vendor_a_id,
        "image_url": None,
        "created_at": datetime.now(timezone.utc),
    }).inserted_id
    item_b = db.menu_items.insert_one({
        "name": f"TEST_ItemB_{tag}",
        "description": "veg dal",
        "category": "Main",
        "price": 120.0,
        "is_vegetarian": True,
        "is_available": True,
        "vendor_id": vendor_b_id,
        "image_url": None,
        "created_at": datetime.now(timezone.utc),
    }).inserted_id

    state = {
        "tag": tag,
        "vendor_a_user": va, "vendor_b_user": vb, "emp_user": emp,
        "vendor_a_id": vendor_a_id, "vendor_b_id": vendor_b_id,
        "item_a": str(item_a), "item_b": str(item_b),
        "email_va": f"test_va_{tag}@example.com",
        "email_vb": f"test_vb_{tag}@example.com",
        "email_emp": f"test_emp_{tag}@example.com",
    }
    yield state

    # cleanup
    db.users.delete_many({"_id": {"$in": [va, vb, emp]}})
    db.menu_items.delete_many({"_id": {"$in": [item_a, item_b]}})


@pytest.fixture(scope="module")
def vendor_a_session(scratch_state):
    return _login(scratch_state["email_va"], "Test1234!")


@pytest.fixture(scope="module")
def vendor_b_session(scratch_state):
    return _login(scratch_state["email_vb"], "Test1234!")


@pytest.fixture(scope="module")
def employee_session(scratch_state):
    return _login(scratch_state["email_emp"], "Test1234!")


# helpers ────────────────────────────────────────────────────────────────────
def _tiny_png() -> bytes:
    # smallest valid 1x1 PNG
    import base64
    return base64.b64decode(
        b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )


def _upload(session, item_id, filename="pic.png", content=None, content_type="image/png"):
    files = {"file": (filename, io.BytesIO(content if content is not None else _tiny_png()), content_type)}
    return session.post(f"{API}/menu/{item_id}/image", files=files, timeout=30)


# ── POST /menu/{item_id}/image ────────────────────────────────────────────
class TestLiveMenuUploadRBAC:
    def test_master_admin_upload_ok(self, master_session, scratch_state, db):
        r = _upload(master_session, scratch_state["item_a"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["menu_item_id"] == scratch_state["item_a"]
        assert body["image_url"] and body["image_url"].startswith("/api/uploads/s_"), body
        # persisted
        row = db.menu_items.find_one({"_id": ObjectId(scratch_state["item_a"])})
        assert row["image_url"] == body["image_url"]
        assert row["image_source"] == "admin_upload"

    def test_owning_vendor_upload_ok(self, vendor_a_session, scratch_state, db):
        r = _upload(vendor_a_session, scratch_state["item_a"])
        assert r.status_code == 200, r.text
        assert r.json()["image_url"].startswith("/api/uploads/s_")
        row = db.menu_items.find_one({"_id": ObjectId(scratch_state["item_a"])})
        assert row["image_source"] == "vendor_upload"

    def test_non_owning_vendor_upload_forbidden(self, vendor_b_session, scratch_state):
        r = _upload(vendor_b_session, scratch_state["item_a"])
        assert r.status_code == 403, r.text
        assert "vendor" in r.text.lower() or "master" in r.text.lower()

    def test_employee_upload_forbidden(self, employee_session, scratch_state):
        r = _upload(employee_session, scratch_state["item_a"])
        assert r.status_code == 403

    def test_unauthenticated_upload_401(self, scratch_state):
        files = {"file": ("p.png", io.BytesIO(_tiny_png()), "image/png")}
        r = requests.post(f"{API}/menu/{scratch_state['item_a']}/image", files=files, timeout=15)
        assert r.status_code == 401

    def test_upload_over_5mb_400(self, master_session, scratch_state):
        big = b"\x89PNG\r\n\x1a\n" + b"0" * (5 * 1024 * 1024 + 10)
        r = _upload(master_session, scratch_state["item_a"], content=big)
        assert r.status_code == 400
        assert "5 mb" in r.text.lower() or "5mb" in r.text.lower()

    def test_upload_bad_extension_400(self, master_session, scratch_state):
        # server checks extension of filename, not mime — a .txt is rejected
        r = _upload(master_session, scratch_state["item_a"],
                    filename="virus.txt", content=b"hello", content_type="text/plain")
        assert r.status_code == 400
        assert "png" in r.text.lower() or "type" in r.text.lower()

    def test_upload_unknown_item_404(self, master_session):
        fake = str(ObjectId())
        r = _upload(master_session, fake)
        assert r.status_code == 404


# ── DELETE /menu/{item_id}/image ──────────────────────────────────────────
class TestLiveMenuClearRBAC:
    def test_master_clear_ok(self, master_session, scratch_state, db):
        # ensure an image is present first
        _upload(master_session, scratch_state["item_a"])
        r = master_session.delete(f"{API}/menu/{scratch_state['item_a']}/image", timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["image_url"] is None
        row = db.menu_items.find_one({"_id": ObjectId(scratch_state["item_a"])})
        assert row["image_url"] is None
        assert row["image_source"] is None

    def test_owning_vendor_clear_ok(self, vendor_a_session, master_session, scratch_state):
        _upload(master_session, scratch_state["item_a"])
        r = vendor_a_session.delete(f"{API}/menu/{scratch_state['item_a']}/image", timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["image_url"] is None

    def test_non_owning_vendor_clear_forbidden(self, vendor_b_session, scratch_state):
        r = vendor_b_session.delete(f"{API}/menu/{scratch_state['item_a']}/image", timeout=15)
        assert r.status_code == 403

    def test_employee_clear_forbidden(self, employee_session, scratch_state):
        r = employee_session.delete(f"{API}/menu/{scratch_state['item_a']}/image", timeout=15)
        assert r.status_code == 403


# ── GET /menu/{vendor_id} propagation ─────────────────────────────────────
class TestVendorMenuFeed:
    def test_uploaded_image_appears_in_vendor_menu(self, master_session, scratch_state):
        # upload fresh, then read the public per-vendor feed
        up = _upload(master_session, scratch_state["item_a"])
        assert up.status_code == 200
        url = up.json()["image_url"]
        r = master_session.get(f"{API}/menu/{scratch_state['vendor_a_id']}", timeout=15)
        assert r.status_code == 200
        items = r.json()
        match = next((it for it in items if it.get("id") == scratch_state["item_a"]
                      or it.get("_id") == scratch_state["item_a"]), None)
        assert match is not None, f"item not returned: {items}"
        assert match.get("image_url") == url


# ── Onboarding draft-menu image endpoints ─────────────────────────────────
@pytest.fixture(scope="module")
def onboarding_row(master_session, db):
    """Create a site + onboarding draft with one draft menu item."""
    # reuse an existing site if any
    r = master_session.get(f"{API}/sites", timeout=15)
    sites = r.json() if r.status_code == 200 else []
    if sites:
        site_id = sites[0]["id"]
    else:
        # minimal site — city/corp helpers may 400 in a wiped env, best effort
        r = master_session.get(f"{API}/cities", timeout=15)
        cities = r.json() if r.status_code == 200 else []
        city_id = cities[0]["id"] if cities else None
        payload = {"name": f"TEST_Site_{uuid.uuid4().hex[:6]}", "address": "1 rd",
                   "city": "Bengaluru", "city_id": city_id,
                   "contact_email": f"s_{uuid.uuid4().hex[:6]}@x.com", "contact_phone": "9000000000"}
        rr = master_session.post(f"{API}/sites", json=payload, timeout=15)
        if rr.status_code not in (200, 201):
            pytest.skip(f"cannot create site for onboarding tests: {rr.status_code} {rr.text}")
        site_id = rr.json()["id"]

    payload = {
        "vendor_name": f"TEST_onb_{uuid.uuid4().hex[:6]}",
        "company_name": "TEST Foods",
        "contact_person": "T",
        "mobile_number": "9999999999",
        "email": f"onb_{uuid.uuid4().hex[:6]}@example.com",
        "business_address": "1 rd",
        "cuisine_type": "Multi",
        "site_id": site_id,
    }
    r = master_session.post(f"{API}/onboarding/vendors", json=payload, timeout=15)
    if r.status_code not in (200, 201):
        pytest.skip(f"onboarding create failed: {r.status_code} {r.text}")
    onb_id = r.json()["id"]

    # add a draft menu item
    r = master_session.post(f"{API}/onboarding/vendors/{onb_id}/menu",
                            json={"name": "Draft Item", "price": 50}, timeout=15)
    assert r.status_code == 200, r.text
    item_id = r.json()["item"]["item_id"]

    yield {"onb_id": onb_id, "item_id": item_id}

    # cleanup: drop the onboarding row
    try:
        db.vendor_onboarding.delete_one({"_id": ObjectId(onb_id)})
    except Exception:
        pass


class TestOnboardingDraftImage:
    def test_master_upload_and_clear(self, master_session, onboarding_row, db):
        onb = onboarding_row["onb_id"]; item = onboarding_row["item_id"]
        files = {"file": ("p.png", io.BytesIO(_tiny_png()), "image/png")}
        r = master_session.post(f"{API}/onboarding/vendors/{onb}/menu/{item}/image",
                                files=files, timeout=30)
        assert r.status_code == 200, r.text
        url = r.json()["image_url"]
        assert url.startswith("/api/uploads/s_"), url
        # persisted in draft_menu
        row = db.vendor_onboarding.find_one({"_id": ObjectId(onb)})
        m = next(x for x in row["draft_menu"] if x["item_id"] == item)
        assert m["image_url"] == url

        r = master_session.delete(f"{API}/onboarding/vendors/{onb}/menu/{item}/image", timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["image_url"] is None

    def test_vendor_role_cannot_upload_draft(self, vendor_a_session, onboarding_row):
        onb = onboarding_row["onb_id"]; item = onboarding_row["item_id"]
        files = {"file": ("p.png", io.BytesIO(_tiny_png()), "image/png")}
        r = vendor_a_session.post(f"{API}/onboarding/vendors/{onb}/menu/{item}/image",
                                  files=files, timeout=15)
        assert r.status_code == 403

    def test_upload_unknown_item_404(self, master_session, onboarding_row):
        onb = onboarding_row["onb_id"]
        files = {"file": ("p.png", io.BytesIO(_tiny_png()), "image/png")}
        r = master_session.post(f"{API}/onboarding/vendors/{onb}/menu/{uuid.uuid4()}/image",
                                files=files, timeout=15)
        assert r.status_code == 404

    def test_upload_bad_extension_400(self, master_session, onboarding_row):
        onb = onboarding_row["onb_id"]; item = onboarding_row["item_id"]
        files = {"file": ("bad.txt", io.BytesIO(b"x"), "text/plain")}
        r = master_session.post(f"{API}/onboarding/vendors/{onb}/menu/{item}/image",
                                files=files, timeout=15)
        assert r.status_code == 400


# ── AI regenerate RBAC ────────────────────────────────────────────────────
class TestAIRegenerateRBAC:
    """Only auth/routing paths — no paid live gen; free gen is fast (Unsplash)."""

    def test_non_owning_vendor_forbidden(self, vendor_b_session, scratch_state):
        r = vendor_b_session.post(
            f"{API}/ai/menu-photos/regenerate/{scratch_state['item_a']}",
            json={"source": "free"}, timeout=30,
        )
        assert r.status_code == 403
        assert "master" in r.text.lower() or "owning" in r.text.lower()

    def test_owning_vendor_paid_forbidden(self, vendor_a_session, scratch_state):
        r = vendor_a_session.post(
            f"{API}/ai/menu-photos/regenerate/{scratch_state['item_a']}",
            json={"source": "paid"}, timeout=15,
        )
        assert r.status_code == 403
        assert "master admin" in r.text.lower()

    def test_employee_forbidden(self, employee_session, scratch_state):
        r = employee_session.post(
            f"{API}/ai/menu-photos/regenerate/{scratch_state['item_a']}",
            json={"source": "free"}, timeout=15,
        )
        assert r.status_code == 403

    def test_unknown_item_404(self, master_session):
        r = master_session.post(
            f"{API}/ai/menu-photos/regenerate/{ObjectId()}",
            json={"source": "free"}, timeout=15,
        )
        assert r.status_code == 404
