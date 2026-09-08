"""Tests for GET /api/admin/ai-photos/spend (Master Admin AI image cost tracker)."""
import os
from datetime import datetime, timezone

import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://admin-sales-report.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MASTER_EMAIL = os.environ.get("ADMIN_EMAIL")
MASTER_PASS = os.environ.get("ADMIN_PASSWORD")

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "cravitoo_db"


@pytest.fixture(scope="module")
def master_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": MASTER_EMAIL, "password": MASTER_PASS}, timeout=15)
    assert r.status_code == 200, f"master login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


# --- Schema + math ---
def test_schema_and_math(master_session):
    r = master_session.get(f"{API}/admin/ai-photos/spend", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["price_per_image_inr"] == 3.5
    for bucket in ("month_to_date", "last_30_days", "all_time"):
        assert bucket in data
        b = data[bucket]
        for k in ("rows", "images", "spend_inr"):
            assert k in b, f"{bucket} missing {k}"
        assert round(b["images"] * 3.5, 2) == b["spend_inr"], f"{bucket} spend math mismatch"
    # since = 1st of current month at 00:00 UTC
    since = data["month_to_date"]["since"]
    parsed = datetime.fromisoformat(since)
    now = datetime.now(timezone.utc)
    assert parsed.day == 1
    assert parsed.hour == 0 and parsed.minute == 0 and parsed.second == 0
    assert parsed.month == now.month and parsed.year == now.year


# --- Auth ---
def test_unauth_returns_401():
    r = requests.get(f"{API}/admin/ai-photos/spend", timeout=15)
    assert r.status_code == 401


def test_non_master_returns_403(db):
    import uuid, bcrypt
    email = f"test_nonmaster_{uuid.uuid4().hex[:6]}@example.com"
    pwd = "Test1234!"
    hashed = bcrypt.hashpw(pwd.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    user_doc = {
        "email": email,
        "password_hash": hashed,
        "name": "Scratch NonMaster",
        "role": "employee",
        "is_active": True,
        "created_at": datetime.now(timezone.utc),
    }
    inserted = db.users.insert_one(user_doc)
    try:
        s = requests.Session()
        login = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=15)
        assert login.status_code == 200, f"login failed: {login.status_code} {login.text}"
        r = s.get(f"{API}/admin/ai-photos/spend", timeout=15)
        assert r.status_code == 403
        assert "master admin" in r.text.lower()
    finally:
        db.users.delete_one({"_id": inserted.inserted_id})


# --- Aggregation supports both shapes ---
def test_aggregation_handles_both_shapes(master_session, db):
    # Baseline
    before = master_session.get(f"{API}/admin/ai-photos/spend", timeout=15).json()
    mtd_before = before["month_to_date"]["images"]

    now = datetime.now(timezone.utc)
    ids = []
    ids.append(db.ai_image_generations.insert_one({
        "created_at": now, "count_generated": 3, "_scratch": True,
    }).inserted_id)
    ids.append(db.ai_image_generations.insert_one({
        "created_at": now, "filled": 2, "_scratch": True,
    }).inserted_id)

    try:
        after = master_session.get(f"{API}/admin/ai-photos/spend", timeout=15).json()
        delta_images = after["month_to_date"]["images"] - mtd_before
        assert delta_images == 5, f"expected +5 images, got +{delta_images}"
        delta_spend = round(after["month_to_date"]["spend_inr"] - before["month_to_date"]["spend_inr"], 2)
        assert delta_spend == 17.5, f"expected +17.5 spend, got +{delta_spend}"
    finally:
        db.ai_image_generations.delete_many({"_id": {"$in": ids}})


# --- Empty collection returns zeros ---
def test_empty_collection_returns_zeros(master_session, db):
    # Save all docs, wipe, hit endpoint, restore
    backup = list(db.ai_image_generations.find({}))
    if backup:
        db.ai_image_generations.delete_many({})
    try:
        r = master_session.get(f"{API}/admin/ai-photos/spend", timeout=15)
        assert r.status_code == 200
        d = r.json()
        for bucket in ("month_to_date", "last_30_days", "all_time"):
            assert d[bucket]["rows"] == 0
            assert d[bucket]["images"] == 0
            assert d[bucket]["spend_inr"] == 0
    finally:
        if backup:
            db.ai_image_generations.insert_many(backup)
