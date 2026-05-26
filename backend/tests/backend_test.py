"""Cravitoo Backend API Tests"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://corporate-feast.preview.emergentagent.com").rstrip("/")

CREDS = {
    "master_admin": ("admin@cravitoo.com", "admin123"),
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

# --- Auth ---
class TestAuth:
    def test_login_all_roles(self):
        for role in CREDS:
            s, data = login(role)
            assert data["role"] == role

    def test_login_invalid(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "x@x.com", "password": "wrong"}, timeout=10)
        assert r.status_code == 401

    def test_me_employee(self):
        s, _ = login("employee")
        r = s.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == "employee@techcorp.com"
        assert data["role"] == "employee"

    def test_logout(self):
        s, _ = login("employee")
        r = s.post(f"{BASE_URL}/api/auth/logout", timeout=10)
        assert r.status_code == 200

    def test_register_then_login(self):
        import time
        email = f"TEST_user_{int(time.time())}@cravitoo.com"
        r = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "Test1234!", "name": "Test User", "role": "employee"
        }, timeout=10)
        assert r.status_code == 200, r.text
        r2 = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "Test1234!"}, timeout=10)
        assert r2.status_code == 200

# --- Vendors / Menu ---
class TestVendorsMenu:
    def test_vendors_public(self):
        r = requests.get(f"{BASE_URL}/api/vendors", timeout=10)
        assert r.status_code == 200
        vendors = r.json()
        assert len(vendors) >= 1
        assert any(v["name"] == "Spice Kitchen" for v in vendors)

    def test_menu(self):
        vendors = requests.get(f"{BASE_URL}/api/vendors", timeout=10).json()
        v = next(v for v in vendors if v["name"] == "Spice Kitchen")
        r = requests.get(f"{BASE_URL}/api/menu/{v['id']}", timeout=10)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 5

# --- Orders (likely bug: user['id'] not set by get_current_user) ---
class TestOrders:
    def test_create_order_employee(self):
        s, _ = login("employee")
        vendors = requests.get(f"{BASE_URL}/api/vendors", timeout=10).json()
        v = next(v for v in vendors if v["name"] == "Spice Kitchen")
        menu = requests.get(f"{BASE_URL}/api/menu/{v['id']}", timeout=10).json()
        payload = {
            "vendor_id": v["id"],
            "items": [{"menu_item_id": menu[0]["id"], "quantity": 1, "price": menu[0]["price"]}],
            "delivery_type": "pickup"
        }
        r = s.post(f"{BASE_URL}/api/orders", json=payload, timeout=15)
        assert r.status_code == 200, f"Order create failed: {r.status_code} {r.text}"
        data = r.json()
        assert "id" in data
        # Verify GET retrieves it
        gr = s.get(f"{BASE_URL}/api/orders", timeout=10)
        assert gr.status_code == 200
        orders = gr.json()
        assert any(o["id"] == data["id"] for o in orders)

    def test_get_orders_vendor(self):
        s, _ = login("vendor")
        r = s.get(f"{BASE_URL}/api/orders", timeout=10)
        assert r.status_code == 200

# --- Analytics ---
class TestAnalytics:
    def test_vendor_analytics(self):
        s, _ = login("vendor")
        r = s.get(f"{BASE_URL}/api/analytics/vendor", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "total_orders" in d and "total_revenue" in d and "average_order_value" in d

    def test_corporate_analytics(self):
        s, _ = login("corporate_admin")
        r = s.get(f"{BASE_URL}/api/analytics/corporate", timeout=10)
        assert r.status_code == 200
        assert "total_orders" in r.json()

# --- Protected Routes ---
class TestProtected:
    def test_me_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code == 401

    def test_orders_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/api/orders", timeout=10)
        assert r.status_code == 401

# --- AI Recommendations (slow) ---
class TestAI:
    def test_ai_recommendations(self):
        s, _ = login("employee")
        r = s.post(f"{BASE_URL}/api/ai/recommendations",
                   json={"user_preferences": "spicy vegetarian", "dietary_restrictions": "none"},
                   timeout=60)
        assert r.status_code == 200, f"AI failed: {r.status_code} {r.text[:300]}"
        assert "recommendations" in r.json()
        assert len(r.json()["recommendations"]) > 10

# --- Payments ---
class TestPayments:
    def test_checkout_session(self):
        s, _ = login("employee")
        vendors = requests.get(f"{BASE_URL}/api/vendors", timeout=10).json()
        v = next(v for v in vendors if v["name"] == "Spice Kitchen")
        menu = requests.get(f"{BASE_URL}/api/menu/{v['id']}", timeout=10).json()
        order_payload = {
            "vendor_id": v["id"],
            "items": [{"menu_item_id": menu[0]["id"], "quantity": 1, "price": menu[0]["price"]}],
            "delivery_type": "pickup"
        }
        order_resp = s.post(f"{BASE_URL}/api/orders", json=order_payload, timeout=15)
        if order_resp.status_code != 200:
            pytest.skip(f"Order creation failed: {order_resp.text}")
        order_id = order_resp.json()["id"]
        r = s.post(f"{BASE_URL}/api/payments/checkout",
                   json={"order_id": order_id, "origin_url": BASE_URL}, timeout=30)
        assert r.status_code == 200, f"Checkout failed: {r.status_code} {r.text[:300]}"
        d = r.json()
        assert "url" in d and "session_id" in d
        assert "stripe.com" in d["url"] or "checkout" in d["url"].lower()
