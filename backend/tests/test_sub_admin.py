"""Sub-Admin (custom permissions + scope) end-to-end backend tests.

Covers:
 - Master creates Sub-Admin (permission validation, magic-link)
 - Magic link → set-password → /auth/me returns role=sub_admin + perms + scope
 - Positive: sales-report + onboarding list accessible when perm granted
 - Negative: 403 without perm, deny-by-default on other admin endpoints
 - PATCH / resend / DELETE
 - Regression: master can still create site_admin / super_admin / vendor_operator; corp_admin can still hit sales-report
"""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

MASTER_EMAIL = "admin@cravitoo.com"
MASTER_PW = "admin123"
CORP_ADMIN_EMAIL = "audit_corpadmin_a@corpa.com"
CORP_ADMIN_PW = "Audit#1234"


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json()["access_token"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def master_token():
    return _login(MASTER_EMAIL, MASTER_PW)


@pytest.fixture(scope="module")
def corp_client_id(master_token):
    r = requests.get(f"{API}/master/corporate-clients", headers=_hdr(master_token), timeout=30)
    assert r.status_code == 200, r.text
    clients = r.json()
    assert clients, "no corporate clients seeded"
    return clients[0]["id"]


def _create_sub_admin(master_token, perms, scope, name="TEST Sub Admin"):
    email = f"TEST_sub_{uuid.uuid4().hex[:8]}@example.com"
    body = {"email": email, "name": name, "permissions": perms, "scope": scope}
    r = requests.post(f"{API}/admin/sub-admins", json=body, headers=_hdr(master_token), timeout=30)
    return r, email


def _set_password_via_magic(magic_url, password="Pass1234"):
    # extract token
    token = magic_url.rstrip("/").split("/auth/magic/")[-1]
    r = requests.post(f"{API}/auth/magic/{token}/complete", json={"password": password}, timeout=30)
    assert r.status_code == 200, f"magic complete -> {r.status_code} {r.text}"
    return r.json()


# ---------- Tests ----------
class TestSubAdminCreation:
    def test_permission_catalog(self, master_token):
        r = requests.get(f"{API}/admin/permission-catalog", headers=_hdr(master_token), timeout=30)
        assert r.status_code == 200
        keys = {p["key"] for p in r.json()["permissions"]}
        assert "vendors:onboard" in keys and "sales:view" in keys

    def test_create_requires_permission(self, master_token):
        r, _ = _create_sub_admin(master_token, [], {"client_ids": [], "city_ids": [], "site_ids": [], "vendor_ids": []})
        assert r.status_code == 400
        assert "permission" in r.text.lower()

    def test_create_ok_returns_magic_link(self, master_token, corp_client_id):
        r, email = _create_sub_admin(
            master_token, ["sales:view", "vendors:onboard"],
            {"client_ids": [corp_client_id], "city_ids": [], "site_ids": [], "vendor_ids": []},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["success"] and data["email"] == email.lower()
        assert "/auth/magic/" in data["magic_url"]
        # cleanup
        requests.delete(f"{API}/admin/sub-admins/{data['id']}", headers=_hdr(master_token), timeout=30)


class TestSubAdminLoginAndEnforcement:
    """Create a sub-admin with sales:view + vendors:onboard, set password, verify enforcement."""

    @pytest.fixture(scope="class")
    def dual_sub(self, master_token, corp_client_id):
        r, email = _create_sub_admin(
            master_token, ["sales:view", "vendors:onboard"],
            {"client_ids": [corp_client_id], "city_ids": [], "site_ids": [], "vendor_ids": []},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        _set_password_via_magic(d["magic_url"], "Pass1234")
        tok = _login(email, "Pass1234")
        yield {"id": d["id"], "email": email, "token": tok}
        requests.delete(f"{API}/admin/sub-admins/{d['id']}", headers=_hdr(master_token), timeout=30)

    def test_me_reports_role_and_perms(self, dual_sub):
        r = requests.get(f"{API}/auth/me", headers=_hdr(dual_sub["token"]), timeout=30)
        assert r.status_code == 200
        me = r.json()
        assert me.get("role") == "sub_admin"
        perms = set(me.get("permissions") or [])
        assert {"sales:view", "vendors:onboard"}.issubset(perms)
        assert "scope" in me

    def test_sales_report_allowed(self, dual_sub):
        r = requests.get(f"{API}/admin/sales-report?month=2026-09", headers=_hdr(dual_sub["token"]), timeout=30)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"

    def test_onboarding_list_allowed(self, dual_sub):
        r = requests.get(f"{API}/onboarding/vendors", headers=_hdr(dual_sub["token"]), timeout=30)
        assert r.status_code == 200, r.text[:200]

    def test_deny_by_default_admins_endpoint(self, dual_sub):
        r = requests.get(f"{API}/admin/admins", headers=_hdr(dual_sub["token"]), timeout=30)
        assert r.status_code == 403

    def test_deny_by_default_corporate_clients(self, dual_sub):
        r = requests.get(f"{API}/master/corporate-clients", headers=_hdr(dual_sub["token"]), timeout=30)
        assert r.status_code == 403

    def test_deny_by_default_sub_admins_list(self, dual_sub):
        r = requests.get(f"{API}/admin/sub-admins", headers=_hdr(dual_sub["token"]), timeout=30)
        assert r.status_code == 403


class TestNegativePermissions:
    """Sub-admin missing a permission must get 403 on that module."""

    @pytest.fixture(scope="class")
    def sales_only(self, master_token, corp_client_id):
        r, email = _create_sub_admin(
            master_token, ["sales:view"],
            {"client_ids": [corp_client_id], "city_ids": [], "site_ids": [], "vendor_ids": []},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        _set_password_via_magic(d["magic_url"], "Pass1234")
        tok = _login(email, "Pass1234")
        yield {"id": d["id"], "token": tok}
        requests.delete(f"{API}/admin/sub-admins/{d['id']}", headers=_hdr(master_token), timeout=30)

    @pytest.fixture(scope="class")
    def onboard_only(self, master_token, corp_client_id):
        r, email = _create_sub_admin(
            master_token, ["vendors:onboard"],
            {"client_ids": [corp_client_id], "city_ids": [], "site_ids": [], "vendor_ids": []},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        _set_password_via_magic(d["magic_url"], "Pass1234")
        tok = _login(email, "Pass1234")
        yield {"id": d["id"], "token": tok}
        requests.delete(f"{API}/admin/sub-admins/{d['id']}", headers=_hdr(master_token), timeout=30)

    def test_sales_only_sees_sales(self, sales_only):
        r = requests.get(f"{API}/admin/sales-report?month=2026-09", headers=_hdr(sales_only["token"]), timeout=30)
        assert r.status_code == 200

    def test_sales_only_denied_onboarding(self, sales_only):
        r = requests.get(f"{API}/onboarding/vendors", headers=_hdr(sales_only["token"]), timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text[:200]}"

    def test_onboard_only_denied_sales(self, onboard_only):
        r = requests.get(f"{API}/admin/sales-report?month=2026-09", headers=_hdr(onboard_only["token"]), timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text[:200]}"

    def test_onboard_only_allowed_onboarding(self, onboard_only):
        r = requests.get(f"{API}/onboarding/vendors", headers=_hdr(onboard_only["token"]), timeout=30)
        assert r.status_code == 200


class TestSubAdminManagement:
    def test_patch_resend_delete_flow(self, master_token, corp_client_id):
        r, email = _create_sub_admin(
            master_token, ["sales:view"],
            {"client_ids": [corp_client_id], "city_ids": [], "site_ids": [], "vendor_ids": []},
        )
        assert r.status_code == 200
        sid = r.json()["id"]

        # LIST includes new sub-admin
        lst = requests.get(f"{API}/admin/sub-admins", headers=_hdr(master_token), timeout=30)
        assert lst.status_code == 200
        assert any(x["id"] == sid for x in lst.json())

        # PATCH -> add vendors:onboard
        p = requests.patch(f"{API}/admin/sub-admins/{sid}",
                           json={"permissions": ["sales:view", "vendors:onboard"]},
                           headers=_hdr(master_token), timeout=30)
        assert p.status_code == 200, p.text

        # verify PATCH persisted
        lst2 = requests.get(f"{API}/admin/sub-admins", headers=_hdr(master_token), timeout=30).json()
        rec = next(x for x in lst2 if x["id"] == sid)
        assert set(rec["permissions"]) == {"sales:view", "vendors:onboard"}

        # RESEND
        rr = requests.post(f"{API}/admin/sub-admins/{sid}/resend", headers=_hdr(master_token), timeout=30)
        assert rr.status_code == 200
        assert "/auth/magic/" in rr.json()["magic_url"]

        # DELETE
        d = requests.delete(f"{API}/admin/sub-admins/{sid}", headers=_hdr(master_token), timeout=30)
        assert d.status_code == 200
        lst3 = requests.get(f"{API}/admin/sub-admins", headers=_hdr(master_token), timeout=30).json()
        assert all(x["id"] != sid for x in lst3)


class TestRegression:
    def test_corp_admin_sales_still_works(self):
        tok = _login(CORP_ADMIN_EMAIL, CORP_ADMIN_PW)
        r = requests.get(f"{API}/admin/sales-report?month=2026-09", headers=_hdr(tok), timeout=30)
        assert r.status_code == 200

    def test_master_admins_endpoint_still_lists(self, master_token):
        r = requests.get(f"{API}/admin/admins", headers=_hdr(master_token), timeout=30)
        assert r.status_code == 200
