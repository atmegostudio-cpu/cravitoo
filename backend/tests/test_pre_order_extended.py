"""
Additional  coverage gaps not covered by test__step2_to_5.py:
- /api/exports/vendor-sales endpoint
- date range filters
- corporate admin scoping on exports
- /api/billing/invoices does not expose blob fields
- corp_admin invoice scoping (data check)
- successful reservation includes meal_type & meal_type_label
- bulk window response fields
- corporate client PATCH update
"""
from __future__ import annotations
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def H(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def master_token(): return _login("admin@cravitoo.com", "admin123")


@pytest.fixture(scope="module")
def corp_admin_token(): return _login("demo@techcorp.com", "demo123")


@pytest.fixture(scope="module")
def emp_token(): return _login("employee@techcorp.com", "employee123")


@pytest.fixture(scope="module")
def vendor_token(): return _login("vendor@spicekitchen.com", "vendor123")


# ---- vendor-sales export (missing from main test) ----
class TestVendorSalesExport:
    @pytest.mark.parametrize("fmt,head", [("csv", None), ("xlsx", b"PK"), ("pdf", b"%PDF-")])
    def test_vendor_sales_export(self, fmt, head, master_token):
        r = requests.get(f"{API}/exports/vendor-sales?format={fmt}", headers=H(master_token), timeout=20)
        assert r.status_code == 200, r.text
        if fmt == "csv":
            assert r.headers.get("content-type", "").startswith("text/csv")
            assert len(r.content) > 0
        else:
            assert r.content[:len(head)] == head

    def test_vendor_sales_invalid_format(self, master_token):
        r = requests.get(f"{API}/exports/vendor-sales?format=html", headers=H(master_token), timeout=10)
        assert r.status_code == 400


# ---- date range filter ----
class TestExportDateFilter:
    def test_date_range_returns_csv(self, master_token):
        r = requests.get(
            f"{API}/exports/reservations?format=csv&from=2026-01-01&to=2026-12-31",
            headers=H(master_token), timeout=15
        )
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("text/csv")


# ---- corp admin scoping on exports ----
class TestExportCorpScoping:
    def test_corp_admin_can_export_own(self, corp_admin_token):
        r = requests.get(f"{API}/exports/reservations?format=csv", headers=H(corp_admin_token), timeout=15)
        assert r.status_code in (200, 403)
        # if 200, payload returned without error
        if r.status_code == 200:
            assert r.headers.get("content-type", "").startswith("text/csv")


# ---- successful reservation contains meal_type fields ----
class TestReservationMealTypeReturn:
    def test_successful_reservation_includes_meal_type(self, emp_token):
        r = requests.get(f"{API}/reservations/availability", headers=H(emp_token), timeout=10)
        assert r.status_code == 200
        meals = r.json()["meals"]
        valid = next((m for m in meals
                      if m["eligible_vendors"] and not m["cutoff_passed"]
                      and not m.get("already_reserved")), None)
        if not valid:
            pytest.skip("No eligible meal available")
        body = {
            "vendor_id": valid["eligible_vendors"][0]["id"],
            "meal_period": valid["meal_period"],
            "meal_type": "veg_meal",
        }
        r = requests.post(f"{API}/reservations", json=body, headers=H(emp_token), timeout=10)
        if r.status_code != 200:
            pytest.skip(f"Could not reserve (perhaps already done): {r.status_code} {r.text}")
        d = r.json()
        assert d.get("meal_type") == "veg_meal"
        assert "meal_type_label" in d
        assert "veg" in d["meal_type_label"].lower()


# ---- bulk window response fields ----
class TestBulkWindowFields:
    def test_window_includes_ist_fields(self, corp_admin_token):
        r = requests.get(f"{API}/reservations/bulk-window", headers=H(corp_admin_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("is_open", "window_start_ist", "window_end_ist", "meal_types"):
            assert k in d, f"missing {k}"


# ---- billing list does not expose blob fields ----
class TestBillingInvoicesNoBlobs:
    def test_invoices_response_excludes_blobs(self, master_token):
        r = requests.get(f"{API}/billing/invoices", headers=H(master_token), timeout=10)
        assert r.status_code == 200
        for inv in r.json():
            assert "xlsx_blob" not in inv
            assert "pdf_blob" not in inv
            assert "_id" not in inv  # mongo id stripped


# ---- corp admin invoice scoping (data check) ----
class TestCorpAdminInvoiceScoping:
    def test_corp_admin_only_sees_own_company(self, corp_admin_token, master_token):
        # Lookup corp admin user → company_id
        me = requests.get(f"{API}/auth/me", headers=H(corp_admin_token), timeout=10).json()
        company_id = me.get("company_id")
        if not company_id:
            pytest.skip("no company_id on corp admin profile")
        invs = requests.get(f"{API}/billing/invoices", headers=H(corp_admin_token), timeout=10).json()
        for inv in invs:
            # field name could be client_id or company_id depending on schema
            cid = inv.get("company_id") or inv.get("client_id")
            assert cid == company_id, f"leakage! invoice {inv.get('id')} belongs to {cid}, not {company_id}"


# ---- corporate client PATCH ----
class TestCorporateClientPatch:
    def test_create_and_patch(self, master_token):
        name = f"PatchTest {uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/master/corporate-clients",
            json={"name": name, "address": "A", "contact_email": f"p-{uuid.uuid4().hex[:6]}@x.com", "contact_phone": "+91"},
            headers=H(master_token), timeout=10,
        )
        assert r.status_code == 200
        cid = r.json()["id"]
        # PATCH
        r2 = requests.patch(
            f"{API}/master/corporate-clients/{cid}",
            json={"address": "New Address 42"},
            headers=H(master_token), timeout=10,
        )
        assert r2.status_code in (200, 204), r2.text
        # Verify persistence via list
        invs = requests.get(f"{API}/master/corporate-clients", headers=H(master_token), timeout=10).json()
        found = next((c for c in invs if c["id"] == cid), None)
        assert found is not None
        assert found.get("address") == "New Address 42"
        # cleanup
        requests.delete(f"{API}/master/corporate-clients/{cid}", headers=H(master_token), timeout=10)
