"""Regression tests for the FREE menu-photo path.

Covers POST /api/ai/menu-photos/suggest-free — Unsplash Source → Pollinations
fallback — plus its interaction with the ai-photos/spend aggregator.
"""
import os
import uuid
from datetime import datetime, timezone

import bcrypt
import pytest
import requests
from pymongo import MongoClient

_BASE = os.environ.get("REACT_APP_BACKEND_URL")
if not _BASE:
    # Fall back to frontend/.env when running pytest outside of a shell that exports the var.
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

MASTER_EMAIL = os.environ.get("ADMIN_EMAIL")
MASTER_PASS = os.environ.get("ADMIN_PASSWORD")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "cravitoo_db")


@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def master_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": MASTER_EMAIL, "password": MASTER_PASS}, timeout=15)
    assert r.status_code == 200, f"master login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def employee_session(db):
    email = f"test_free_photo_emp_{uuid.uuid4().hex[:6]}@example.com"
    pwd = "Test1234!"
    hashed = bcrypt.hashpw(pwd.encode(), bcrypt.gensalt()).decode()
    ins = db.users.insert_one({
        "email": email,
        "password_hash": hashed,
        "name": "TEST Employee",
        "role": "employee",
        "is_active": True,
        "created_at": datetime.now(timezone.utc),
    })
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, f"employee login failed: {r.status_code} {r.text}"
    yield s
    db.users.delete_one({"_id": ins.inserted_id})


# ---------------- Auth ----------------

def test_unauthenticated_returns_401():
    r = requests.post(f"{API}/ai/menu-photos/suggest-free", json={"name": "Paneer"}, timeout=15)
    assert r.status_code == 401


def test_employee_returns_403(employee_session):
    r = employee_session.post(f"{API}/ai/menu-photos/suggest-free",
                              json={"name": "Paneer Butter Masala"}, timeout=15)
    assert r.status_code == 403
    assert "cravitoo admins" in r.text.lower()


# ---------------- Validation ----------------

def test_empty_name_returns_422(master_session):
    r = master_session.post(f"{API}/ai/menu-photos/suggest-free",
                            json={"name": "", "is_vegetarian": True}, timeout=15)
    assert r.status_code == 422


def test_name_too_long_returns_422(master_session):
    r = master_session.post(f"{API}/ai/menu-photos/suggest-free",
                            json={"name": "x" * 121}, timeout=15)
    assert r.status_code == 422


def test_count_over_max_returns_422(master_session):
    r = master_session.post(f"{API}/ai/menu-photos/suggest-free",
                            json={"name": "Paneer", "count": 5}, timeout=15)
    assert r.status_code == 422


# ---------------- Happy path ----------------

def test_happy_path_returns_image(master_session, db):
    payload = {"name": "Paneer Butter Masala", "is_vegetarian": True, "cuisine_hint": "indian"}
    r = master_session.post(f"{API}/ai/menu-photos/suggest-free", json=payload, timeout=90)
    if r.status_code == 502:
        pytest.skip(f"Both free photo sources unavailable in test env: {r.text}")
    assert r.status_code == 200, f"got {r.status_code}: {r.text[:400]}"
    data = r.json()
    assert data["source"] in ("unsplash", "pollinations")
    assert "suggestions" in data and len(data["suggestions"]) >= 1
    s0 = data["suggestions"][0]
    assert "url" in s0 and "storage_path" in s0 and "size" in s0
    # URL contract from the spec
    assert s0["url"].startswith("/api/uploads/s_") or s0["url"].startswith("/api/uploads/"), \
        f"url does not look like an emergent-storage URL: {s0['url']}"
    assert s0["storage_path"].startswith("cravitoo/menu-photos-free/"), \
        f"storage_path missing prefix: {s0['storage_path']}"
    assert s0["size"] > 1024

    # GET the returned URL and verify it's an actual image
    img_url = s0["url"]
    if img_url.startswith("/"):
        img_url = BASE_URL + img_url
    g = master_session.get(img_url, timeout=30)
    assert g.status_code == 200, f"image fetch failed: {g.status_code} {g.text[:200]}"
    ct = g.headers.get("Content-Type", "")
    assert ct.startswith("image/"), f"Content-Type not image/*: {ct}"
    # Body size approximately matches
    assert abs(len(g.content) - s0["size"]) < max(2048, s0["size"] * 0.02), \
        f"body size drift: got {len(g.content)} vs reported {s0['size']}"

    # Ensure audit row was inserted with cost_inr=0
    row = db.ai_image_generations.find_one(
        {"item_name": payload["name"], "cost_inr": 0},
        sort=[("created_at", -1)],
    )
    assert row is not None, "expected an ai_image_generations audit row with cost_inr=0"
    assert row.get("source") in ("unsplash", "pollinations")


# ---------------- Spend endpoint interaction ----------------

def test_free_rows_do_not_inflate_spend(master_session, db):
    """A free-photo row (cost_inr=0, count_generated=1) is stored in
    ai_image_generations. The /admin/ai-photos/spend aggregator SHOULD
    exclude free rows so the ₹ dashboard stays accurate."""
    before = master_session.get(f"{API}/admin/ai-photos/spend", timeout=15).json()
    now = datetime.now(timezone.utc)
    ins = db.ai_image_generations.insert_one({
        "created_at": now,
        "count_generated": 1,
        "cost_inr": 0,
        "source": "unsplash",
        "user_email": MASTER_EMAIL,
        "item_name": "TEST_free_spend_probe",
        "_scratch": True,
    })
    try:
        after = master_session.get(f"{API}/admin/ai-photos/spend", timeout=15).json()
        delta_images = after["month_to_date"]["images"] - before["month_to_date"]["images"]
        delta_spend = round(after["month_to_date"]["spend_inr"] - before["month_to_date"]["spend_inr"], 2)
        assert delta_spend == 0, (
            f"free rows inflated spend by ₹{delta_spend} (delta_images={delta_images}). "
            "Aggregator must filter cost_inr==0 rows."
        )
    finally:
        db.ai_image_generations.delete_one({"_id": ins.inserted_id})


# ---------------- Regression: paid /suggest still exists ----------------

def test_paid_suggest_endpoint_still_wired(master_session):
    """Regression — POST /ai/menu-photos/suggest must still be routed and
    must NOT hit a Pydantic validation error introduced by the module-level
    MenuPhotoFreeRequest. We don't spend real credit here — an empty body
    should trip validation (422) proving the route is registered."""
    r = master_session.post(f"{API}/ai/menu-photos/suggest", json={}, timeout=15)
    # 422 → route wired, validator ran. 404 would mean regression.
    assert r.status_code in (422, 400), f"paid endpoint regression: got {r.status_code} {r.text[:200]}"


def test_paid_suggest_endpoint_rejects_employee(employee_session):
    """403 also proves route is wired but role-gated."""
    r = employee_session.post(f"{API}/ai/menu-photos/suggest",
                              json={"name": "Paneer", "count": 1}, timeout=15)
    assert r.status_code == 403
