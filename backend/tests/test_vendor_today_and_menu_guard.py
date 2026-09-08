"""Tests for Vendor Today Analytics + Menu Access Guard."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://admin-sales-report.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

VENDOR_CREDS = {"email": "approve_0b71c6@example.com", "password": "vendor123"}
EMP_CREDS = {"email": "qa_employee@gatetest.com", "password": "employee123"}
ADMIN_CREDS = {"email": "admin@cravitoo.com", "password": "admin123"}

VENDOR_ID = "6a85521d239a34f6433984ea"          # cross-site (for employee)
SUSPENDED_VENDOR = "6a8946e88de95440e23f21cb"
MAPPED_ACTIVE_VENDOR = "6a855f5aba5f84a7d670e101"


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def vendor_token():
    return _login(VENDOR_CREDS)


@pytest.fixture(scope="module")
def employee_token():
    return _login(EMP_CREDS)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_CREDS)


# --- Vendor Today Analytics ---
class TestVendorTodayAnalytics:
    def test_vendor_can_fetch(self, vendor_token):
        r = requests.get(f"{API}/analytics/vendor/today",
                         headers={"Authorization": f"Bearer {vendor_token}"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["today_revenue"] == 400.0
        assert d["today_paid_orders"] == 2
        assert d["today_orders"] >= 3
        assert d["top_item"] is not None
        assert d["top_item"]["name"] == "Veg Thali"
        assert d["top_item"]["quantity"] == 5
        assert d["pending_count"] >= 1
        assert d["pending_amount"] >= 120.0

    def test_admin_forbidden(self, admin_token):
        r = requests.get(f"{API}/analytics/vendor/today",
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        assert r.status_code == 403

    def test_no_auth(self):
        r = requests.get(f"{API}/analytics/vendor/today", timeout=15)
        assert r.status_code in (401, 403)


# --- Menu Access Guard ---
class TestMenuGuard:
    def test_employee_cross_site_blocked(self, employee_token):
        r = requests.get(f"{API}/menu/{VENDOR_ID}",
                         headers={"Authorization": f"Bearer {employee_token}"}, timeout=15)
        assert r.status_code == 403, r.text

    def test_employee_suspended_blocked(self, employee_token):
        r = requests.get(f"{API}/menu/{SUSPENDED_VENDOR}",
                         headers={"Authorization": f"Bearer {employee_token}"}, timeout=15)
        assert r.status_code == 403, r.text

    def test_employee_mapped_active_allowed(self, employee_token):
        r = requests.get(f"{API}/menu/{MAPPED_ACTIVE_VENDOR}",
                         headers={"Authorization": f"Bearer {employee_token}"}, timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_admin_not_restricted(self, admin_token):
        # admin should be able to fetch even the suspended vendor's menu
        r = requests.get(f"{API}/menu/{SUSPENDED_VENDOR}",
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        assert r.status_code == 200, r.text

    def test_vendor_not_restricted(self, vendor_token):
        r = requests.get(f"{API}/menu/{VENDOR_ID}",
                         headers={"Authorization": f"Bearer {vendor_token}"}, timeout=15)
        assert r.status_code == 200, r.text

    def test_employee_all_mapped_vendors_ok(self, employee_token):
        """Regression: 7 legitimately-mapped vendors must all be reachable."""
        mapped = [
            "6a855f5aba5f84a7d670e101",
            "6a856041b6a1ab0f0c187578",
            "6a8600534f709c7504387167",
            "6a8600e6b7fb9be04fb5bb6d",
            "6a8709bdefe50d76f60dac10",
            "6a871e4a7e320302089b784e",
            "6a884558bf79112300218819",
        ]
        for vid in mapped:
            r = requests.get(f"{API}/menu/{vid}",
                             headers={"Authorization": f"Bearer {employee_token}"}, timeout=15)
            assert r.status_code == 200, f"{vid} → {r.status_code} {r.text}"
