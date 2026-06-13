"""Cravitoo - tests for NEW security fixes + features (Option B + C)"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")

CREDS = {
    "super_admin": ("admin@cravitoo.com", "admin123"),
    "corporate_admin": ("demo@techcorp.com", "demo123"),
    "vendor": ("vendor@spicekitchen.com", "vendor123"),
    "employee": ("employee@techcorp.com", "employee123"),
}


def login(role):
    s = requests.Session()
    email, pwd = CREDS[role]
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, f"Login failed for {role}: {r.status_code} {r.text}"
    return s, r.json()


def get_spice_kitchen_and_menu():
    vendors = requests.get(f"{BASE_URL}/api/vendors", timeout=10).json()
    v = next(v for v in vendors if v["name"] == "Spice Kitchen")
    menu = requests.get(f"{BASE_URL}/api/menu/{v['id']}", timeout=10).json()
    return v, menu


# ---- Brute force lockout ----
class TestBruteForce:
    def test_brute_force_lockout(self):
        """5 bad attempts -> 429 lockout. Use unique email to avoid affecting other tests."""
        email = f"TEST_brute_{int(time.time())}@cravitoo.com"
        # register user
        reg = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "Correct123!", "name": "Brute Test", "role": "employee"
        }, timeout=10)
        assert reg.status_code == 200
        # 5 bad attempts
        last = None
        for i in range(5):
            last = requests.post(f"{BASE_URL}/api/auth/login",
                                 json={"email": email, "password": "WrongPass!"}, timeout=10)
            assert last.status_code == 401, f"attempt {i+1}: {last.status_code}"
        # 6th attempt -> should be 429
        r6 = requests.post(f"{BASE_URL}/api/auth/login",
                           json={"email": email, "password": "WrongPass!"}, timeout=10)
        assert r6.status_code == 429, f"expected 429, got {r6.status_code} {r6.text}"
        # Even valid password should now be locked
        rv = requests.post(f"{BASE_URL}/api/auth/login",
                           json={"email": email, "password": "Correct123!"}, timeout=10)
        assert rv.status_code == 429, f"expected 429 on valid creds during lockout, got {rv.status_code}"


# ---- Server-side price validation ----
class TestPriceValidation:
    def test_client_price_ignored_uses_db_price(self):
        s, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        item = menu[0]
        payload = {
            "vendor_id": v["id"],
            "items": [{"menu_item_id": item["id"], "quantity": 2, "price": 0.01}],  # tampered
            "delivery_type": "pickup"
        }
        r = s.post(f"{BASE_URL}/api/orders", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        expected = round(item["price"] * 2, 2)
        assert abs(data["total_amount"] - expected) < 0.01, \
            f"server used client price! got {data['total_amount']} expected {expected}"
        assert "pickup_qr" in data and data["pickup_qr"].startswith("CRAVITOO-PICKUP-")


# ---- Order status enum + PATCH ----
class TestOrderStatusEnum:
    def _create_order(self):
        s, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        payload = {
            "vendor_id": v["id"],
            "items": [{"menu_item_id": menu[0]["id"], "quantity": 1, "price": menu[0]["price"]}],
            "delivery_type": "pickup"
        }
        r = s.post(f"{BASE_URL}/api/orders", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        return r.json()

    def test_invalid_status_rejected(self):
        order = self._create_order()
        vs, _ = login("vendor")
        # status passed as query param (FastAPI default for non-model arg)
        r = vs.patch(f"{BASE_URL}/api/orders/{order['id']}", params={"status": "bogus_status"}, timeout=10)
        assert r.status_code in (400, 422), f"expected 400/422 invalid status, got {r.status_code} {r.text}"

    def test_valid_status_accepted(self):
        order = self._create_order()
        vs, _ = login("vendor")
        r = vs.patch(f"{BASE_URL}/api/orders/{order['id']}", params={"status": "preparing"}, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "preparing"


# ---- Payment status scoping ----
class TestPaymentScope:
    def test_other_user_cannot_view_payment_status(self):
        # employee creates order + checkout
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        order_resp = es.post(f"{BASE_URL}/api/orders", json={
            "vendor_id": v["id"],
            "items": [{"menu_item_id": menu[0]["id"], "quantity": 1, "price": menu[0]["price"]}],
            "delivery_type": "pickup"
        }, timeout=15)
        assert order_resp.status_code == 200
        order_id = order_resp.json()["id"]
        co = es.post(f"{BASE_URL}/api/payments/checkout",
                     json={"order_id": order_id, "origin_url": BASE_URL}, timeout=30)
        assert co.status_code == 200, co.text
        session_id = co.json()["session_id"]
        # vendor (different user) tries
        vs, _ = login("vendor")
        r = vs.get(f"{BASE_URL}/api/payments/status/{session_id}", timeout=15)
        assert r.status_code == 403, f"expected 403 for other user, got {r.status_code} {r.text}"


# ---- QR Pickup verify ----
class TestQRPickup:
    def test_valid_qr_marks_completed(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        order_resp = es.post(f"{BASE_URL}/api/orders", json={
            "vendor_id": v["id"],
            "items": [{"menu_item_id": menu[0]["id"], "quantity": 1, "price": menu[0]["price"]}],
            "delivery_type": "pickup"
        }, timeout=15)
        assert order_resp.status_code == 200
        order = order_resp.json()
        order_id = order["id"]
        qr = order["pickup_qr"]
        # vendor marks ready first
        vs, _ = login("vendor")
        vs.patch(f"{BASE_URL}/api/orders/{order_id}", params={"status": "ready"}, timeout=10)
        # verify-pickup with valid QR
        r = vs.post(f"{BASE_URL}/api/orders/{order_id}/verify-pickup",
                    params={"qr_code": qr}, timeout=10)
        assert r.status_code == 200, r.text
        # confirm status completed via GET
        orders = vs.get(f"{BASE_URL}/api/orders", timeout=10).json()
        match = [o for o in orders if o["id"] == order_id]
        assert match and match[0]["status"] == "completed"

    def test_invalid_qr_rejected(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        order_resp = es.post(f"{BASE_URL}/api/orders", json={
            "vendor_id": v["id"],
            "items": [{"menu_item_id": menu[0]["id"], "quantity": 1, "price": menu[0]["price"]}],
            "delivery_type": "pickup"
        }, timeout=15)
        order_id = order_resp.json()["id"]
        vs, _ = login("vendor")
        r = vs.post(f"{BASE_URL}/api/orders/{order_id}/verify-pickup",
                    params={"qr_code": "CRAVITOO-PICKUP-INVALID-XXXX"}, timeout=10)
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"


# ---- Preferences ----
class TestPreferences:
    def test_employee_preferences_crud(self):
        s, _ = login("employee")
        # GET defaults
        r = s.get(f"{BASE_URL}/api/preferences", timeout=10)
        assert r.status_code == 200
        body = r.json()
        for k in ("dietary_preferences", "allergies", "favorite_cuisines"):
            assert k in body
        # POST update
        payload = {
            "dietary_preferences": ["vegetarian"],
            "allergies": ["peanuts"],
            "favorite_cuisines": ["North Indian", "Italian"]
        }
        u = s.post(f"{BASE_URL}/api/preferences", json=payload, timeout=10)
        assert u.status_code == 200, u.text
        # GET again - persisted
        r2 = s.get(f"{BASE_URL}/api/preferences", timeout=10).json()
        assert r2["dietary_preferences"] == ["vegetarian"]
        assert r2["allergies"] == ["peanuts"]
        assert "North Indian" in r2["favorite_cuisines"]

    def test_non_employee_blocked(self):
        s, _ = login("vendor")
        r = s.get(f"{BASE_URL}/api/preferences", timeout=10)
        assert r.status_code == 403


# ---- Reviews ----
class TestReviews:
    def _complete_order(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        order_resp = es.post(f"{BASE_URL}/api/orders", json={
            "vendor_id": v["id"],
            "items": [{"menu_item_id": menu[0]["id"], "quantity": 1, "price": menu[0]["price"]}],
            "delivery_type": "pickup"
        }, timeout=15)
        order_id = order_resp.json()["id"]
        qr = order_resp.json()["pickup_qr"]
        vs, _ = login("vendor")
        vs.patch(f"{BASE_URL}/api/orders/{order_id}", params={"status": "ready"}, timeout=10)
        vs.post(f"{BASE_URL}/api/orders/{order_id}/verify-pickup", params={"qr_code": qr}, timeout=10)
        return es, v["id"], order_id

    def test_create_review_and_duplicate_blocked(self):
        es, vendor_id, order_id = self._complete_order()
        r = es.post(f"{BASE_URL}/api/reviews", json={
            "vendor_id": vendor_id, "order_id": order_id, "rating": 5, "comment": "TEST_great!"
        }, timeout=10)
        assert r.status_code == 200, r.text
        # duplicate review
        r2 = es.post(f"{BASE_URL}/api/reviews", json={
            "vendor_id": vendor_id, "order_id": order_id, "rating": 4, "comment": "TEST_again"
        }, timeout=10)
        assert r2.status_code == 400, f"duplicate should be blocked, got {r2.status_code}"
        # fetch vendor reviews
        gr = requests.get(f"{BASE_URL}/api/reviews/vendor/{vendor_id}", timeout=10)
        assert gr.status_code == 200
        reviews = gr.json()
        assert any(rev.get("comment") == "TEST_great!" for rev in reviews)

    def test_review_on_pending_order_blocked(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        order_resp = es.post(f"{BASE_URL}/api/orders", json={
            "vendor_id": v["id"],
            "items": [{"menu_item_id": menu[0]["id"], "quantity": 1, "price": menu[0]["price"]}],
            "delivery_type": "pickup"
        }, timeout=15)
        order_id = order_resp.json()["id"]
        r = es.post(f"{BASE_URL}/api/reviews", json={
            "vendor_id": v["id"], "order_id": order_id, "rating": 5
        }, timeout=10)
        assert r.status_code == 400


# ---- Subscriptions ----
class TestSubscriptions:
    def test_create_and_fetch_subscription(self):
        s, _ = login("employee")
        v, _ = get_spice_kitchen_and_menu()
        r = s.post(f"{BASE_URL}/api/subscriptions", json={
            "vendor_id": v["id"], "plan_type": "monthly",
            "meal_type": "lunch", "duration_days": 30
        }, timeout=10)
        assert r.status_code == 200, r.text
        assert "id" in r.json() and "end_date" in r.json()
        sub_id = r.json()["id"]
        # GET
        gr = s.get(f"{BASE_URL}/api/subscriptions", timeout=10)
        assert gr.status_code == 200
        subs = gr.json()
        assert any(x["id"] == sub_id for x in subs)
        match = [x for x in subs if x["id"] == sub_id][0]
        assert match["status"] == "active"
        assert match["plan_type"] == "monthly"

    def test_non_employee_blocked(self):
        s, _ = login("vendor")
        r = s.get(f"{BASE_URL}/api/subscriptions", timeout=10)
        assert r.status_code == 403
