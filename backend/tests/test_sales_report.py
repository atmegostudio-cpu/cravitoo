"""Backend tests for /api/admin/sales-report (role-scoped)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://admin-sales-report.preview.emergentagent.com").rstrip("/")
ADMIN = {"email": "admin@cravitoo.com", "password": "admin123"}
EMP = {"email": "timefix_emp@cravitoo.com", "password": "Test#1234"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin_session():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def emp_session():
    return _login(EMP)


class TestSalesReport:
    def test_default_last_30_days(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/sales-report", timeout=30)
        assert r.status_code == 200
        j = r.json()
        for k in ("grand_total", "order_count", "site_summary", "vendor_summary", "range", "orders"):
            assert k in j, f"missing key {k}"
        assert isinstance(j["site_summary"], list)
        assert isinstance(j["vendor_summary"], list)

    def test_date_range_full_year(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/sales-report", params={"start": "2026-01-01", "end": "2026-12-31"}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        # Main agent asserts grand_total ~300 with 2 orders in seeded data
        assert j["order_count"] >= 2, f"expected >=2 orders, got {j['order_count']}"
        assert j["grand_total"] >= 100, f"expected grand_total>=100, got {j['grand_total']}"

    def test_month_filter(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/sales-report", params={"month": "2026-06"}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["order_count"] >= 2
        assert j["grand_total"] >= 100

    def test_single_date_filter(self, admin_session):
        # Just verify it returns 200 with valid shape
        r = admin_session.get(f"{BASE_URL}/api/admin/sales-report", params={"date": "2026-06-15"}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "grand_total" in j and "orders" in j

    def test_xlsx_download(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/sales-report", params={"start": "2026-01-01", "end": "2026-12-31", "format": "xlsx"}, timeout=30)
        assert r.status_code == 200
        assert "spreadsheet" in r.headers.get("content-type", "").lower()
        # xlsx signature: PK
        assert r.content[:2] == b"PK"
        assert len(r.content) > 1000

    def test_employee_forbidden(self, emp_session):
        r = emp_session.get(f"{BASE_URL}/api/admin/sales-report", timeout=30)
        assert r.status_code == 403, f"expected 403 for employee, got {r.status_code}"
