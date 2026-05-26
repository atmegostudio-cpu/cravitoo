"""Cravitoo Iteration 5 - Order Cancellation, Vendor Refund, Loyalty Redemption
Covers: /api/orders/{id}/cancel, /api/orders/{id}/refund, /api/loyalty/redeem
Uses direct MongoDB writes for setup of unusual states (expired window, prepaid order,
cross-vendor order, loyalty point top-up).
"""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

assert BASE_URL, "REACT_APP_BACKEND_URL not set"
assert MONGO_URL and DB_NAME, "Mongo env not set"

CREDS = {
    "master_admin": ("admin@cravitoo.com", "admin123"),
    "vendor": ("vendor@spicekitchen.com", "vendor123"),
    "employee": ("employee@techcorp.com", "employee123"),
    "site_admin": ("siteadmin@techcorp.com", "site123"),
}

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]

# Track docs to cleanup
_created_order_ids: list[str] = []
_created_user_ids: list[str] = []
_created_redemption_order_ids: list[str] = []


def login(role_or_creds):
    s = requests.Session()
    if isinstance(role_or_creds, str):
        email, pwd = CREDS[role_or_creds]
    else:
        email, pwd = role_or_creds
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s, r.json()


def _purge_vendor_notifs():
    """Keep vendor inbox lean — prevents the 50-cap notifications regression test
    from breaking when our cancel/refund tests flood the inbox."""
    spice = db.vendors.find_one({"name": "Spice Kitchen"})
    if not spice:
        return
    vendor_users = list(db.users.find({"vendor_id": str(spice["_id"]), "role": "vendor"}))
    for vu in vendor_users:
        db.notifications.delete_many({"user_id": str(vu["_id"])})


def get_spice_kitchen_and_menu():
    r = requests.get(f"{BASE_URL}/api/vendors", timeout=10)
    assert r.status_code == 200, r.text
    vendors = r.json()
    v = next(v for v in vendors if v["name"] == "Spice Kitchen")
    menu = requests.get(f"{BASE_URL}/api/menu/{v['id']}", timeout=10).json()
    available = [m for m in menu if m.get("is_available", True)]
    return v, available


def create_pending_order(session, vendor, menu):
    payload = {
        "vendor_id": vendor["id"],
        "items": [{"menu_item_id": menu[0]["id"], "quantity": 1, "price": menu[0]["price"]}],
        "delivery_type": "pickup",
    }
    r = session.post(f"{BASE_URL}/api/orders", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    oid = r.json()["id"]
    _created_order_ids.append(oid)
    return oid


def db_order(order_id: str):
    return db.orders.find_one({"_id": ObjectId(order_id)})


def set_order_fields(order_id: str, **fields):
    db.orders.update_one({"_id": ObjectId(order_id)}, {"$set": fields})


# =========================================================================
# CANCEL ORDER TESTS
# =========================================================================
class TestCancelOrder:
    @classmethod
    def setup_class(cls):
        _purge_vendor_notifs()

    @classmethod
    def teardown_class(cls):
        _purge_vendor_notifs()

    def test_cancel_happy_path(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = create_pending_order(es, v, menu)
        r = es.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "Order cancelled" in body.get("message", "")
        # refund_status should be None on unpaid order
        assert body.get("refund_status") in (None, "null")
        # Verify in DB
        doc = db_order(oid)
        assert doc["status"] == "cancelled"
        assert doc.get("cancelled_at") is not None
        assert doc.get("cancelled_by") == "customer"

    def test_cancel_window_expired_400(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = create_pending_order(es, v, menu)
        # backdate created_at by 10 min
        set_order_fields(oid, created_at=datetime.utcnow() - timedelta(minutes=10))
        r = es.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)
        assert r.status_code == 400, r.text
        assert "Cancellation window" in r.json().get("detail", "")
        # Cleanup
        set_order_fields(oid, status="cancelled")  # mark for cleanup

    def test_cancel_after_vendor_confirmed_400(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = create_pending_order(es, v, menu)
        # Vendor confirms
        vs, _ = login("vendor")
        cr = vs.patch(f"{BASE_URL}/api/orders/{oid}", params={"status": "confirmed"}, timeout=10)
        assert cr.status_code == 200, cr.text
        # Now employee tries to cancel
        r = es.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)
        assert r.status_code == 400, r.text
        assert "Cannot cancel order with status" in r.json().get("detail", "")
        # Cleanup
        set_order_fields(oid, status="cancelled")

    def test_cancel_by_other_employee_403(self):
        # Create order as primary employee
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = create_pending_order(es, v, menu)

        # Register a second employee
        suffix = uuid.uuid4().hex[:8]
        reg_payload = {
            "email": f"TEST_emp_{suffix}@techcorp.com",
            "password": "Password123!",
            "name": f"TEST Emp {suffix}",
            "role": "employee",
        }
        rs = requests.Session()
        rr = rs.post(f"{BASE_URL}/api/auth/register", json=reg_payload, timeout=10)
        assert rr.status_code == 200, rr.text
        new_user_id = rr.json()["id"]
        _created_user_ids.append(new_user_id)

        # Other employee cancels
        r = rs.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)
        assert r.status_code == 403, r.text
        # cleanup the order
        es.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)

    def test_cancel_as_vendor_role_403(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = create_pending_order(es, v, menu)
        vs, _ = login("vendor")
        r = vs.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)
        assert r.status_code == 403, r.text
        # cleanup
        es.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)

    def test_cancel_already_cancelled_400(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = create_pending_order(es, v, menu)
        r1 = es.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)
        assert r1.status_code == 200
        r2 = es.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)
        assert r2.status_code == 400, r2.text
        assert "already cancelled" in r2.json().get("detail", "").lower()

    def test_cancel_paid_order_returns_refunded_mock(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = create_pending_order(es, v, menu)
        # Mark paid + recent created_at, keep status=pending so cancel is allowed
        set_order_fields(
            oid,
            payment_status="paid",
            status="pending",
            created_at=datetime.utcnow(),
        )
        r = es.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("refund_status") == "refunded_mock"
        doc = db_order(oid)
        assert doc["status"] == "cancelled"
        assert doc.get("refund_status") == "refunded_mock"


# =========================================================================
# VENDOR REFUND TESTS
# =========================================================================
def _create_paid_order_via_razorpay(es_session, vendor, menu):
    oid = create_pending_order(es_session, vendor, menu)
    # Create razorpay order
    cr = es_session.post(f"{BASE_URL}/api/payments/razorpay/create-order", json={"order_id": oid}, timeout=10)
    assert cr.status_code == 200, cr.text
    rp = cr.json()
    # Verify with mock data — sig isn't validated in mock mode
    vr = es_session.post(
        f"{BASE_URL}/api/payments/razorpay/verify",
        json={
            "order_id": oid,
            "razorpay_order_id": rp["razorpay_order_id"],
            "razorpay_payment_id": f"pay_mock_{uuid.uuid4().hex[:12]}",
            "razorpay_signature": "mock_sig",
        },
        timeout=10,
    )
    assert vr.status_code == 200, vr.text
    return oid


class TestRefund:
    @classmethod
    def teardown_class(cls):
        _purge_vendor_notifs()

    def test_vendor_refund_paid_order_200(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = _create_paid_order_via_razorpay(es, v, menu)

        vs, _ = login("vendor")
        r = vs.post(f"{BASE_URL}/api/orders/{oid}/refund", timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("refund_status") == "refunded_mock"
        assert body.get("amount") > 0
        doc = db_order(oid)
        assert doc["status"] == "cancelled"
        assert doc.get("refund_status") == "refunded_mock"
        assert doc.get("refunded_at") is not None
        # employee should have a notification
        notifs = es.get(f"{BASE_URL}/api/notifications", timeout=10).json()
        match = [n for n in notifs if "Refund" in n.get("title", "") and oid[-8:] in n.get("message", "")]
        assert len(match) >= 1, f"Refund notification not found for {oid}"

    def test_refund_unpaid_order_400(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = create_pending_order(es, v, menu)
        vs, _ = login("vendor")
        r = vs.post(f"{BASE_URL}/api/orders/{oid}/refund", timeout=10)
        assert r.status_code == 400, r.text
        assert "not paid" in r.json().get("detail", "").lower()
        # cleanup
        es.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)

    def test_refund_other_vendor_order_403(self):
        # Insert an order directly with a different vendor_id
        emp_user = db.users.find_one({"email": "employee@techcorp.com"})
        order_doc = {
            "user_id": str(emp_user["_id"]),
            "vendor_id": str(ObjectId()),  # valid hex but non-existent
            "items": [{"menu_item_id": "x", "name": "TEST", "quantity": 1, "price": 100.0}],
            "total_amount": 100.0,
            "status": "pending",
            "payment_status": "paid",
            "delivery_type": "pickup",
            "created_at": datetime.utcnow(),
        }
        res = db.orders.insert_one(order_doc)
        oid = str(res.inserted_id)
        _created_order_ids.append(oid)

        vs, _ = login("vendor")
        r = vs.post(f"{BASE_URL}/api/orders/{oid}/refund", timeout=10)
        assert r.status_code == 403, r.text
        assert "Not your order" in r.json().get("detail", "")

    def test_refund_as_employee_403(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = create_pending_order(es, v, menu)
        r = es.post(f"{BASE_URL}/api/orders/{oid}/refund", timeout=10)
        assert r.status_code == 403, r.text
        # cleanup
        es.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)

    def test_master_admin_refund_200(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = _create_paid_order_via_razorpay(es, v, menu)
        ms, _ = login("master_admin")
        r = ms.post(f"{BASE_URL}/api/orders/{oid}/refund", timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("refund_status") == "refunded_mock"
        doc = db_order(oid)
        assert doc.get("cancelled_by") == "master_admin"

    def test_double_refund_400(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = _create_paid_order_via_razorpay(es, v, menu)
        vs, _ = login("vendor")
        r1 = vs.post(f"{BASE_URL}/api/orders/{oid}/refund", timeout=10)
        assert r1.status_code == 200
        r2 = vs.post(f"{BASE_URL}/api/orders/{oid}/refund", timeout=10)
        assert r2.status_code == 400, r2.text
        assert "already refunded" in r2.json().get("detail", "").lower()


# =========================================================================
# LOYALTY REDEMPTION TESTS
# =========================================================================
class TestLoyaltyRedeem:
    @classmethod
    def setup_class(cls):
        """Top up employee's loyalty points by inserting fake paid orders worth >= ₹50,000."""
        _purge_vendor_notifs()
        emp = db.users.find_one({"email": "employee@techcorp.com"})
        assert emp is not None
        cls.emp_id = str(emp["_id"])
        # Insert 10 paid orders @ ₹5000 each = 500 points
        cls._seeded_order_ids = []
        # Use a valid (but non-existent) ObjectId so the master-dashboard report
        # doesn't crash on safe_objectid() of a non-hex string.
        seed_vendor_oid = str(ObjectId())
        for i in range(10):
            doc = {
                "user_id": cls.emp_id,
                "vendor_id": seed_vendor_oid,
                "items": [{"menu_item_id": "x", "name": "TEST_loyalty_seed", "quantity": 1, "price": 5000.0}],
                "total_amount": 5000.0,
                "status": "completed",
                "payment_status": "paid",
                "delivery_type": "pickup",
                "created_at": datetime.utcnow() - timedelta(days=i + 1),
            }
            r = db.orders.insert_one(doc)
            cls._seeded_order_ids.append(str(r.inserted_id))
            _created_order_ids.append(str(r.inserted_id))

    def test_employee_has_enough_points(self):
        es, _ = login("employee")
        r = es.get(f"{BASE_URL}/api/loyalty", timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("available_points") >= 100, r.json()

    def test_redeem_on_pending_unpaid_order_reduces_total(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        # Use 2 items so total >= 100
        item = menu[0]
        qty = max(1, int(200 / max(item["price"], 1)) + 1)
        r = es.post(f"{BASE_URL}/api/orders", json={
            "vendor_id": v["id"],
            "items": [{"menu_item_id": item["id"], "quantity": qty, "price": item["price"]}],
            "delivery_type": "pickup",
        }, timeout=10)
        assert r.status_code == 200, r.text
        oid = r.json()["id"]
        original_total = r.json()["total_amount"]
        _created_order_ids.append(oid)
        _created_redemption_order_ids.append(oid)

        redeem_r = es.post(f"{BASE_URL}/api/loyalty/redeem", json={"points": 100, "order_id": oid}, timeout=10)
        assert redeem_r.status_code == 200, redeem_r.text
        body = redeem_r.json()
        assert body["discount_inr"] == min(100, original_total)
        assert body["new_total"] == max(0, original_total - body["discount_inr"])
        # Verify DB
        doc = db_order(oid)
        assert doc.get("loyalty_discount") == body["discount_inr"]
        assert doc["total_amount"] == body["new_total"]
        # cleanup
        es.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)

    def test_redeem_on_paid_order_400(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = create_pending_order(es, v, menu)
        set_order_fields(oid, payment_status="paid")
        r = es.post(f"{BASE_URL}/api/loyalty/redeem", json={"points": 100, "order_id": oid}, timeout=10)
        assert r.status_code == 400, r.text
        assert "already paid order" in r.json().get("detail", "").lower()

    def test_redeem_more_than_available_points_400(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = create_pending_order(es, v, menu)
        r = es.post(f"{BASE_URL}/api/loyalty/redeem", json={"points": 9999999, "order_id": oid}, timeout=10)
        assert r.status_code == 400, r.text
        assert "insufficient points" in r.json().get("detail", "").lower()
        es.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)

    def test_redeem_less_than_min_100_returns_400(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oid = create_pending_order(es, v, menu)
        r = es.post(f"{BASE_URL}/api/loyalty/redeem", json={"points": 50, "order_id": oid}, timeout=10)
        assert r.status_code == 400, r.text
        assert "minimum 100 points" in r.json().get("detail", "").lower()
        es.post(f"{BASE_URL}/api/orders/{oid}/cancel", timeout=10)

    @classmethod
    def teardown_class(cls):
        _purge_vendor_notifs()


# =========================================================================
# Cleanup
# =========================================================================
@pytest.fixture(scope="session", autouse=True)
def cleanup_test_data():
    yield
    # Delete created orders
    if _created_order_ids:
        oids = [ObjectId(o) for o in _created_order_ids if ObjectId.is_valid(o)]
        db.orders.delete_many({"_id": {"$in": oids}})
    # Delete created loyalty redemptions
    if _created_redemption_order_ids:
        db.loyalty_redemptions.delete_many({"order_id": {"$in": _created_redemption_order_ids}})
    # Delete created users
    if _created_user_ids:
        uids = [ObjectId(u) for u in _created_user_ids if ObjectId.is_valid(u)]
        db.users.delete_many({"_id": {"$in": uids}})
    # Cleanup notifications referencing the deleted orders (so vendor inbox doesn't
    # stay full of "Customer cancelled order #xxxx" entries — would break the 50-cap
    # notifications regression test).
    short_ids = [oid[-8:] for oid in _created_order_ids]
    if short_ids:
        for sid in short_ids:
            db.notifications.delete_many({"message": {"$regex": sid}})
