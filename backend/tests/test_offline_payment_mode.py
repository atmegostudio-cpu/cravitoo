"""Backend tests for the Feb-2026 OFFLINE payment mode.

Focus: NEW endpoints (/config/payment-mode, /orders/{id}/mark-paid,
/orders/collect/{code}, /admin/orders/reconciliation) plus regression
that collection_code / payment_mode / payment_method appear where the
frontend expects them.

Full happy-path (create order → mark-paid) requires employee + vendor
test accounts which the Feb-2026 clean-slate wiped. We cover admin
auth + RBAC negatives; the vendor-side happy path is called out in the
report for manual verification.
"""
import os
import pytest
import requests
from bson import ObjectId
from pathlib import Path
from dotenv import load_dotenv

# Load backend .env so MONGO_URL / DB_NAME point at the real DB the API uses.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://corporate-feast.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@cravitoo.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ─── /config/payment-mode ────────────────────────────────────────────
class TestPaymentModeConfig:
    def test_public_no_auth_required(self):
        r = requests.get(f"{API}/config/payment-mode")
        assert r.status_code == 200
        body = r.json()
        assert body == {"mode": "OFFLINE"}, f"expected OFFLINE, got {body}"

    def test_value_is_uppercase_string(self):
        r = requests.get(f"{API}/config/payment-mode")
        assert isinstance(r.json()["mode"], str)
        assert r.json()["mode"].isupper()


# ─── /admin/orders/reconciliation ────────────────────────────────────
class TestReconciliation:
    def test_master_admin_ok(self, admin_headers):
        r = requests.get(f"{API}/admin/orders/reconciliation", headers=admin_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "buckets" in body
        assert body.get("payment_mode") == "OFFLINE"
        expected = {"total", "pending", "cash", "physical_qr", "paid", "unpaid",
                    "ready_for_collection", "collected", "cancelled"}
        assert expected.issubset(set(body["buckets"].keys())), f"missing buckets: {expected - set(body['buckets'].keys())}"
        for name, b in body["buckets"].items():
            assert "count" in b and "amount" in b, f"bucket {name} malformed: {b}"
            assert isinstance(b["count"], int)

    def test_unauthenticated_401(self):
        r = requests.get(f"{API}/admin/orders/reconciliation")
        # FastAPI HTTPBearer returns 403 by default when no header; either is acceptable "denied"
        assert r.status_code in (401, 403), r.status_code


# ─── /orders/{id}/mark-paid RBAC & validation ────────────────────────
class TestMarkPaidRBAC:
    def test_unauthenticated_denied(self):
        fake_id = str(ObjectId())
        r = requests.post(f"{API}/orders/{fake_id}/mark-paid", json={"method": "cash"})
        assert r.status_code in (401, 403)

    def test_master_admin_on_unknown_order_404(self, admin_headers):
        fake_id = str(ObjectId())
        r = requests.post(f"{API}/orders/{fake_id}/mark-paid",
                          json={"method": "cash"}, headers=admin_headers)
        assert r.status_code == 404, f"expected 404 for unknown order, got {r.status_code}: {r.text}"

    def test_invalid_method_422(self, admin_headers):
        fake_id = str(ObjectId())
        r = requests.post(f"{API}/orders/{fake_id}/mark-paid",
                          json={"method": "bitcoin"}, headers=admin_headers)
        assert r.status_code == 422, f"expected 422 for bad method, got {r.status_code}: {r.text}"

    def test_missing_method_422(self, admin_headers):
        fake_id = str(ObjectId())
        r = requests.post(f"{API}/orders/{fake_id}/mark-paid",
                          json={}, headers=admin_headers)
        assert r.status_code == 422

    def test_malformed_order_id_400_or_404(self, admin_headers):
        r = requests.post(f"{API}/orders/not-a-real-id/mark-paid",
                          json={"method": "cash"}, headers=admin_headers)
        # safe_objectid raises HTTPException 400
        assert r.status_code in (400, 404, 422), r.status_code


# ─── /orders/collect/{code} RBAC & validation ────────────────────────
class TestCollectRBAC:
    def test_unauthenticated_denied(self):
        r = requests.post(f"{API}/orders/collect/CRV-999999", json={"method": "cash"})
        assert r.status_code in (401, 403)

    def test_master_admin_unknown_code_404(self, admin_headers):
        r = requests.post(f"{API}/orders/collect/CRV-000000",
                          json={"method": "cash"}, headers=admin_headers)
        assert r.status_code == 404
        assert "CRV-000000" in r.text or "No order" in r.text

    def test_code_normalised_uppercase(self, admin_headers):
        # lowercase code should be normalised then still 404
        r = requests.post(f"{API}/orders/collect/crv-000000",
                          json={"method": "cash"}, headers=admin_headers)
        assert r.status_code == 404

    def test_invalid_method_422(self, admin_headers):
        r = requests.post(f"{API}/orders/collect/CRV-000000",
                          json={"method": "upi"}, headers=admin_headers)
        assert r.status_code == 422


# ─── Employee-role RBAC: create order needs employee, but we can at
#     least verify the reconciliation + mark-paid deny employees. We
#     don't have an employee account post-clean-slate, so we register
#     a throw-away one to test role gating.
@pytest.fixture(scope="module")
def employee_token():
    """Seed a throw-away employee straight into Mongo (self-registration is
    blocked by the corporate-domain allowlist post Feb-2026 clean slate).
    Cleaned up at teardown."""
    import uuid
    from pymongo import MongoClient
    from datetime import datetime, timezone as tz
    import bcrypt

    email = f"test_offline_{uuid.uuid4().hex[:8]}@example.com"
    pw = "TestPass123!"

    mongo = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    dbname = os.environ.get("DB_NAME", "test_database")
    db = mongo[dbname]
    hashed = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
    db.users.insert_one({
        "email": email,
        "password_hash": hashed,
        "name": "Test Offline Employee",
        "role": "employee",
        "created_at": datetime.now(tz.utc),
        "is_active": True,
    })

    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"cannot login seeded employee: {r.status_code} {r.text[:200]}")
    return r.json()["access_token"]


class TestEmployeeRoleGating:
    def test_employee_cannot_view_reconciliation(self, employee_token):
        r = requests.get(f"{API}/admin/orders/reconciliation",
                         headers={"Authorization": f"Bearer {employee_token}"})
        assert r.status_code == 403, f"expected 403 for employee, got {r.status_code}"

    def test_employee_cannot_mark_paid(self, employee_token):
        fake_id = str(ObjectId())
        r = requests.post(f"{API}/orders/{fake_id}/mark-paid",
                          json={"method": "cash"},
                          headers={"Authorization": f"Bearer {employee_token}"})
        assert r.status_code == 403

    def test_employee_cannot_collect(self, employee_token):
        r = requests.post(f"{API}/orders/collect/CRV-000000",
                          json={"method": "cash"},
                          headers={"Authorization": f"Bearer {employee_token}"})
        assert r.status_code == 403

    def test_employee_list_orders_ok(self, employee_token):
        # employee list should include collection_code/payment_mode/payment_method
        # on newly created orders. Existing users have no orders → empty list.
        r = requests.get(f"{API}/orders",
                         headers={"Authorization": f"Bearer {employee_token}"})
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ─── Regression: order create should include the new fields.
#     We simulate this by inserting an order directly into Mongo with the
#     new schema and then verify /orders (employee list) surfaces them.
class TestOrderListNewFields:
    def test_order_list_projection_exposes_collection_code(self, employee_token):
        """Employee list response must include collection_code + payment_mode
        + payment_method (frontend Menu.js / Orders.js reads these)."""
        # Use pymongo direct insert since we have no vendor/menu items
        from pymongo import MongoClient
        from datetime import datetime, timezone as tz
        mongo = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        dbname = os.environ.get("DB_NAME", "test_database")
        db = mongo[dbname]
        # Resolve employee id from token
        me = requests.get(f"{API}/auth/me",
                          headers={"Authorization": f"Bearer {employee_token}"}).json()
        uid = me["id"]
        oid = db.orders.insert_one({
            "user_id": uid,
            "vendor_id": "ffffffffffffffffffffffff",
            "items": [{"menu_item_id": "x", "name": "Test", "quantity": 1, "price": 100.0}],
            "total_amount": 100.0,
            "status": "confirmed",
            "payment_status": "pending",
            "collection_code": "CRV-TEST01",
            "payment_mode": "OFFLINE",
            "payment_method": None,
            "delivery_type": "pickup",
            "created_at": datetime.now(tz.utc),
        }).inserted_id
        try:
            r = requests.get(f"{API}/orders",
                             headers={"Authorization": f"Bearer {employee_token}"})
            assert r.status_code == 200
            orders = r.json()
            match = [o for o in orders if o.get("id") == str(oid)]
            assert match, "inserted order not returned in employee list"
            o = match[0]
            missing = [f for f in ("collection_code", "payment_mode", "payment_method") if f not in o]
            assert not missing, (
                f"GET /api/orders projection strips fields the frontend needs: {missing}. "
                f"Response keys: {sorted(o.keys())}"
            )
        finally:
            db.orders.delete_one({"_id": oid})


# ─── Regression: Razorpay endpoints still registered ────────────────
class TestRazorpayStillRegistered:
    def test_razorpay_create_order_requires_auth(self):
        # Just verify route exists (not 404). Not exercising razorpay in OFFLINE mode.
        r = requests.post(f"{API}/payments/razorpay/create-order", json={})
        assert r.status_code != 404, "razorpay/create-order route missing"
        assert r.status_code in (401, 403, 422)

    def test_razorpay_verify_requires_auth(self):
        r = requests.post(f"{API}/payments/razorpay/verify", json={})
        assert r.status_code != 404
        assert r.status_code in (401, 403, 422)


# ─── Vendor-side happy path for /orders/collect/{code} ──────────────
#     Seeds a throw-away vendor user + a matching order directly in Mongo
#     and exercises the full one-tap collect flow: 200 → 409 → 403 → 404.
@pytest.fixture(scope="module")
def vendor_ctx():
    import uuid
    from pymongo import MongoClient
    from datetime import datetime, timezone as tz
    import bcrypt

    mongo = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    dbname = os.environ.get("DB_NAME", "test_database")
    db = mongo[dbname]

    vendor_oid = ObjectId()
    other_vendor_oid = ObjectId()
    v_email = f"test_offline_vendor_{uuid.uuid4().hex[:8]}@example.com"
    ov_email = f"test_offline_vendor_{uuid.uuid4().hex[:8]}@example.com"
    pw = "TestPass123!"
    hashed = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

    db.users.insert_one({
        "email": v_email,
        "password_hash": hashed,
        "name": "Test Offline Vendor",
        "role": "vendor",
        "vendor_id": str(vendor_oid),
        "created_at": datetime.now(tz.utc),
        "is_active": True,
    })
    db.users.insert_one({
        "email": ov_email,
        "password_hash": hashed,
        "name": "Test Offline Other Vendor",
        "role": "vendor",
        "vendor_id": str(other_vendor_oid),
        "created_at": datetime.now(tz.utc),
        "is_active": True,
    })

    code = f"CRV-T{uuid.uuid4().hex[:5].upper()}"
    order_oid = db.orders.insert_one({
        "user_id": "ffffffffffffffffffffffff",
        "vendor_id": str(vendor_oid),
        "items": [{"menu_item_id": "x", "name": "Test", "quantity": 1, "price": 100.0}],
        "total_amount": 100.0,
        "status": "ready",
        "payment_status": "pending",
        "collection_code": code,
        "payment_mode": "OFFLINE",
        "payment_method": None,
        "delivery_type": "pickup",
        "created_at": datetime.now(tz.utc),
    }).inserted_id

    r = requests.post(f"{API}/auth/login", json={"email": v_email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"vendor login failed: {r.status_code} {r.text[:200]}")
    v_token = r.json()["access_token"]
    r2 = requests.post(f"{API}/auth/login", json={"email": ov_email, "password": pw})
    if r2.status_code != 200:
        pytest.skip(f"other vendor login failed: {r2.status_code}")
    ov_token = r2.json()["access_token"]

    yield {
        "vendor_token": v_token,
        "other_vendor_token": ov_token,
        "code": code,
        "order_oid": order_oid,
        "vendor_oid": vendor_oid,
    }

    # teardown
    db.orders.delete_one({"_id": order_oid})
    db.users.delete_many({"email": {"$regex": "^test_offline_vendor_"}})


class TestVendorCollectHappyPath:
    def test_non_owning_vendor_403(self, vendor_ctx):
        r = requests.post(
            f"{API}/orders/collect/{vendor_ctx['code']}",
            json={"method": "cash"},
            headers={"Authorization": f"Bearer {vendor_ctx['other_vendor_token']}"},
        )
        assert r.status_code == 403, r.text

    def test_unknown_code_404(self, vendor_ctx):
        r = requests.post(
            f"{API}/orders/collect/CRV-ZZZZZZ",
            json={"method": "cash"},
            headers={"Authorization": f"Bearer {vendor_ctx['vendor_token']}"},
        )
        assert r.status_code == 404

    def test_owning_vendor_collect_200(self, vendor_ctx):
        r = requests.post(
            f"{API}/orders/collect/{vendor_ctx['code']}",
            json={"method": "cash"},
            headers={"Authorization": f"Bearer {vendor_ctx['vendor_token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["payment_status"] == "paid"
        assert body["payment_method"] == "cash"
        assert body["status"] == "collected"

    def test_double_collect_409(self, vendor_ctx):
        # first collect happened in previous test; retry must 409
        r = requests.post(
            f"{API}/orders/collect/{vendor_ctx['code']}",
            json={"method": "cash"},
            headers={"Authorization": f"Bearer {vendor_ctx['vendor_token']}"},
        )
        assert r.status_code == 409, r.text


# ─── Teardown: delete throw-away TEST_ users ────────────────────────
def teardown_module(module):
    try:
        from pymongo import MongoClient
        mongo = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        dbname = os.environ.get("DB_NAME", "test_database")
        mongo[dbname].users.delete_many({"email": {"$regex": "^test_offline_"}})
    except Exception:
        pass
