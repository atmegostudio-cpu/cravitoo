"""Tests for the "blank menu" bug fix:
- Single-site auto-fallback in GET /api/vendors
- Master-only diagnostic /api/admin/integrity/employee-menu-report
- Master-only backfill /api/admin/integrity/backfill-employee-sites
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def admin_session():
    return _login("admin@cravitoo.com", "admin123")


@pytest.fixture(scope="module")
def emp_multi_session():
    return _login("diag_multi@diag.com", "Diag#1234")


@pytest.fixture(scope="module")
def emp_zero_session():
    return _login("diag_zero@diag.com", "Diag#1234")


@pytest.fixture(scope="module")
def emp_single_session():
    return _login("diag_single@diag.com", "Diag#1234")


# ---------- Diagnostic endpoint ----------
class TestEmployeeMenuReport:
    def test_master_admin_can_access(self, admin_session):
        r = admin_session.get(f"{API}/admin/integrity/employee-menu-report", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in [
            "employees_no_site", "employees_site_deleted", "employees_zero_active_vendors",
            "domains_missing_site_id", "vendors_all_items_unavailable", "summary",
        ]:
            assert k in data, f"missing key {k}"
        summary = data["summary"]
        for k in ["no_site", "site_deleted", "zero_vendors",
                  "domains_missing_site_id", "vendors_all_unavailable"]:
            assert k in summary
            assert isinstance(summary[k], int)

    def test_non_master_forbidden(self, emp_zero_session):
        r = emp_zero_session.get(f"{API}/admin/integrity/employee-menu-report", timeout=30)
        assert r.status_code == 403, r.text


# ---------- Backfill endpoint ----------
class TestBackfillEmployeeSites:
    def test_master_admin_backfill(self, admin_session):
        r = admin_session.post(f"{API}/admin/integrity/backfill-employee-sites", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("success") is True
        assert "fixed" in data and isinstance(data["fixed"], int)
        assert "unresolved" in data and isinstance(data["unresolved"], list)
        # multi-site employee has no domain rule + 2 sites → must remain unresolved
        emails = {u.get("email") for u in data["unresolved"]}
        assert "diag_multi@diag.com" in emails, f"expected diag_multi in unresolved, got {emails}"

    def test_idempotent_second_run(self, admin_session):
        r = admin_session.post(f"{API}/admin/integrity/backfill-employee-sites", timeout=30)
        assert r.status_code == 200
        # second run must not raise and should still return same structure
        data = r.json()
        assert data.get("success") is True

    def test_non_master_forbidden(self, emp_multi_session):
        r = emp_multi_session.post(f"{API}/admin/integrity/backfill-employee-sites", timeout=30)
        assert r.status_code == 403


# ---------- /api/vendors behaviour per employee ----------
class TestVendorsPerEmployee:
    def test_multi_site_no_site_returns_empty(self, emp_multi_session):
        r = emp_multi_session.get(f"{API}/vendors", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert data == [], f"expected empty for multi-site employee, got {data}"

    def test_zero_site_employee_sees_vendor(self, emp_zero_session):
        r = emp_zero_session.get(f"{API}/vendors", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list) and len(data) >= 1, f"expected >=1 vendor, got {data}"
        names = [v.get("name") for v in data]
        assert any("DIAG" in (n or "") for n in names), f"expected DIAG_Vendor, got {names}"

    def test_single_site_auto_fallback(self, emp_single_session):
        r = emp_single_session.get(f"{API}/vendors", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list) and len(data) >= 1, \
            f"expected auto-fallback to single site to yield vendors, got {data}"
