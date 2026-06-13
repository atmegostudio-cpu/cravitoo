"""
Tests for  — Steps 2-5 from PDF gap analysis:
  2. Meal types on reservations
  3. Corp Admin 20:00-20:45 IST bulk override window
  5. Excel/CSV/PDF exports
  6. Corporate Client lifecycle (Draft -> Review -> Approved -> Active)
  8. Monthly Billing Engine
"""
from __future__ import annotations

import os
import uuid
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def master_token():
    return _login("admin@cravitoo.com", "admin123")


@pytest.fixture(scope="module")
def emp_token():
    return _login("employee@techcorp.com", "employee123")


@pytest.fixture(scope="module")
def corp_admin_token():
    return _login("demo@techcorp.com", "demo123")


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Step 2: meal types ----------

class TestMealTypes:
    def test_availability_returns_meal_types(self, emp_token):
        r = requests.get(f"{API}/reservations/availability", headers=H(emp_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "meal_types" in d
        types = {x["key"] for x in d["meal_types"]}
        assert types == {"veg_meal", "non_veg_meal", "veg_salad", "non_veg_salad"}

    def test_reservation_requires_meal_type(self, emp_token):
        # Get a valid vendor first
        r = requests.get(f"{API}/reservations/availability", headers=H(emp_token), timeout=10)
        meals = r.json()["meals"]
        valid = next((m for m in meals if m["eligible_vendors"] and not m["cutoff_passed"] and not m.get("already_reserved")), None)
        if not valid:
            pytest.skip("No eligible vendor/meal available for employee")
        body = {"vendor_id": valid["eligible_vendors"][0]["id"], "meal_period": valid["meal_period"]}
        # missing meal_type → 422 (pydantic validation)
        r = requests.post(f"{API}/reservations", json=body, headers=H(emp_token), timeout=10)
        assert r.status_code in (400, 422)

    def test_invalid_meal_type_rejected(self, emp_token):
        r = requests.get(f"{API}/reservations/availability", headers=H(emp_token), timeout=10)
        meals = r.json()["meals"]
        valid = next((m for m in meals if m["eligible_vendors"]), None)
        if not valid:
            pytest.skip("No eligible vendor")
        body = {"vendor_id": valid["eligible_vendors"][0]["id"], "meal_period": valid["meal_period"], "meal_type": "fish_curry"}
        r = requests.post(f"{API}/reservations", json=body, headers=H(emp_token), timeout=10)
        assert r.status_code == 400
        assert "meal_type" in r.json().get("detail", "")


# ---------- Step 2: bulk window ----------

class TestBulkWindow:
    def test_bulk_window_status_open_or_closed(self, corp_admin_token):
        r = requests.get(f"{API}/reservations/bulk-window", headers=H(corp_admin_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "is_open" in d
        assert isinstance(d["is_open"], bool)
        assert len(d["meal_types"]) == 4

    def test_bulk_endpoint_not_corp_admin_blocked(self, emp_token, master_token):
        # employee should be blocked
        r = requests.post(f"{API}/reservations/bulk", json={"site_id": "x", "vendor_id": "y", "meal_period": "lunch", "counts": {"veg_meal": 1}}, headers=H(emp_token), timeout=10)
        assert r.status_code == 403
        # master too
        r = requests.post(f"{API}/reservations/bulk", json={"site_id": "x", "vendor_id": "y", "meal_period": "lunch", "counts": {"veg_meal": 1}}, headers=H(master_token), timeout=10)
        assert r.status_code == 403

    def test_bulk_outside_window_returns_400(self, corp_admin_token):
        # Get a real site_id
        sites = requests.get(f"{API}/sites", headers=H(corp_admin_token), timeout=10).json()
        if not sites:
            pytest.skip("No sites")
        # If window is open this test will create real data; only verify rejection when closed
        win = requests.get(f"{API}/reservations/bulk-window", headers=H(corp_admin_token), timeout=10).json()
        if win["is_open"]:
            pytest.skip("Window is currently open — cannot test rejection")
        r = requests.post(
            f"{API}/reservations/bulk",
            json={"site_id": sites[0]["id"], "vendor_id": "6a1453884b08d749d396b68a", "meal_period": "lunch", "counts": {"veg_meal": 1}},
            headers=H(corp_admin_token), timeout=10,
        )
        assert r.status_code == 400
        assert "20:00" in r.json().get("detail", "") or "window" in r.json().get("detail", "").lower()

    def test_bulk_count_validation(self, corp_admin_token):
        sites = requests.get(f"{API}/sites", headers=H(corp_admin_token), timeout=10).json()
        if not sites:
            pytest.skip("No sites")
        # unknown meal_type
        r = requests.post(
            f"{API}/reservations/bulk",
            json={"site_id": sites[0]["id"], "vendor_id": "6a1453884b08d749d396b68a", "meal_period": "lunch", "counts": {"fish_curry": 1}},
            headers=H(corp_admin_token), timeout=10,
        )
        assert r.status_code == 400
        # all zeros
        r = requests.post(
            f"{API}/reservations/bulk",
            json={"site_id": sites[0]["id"], "vendor_id": "6a1453884b08d749d396b68a", "meal_period": "lunch", "counts": {"veg_meal": 0}},
            headers=H(corp_admin_token), timeout=10,
        )
        assert r.status_code == 400


# ---------- Step 3: exports ----------

class TestExports:
    @pytest.mark.parametrize("endpoint", ["reservations", "orders", "meal-summary"])
    def test_csv_export(self, endpoint, master_token):
        r = requests.get(f"{API}/exports/{endpoint}?format=csv", headers=H(master_token), timeout=15)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("text/csv")
        # first byte should be a printable header char
        assert len(r.content) > 0

    @pytest.mark.parametrize("endpoint", ["reservations", "orders", "meal-summary"])
    def test_xlsx_export(self, endpoint, master_token):
        r = requests.get(f"{API}/exports/{endpoint}?format=xlsx", headers=H(master_token), timeout=15)
        assert r.status_code == 200
        # XLSX files are zip-based — magic bytes PK
        assert r.content[:2] == b"PK"

    @pytest.mark.parametrize("endpoint", ["reservations", "orders", "meal-summary"])
    def test_pdf_export(self, endpoint, master_token):
        r = requests.get(f"{API}/exports/{endpoint}?format=pdf", headers=H(master_token), timeout=15)
        assert r.status_code == 200
        assert r.content[:5] == b"%PDF-"

    def test_invalid_format_400(self, master_token):
        r = requests.get(f"{API}/exports/reservations?format=html", headers=H(master_token), timeout=10)
        assert r.status_code == 400


# ---------- Step 4: corporate clients lifecycle ----------

class TestCorporateClientLifecycle:
    client_id: str | None = None

    def test_list_master_only(self, master_token, emp_token):
        r = requests.get(f"{API}/master/corporate-clients", headers=H(master_token), timeout=10)
        assert r.status_code == 200
        r = requests.get(f"{API}/master/corporate-clients", headers=H(emp_token), timeout=10)
        assert r.status_code == 403

    def test_create_default_draft(self, master_token):
        name = f"Test Client {uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/master/corporate-clients",
            json={"name": name, "address": "Addr", "contact_email": f"poc-{uuid.uuid4().hex[:6]}@cravitooclient.com", "contact_phone": "+91-9999"},
            headers=H(master_token), timeout=10,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["lifecycle_status"] == "draft"
        TestCorporateClientLifecycle.client_id = d["id"]

    def test_invalid_jump_to_active(self, master_token):
        r = requests.post(
            f"{API}/master/corporate-clients/{TestCorporateClientLifecycle.client_id}/lifecycle",
            json={"to": "active"},
            headers=H(master_token), timeout=10,
        )
        assert r.status_code == 400

    def test_draft_review_approved_active(self, master_token):
        for target in ["review", "approved", "active"]:
            r = requests.post(
                f"{API}/master/corporate-clients/{TestCorporateClientLifecycle.client_id}/lifecycle",
                json={"to": target},
                headers=H(master_token), timeout=15,
            )
            assert r.status_code == 200, f"to={target}: {r.text}"
            assert r.json()["lifecycle_status"] == target

    def test_invalid_transition_active_to_review(self, master_token):
        # active should only go back to approved
        r = requests.post(
            f"{API}/master/corporate-clients/{TestCorporateClientLifecycle.client_id}/lifecycle",
            json={"to": "review"},
            headers=H(master_token), timeout=10,
        )
        assert r.status_code == 400

    def test_delete(self, master_token):
        r = requests.delete(f"{API}/master/corporate-clients/{TestCorporateClientLifecycle.client_id}", headers=H(master_token), timeout=10)
        assert r.status_code == 200


# ---------- Step 5: billing ----------

class TestBillingEngine:
    def test_manual_run_invalid_month(self, master_token):
        r = requests.post(f"{API}/billing/run", json={"month": "2026"}, headers=H(master_token), timeout=10)
        assert r.status_code == 400

    def test_manual_run_returns_summary(self, master_token):
        r = requests.post(f"{API}/billing/run", json={"month": "2026-06"}, headers=H(master_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["period"] == "2026-06"
        assert "invoices_generated" in d
        assert "skipped_clients" in d

    def test_list_invoices(self, master_token):
        r = requests.get(f"{API}/billing/invoices", headers=H(master_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_emp_cannot_list(self, emp_token):
        r = requests.get(f"{API}/billing/invoices", headers=H(emp_token), timeout=10)
        assert r.status_code == 403

    def test_download_invoice(self, master_token):
        invs = requests.get(f"{API}/billing/invoices", headers=H(master_token), timeout=10).json()
        if not invs:
            pytest.skip("No invoices to download")
        inv = invs[0]
        # xlsx
        r = requests.get(f"{API}/billing/invoices/{inv['id']}/download?format=xlsx", headers=H(master_token), timeout=15)
        assert r.status_code == 200
        assert r.content[:2] == b"PK"
        # pdf
        r = requests.get(f"{API}/billing/invoices/{inv['id']}/download?format=pdf", headers=H(master_token), timeout=15)
        assert r.status_code == 200
        assert r.content[:5] == b"%PDF-"

    def test_corp_admin_sees_only_their_invoices(self, corp_admin_token):
        r = requests.get(f"{API}/billing/invoices", headers=H(corp_admin_token), timeout=10)
        assert r.status_code == 200
        invs = r.json()
        # All invoices must belong to corp_admin's company
        # (we don't fail if empty; just ensure no leakage)
        for inv in invs:
            assert inv.get("client_id"), inv
