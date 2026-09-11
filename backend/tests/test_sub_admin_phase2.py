"""Sub-Admin Phase 2 (expanded catalog + activity log + forgot-password) tests.

Covers Task 1 (Sites/Clients/Feedback/Menu-Requests view/manage with deny-by-default),
Task 2 (sub-admin activity log), Task 3 (forgot-password self-serve), and the
approvals-stay-master regression (onboarding master-decision).
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


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json()["access_token"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def master_token():
    return _login(MASTER_EMAIL, MASTER_PW)


@pytest.fixture(scope="module")
def clients(master_token):
    r = requests.get(f"{API}/master/corporate-clients", headers=_hdr(master_token), timeout=30)
    assert r.status_code == 200
    lst = r.json()
    assert len(lst) >= 2, "need at least 2 corporate clients"
    return lst


@pytest.fixture(scope="module")
def sites(master_token):
    r = requests.get(f"{API}/sites", headers=_hdr(master_token), timeout=30)
    assert r.status_code == 200
    return r.json()


def _make_sub(master_token, perms, scope):
    email = f"TEST_sub_{uuid.uuid4().hex[:8]}@example.com"
    body = {"email": email, "name": "TEST Sub", "permissions": perms, "scope": scope}
    r = requests.post(f"{API}/admin/sub-admins", json=body, headers=_hdr(master_token), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    tok_url = d["magic_url"]
    token = tok_url.rstrip("/").split("/auth/magic/")[-1]
    rr = requests.post(f"{API}/auth/magic/{token}/complete", json={"password": "Pass1234"}, timeout=30)
    assert rr.status_code == 200, rr.text
    login_tok = _login(email, "Pass1234")
    return {"id": d["id"], "email": email, "token": login_tok, "master": master_token}


def _cleanup(sub):
    requests.delete(f"{API}/admin/sub-admins/{sub['id']}", headers=_hdr(sub["master"]), timeout=30)


# ---- Task 1: Permission catalog ----
class TestPermissionCatalog:
    def test_catalog_has_9(self, master_token):
        r = requests.get(f"{API}/admin/permission-catalog", headers=_hdr(master_token), timeout=30)
        assert r.status_code == 200
        perms = r.json()["permissions"]
        keys = {p["key"] for p in perms}
        expected = {
            "vendors:onboard", "sales:view", "sites:view", "sites:manage",
            "clients:view", "clients:manage", "feedback:view", "feedback:manage",
            "menu_requests:view",
        }
        assert expected.issubset(keys), f"missing {expected - keys}"
        assert len(perms) == 9, f"expected 9 perms, got {len(perms)}"


# ---- Feedback ----
class TestFeedback:
    def test_feedback_view_scoped_and_resolve_perm(self, master_token, clients):
        cid = clients[0]["id"]
        # view-only
        sub_v = _make_sub(master_token, ["feedback:view"],
                          {"client_ids": [cid], "city_ids": [], "site_ids": [], "vendor_ids": []})
        try:
            r = requests.get(f"{API}/feedback", headers=_hdr(sub_v["token"]), timeout=30)
            assert r.status_code == 200, r.text
            # analytics should also work
            ra = requests.get(f"{API}/feedback/analytics", headers=_hdr(sub_v["token"]), timeout=30)
            assert ra.status_code == 200

            # resolve without :manage → 403
            rr = requests.patch(f"{API}/feedback/000000000000000000000000/resolve",
                                headers=_hdr(sub_v["token"]), timeout=30)
            assert rr.status_code == 403, f"expected 403 got {rr.status_code}"
        finally:
            _cleanup(sub_v)

    def test_feedback_denied_without_perm(self, master_token, clients):
        sub = _make_sub(master_token, ["sales:view"],
                        {"client_ids": [clients[0]["id"]], "city_ids": [], "site_ids": [], "vendor_ids": []})
        try:
            r = requests.get(f"{API}/feedback", headers=_hdr(sub["token"]), timeout=30)
            assert r.status_code == 403
        finally:
            _cleanup(sub)


# ---- Menu Requests ----
class TestMenuRequests:
    def test_menu_requests_view(self, master_token, clients):
        sub = _make_sub(master_token, ["menu_requests:view"],
                        {"client_ids": [clients[0]["id"]], "city_ids": [], "site_ids": [], "vendor_ids": []})
        try:
            r = requests.get(f"{API}/menu-change-requests", headers=_hdr(sub["token"]), timeout=30)
            assert r.status_code == 200, r.text
            # decision endpoint must be master-only
            rr = requests.post(f"{API}/menu-change-requests/000000000000000000000000/decision",
                               json={"decision": "approve"}, headers=_hdr(sub["token"]), timeout=30)
            assert rr.status_code == 403, f"sub_admin must not decide, got {rr.status_code}"
        finally:
            _cleanup(sub)

    def test_menu_requests_denied_without_perm(self, master_token, clients):
        sub = _make_sub(master_token, ["sales:view"],
                        {"client_ids": [clients[0]["id"]], "city_ids": [], "site_ids": [], "vendor_ids": []})
        try:
            r = requests.get(f"{API}/menu-change-requests", headers=_hdr(sub["token"]), timeout=30)
            assert r.status_code == 403
        finally:
            _cleanup(sub)


# ---- Clients ----
class TestClients:
    def test_clients_view_scoped(self, master_token, clients):
        cid = clients[0]["id"]
        sub = _make_sub(master_token, ["clients:view"],
                        {"client_ids": [cid], "city_ids": [], "site_ids": [], "vendor_ids": []})
        try:
            r = requests.get(f"{API}/master/corporate-clients", headers=_hdr(sub["token"]), timeout=30)
            assert r.status_code == 200
            ids = {c["id"] for c in r.json()}
            assert ids == {cid}, f"expected only in-scope, got {ids}"
        finally:
            _cleanup(sub)

    def test_clients_manage_in_scope_and_out_of_scope(self, master_token, clients):
        in_scope = clients[0]["id"]
        out_scope = clients[1]["id"]
        sub = _make_sub(master_token, ["clients:view", "clients:manage"],
                        {"client_ids": [in_scope], "city_ids": [], "site_ids": [], "vendor_ids": []})
        try:
            r = requests.patch(f"{API}/master/corporate-clients/{in_scope}",
                               json={"notes": "TEST edit by sub-admin"},
                               headers=_hdr(sub["token"]), timeout=30)
            assert r.status_code == 200, f"in-scope PATCH failed: {r.status_code} {r.text}"

            r2 = requests.patch(f"{API}/master/corporate-clients/{out_scope}",
                                json={"notes": "should fail"},
                                headers=_hdr(sub["token"]), timeout=30)
            assert r2.status_code == 403, f"out-of-scope must be 403 got {r2.status_code}"

            # lifecycle must stay master-only regardless of perm
            r3 = requests.post(f"{API}/master/corporate-clients/{in_scope}/lifecycle",
                               json={"to": "review"}, headers=_hdr(sub["token"]), timeout=30)
            assert r3.status_code == 403, f"lifecycle must be master-only, got {r3.status_code}"
        finally:
            _cleanup(sub)

    def test_clients_denied_without_perm(self, master_token, clients):
        sub = _make_sub(master_token, ["sales:view"],
                        {"client_ids": [clients[0]["id"]], "city_ids": [], "site_ids": [], "vendor_ids": []})
        try:
            r = requests.get(f"{API}/master/corporate-clients", headers=_hdr(sub["token"]), timeout=30)
            assert r.status_code == 403
        finally:
            _cleanup(sub)


# ---- Sites ----
class TestSites:
    def test_sites_view_scoped(self, master_token, sites):
        if not sites:
            pytest.skip("no sites seeded")
        target = sites[0]
        sub = _make_sub(master_token, ["sites:view"],
                        {"client_ids": [], "city_ids": [], "site_ids": [target["id"]], "vendor_ids": []})
        try:
            r = requests.get(f"{API}/sites", headers=_hdr(sub["token"]), timeout=30)
            assert r.status_code == 200
            ids = {s["id"] for s in r.json()}
            assert ids == {target["id"]}, f"scope leak: {ids}"
        finally:
            _cleanup(sub)

    def test_sites_manage_in_and_out_scope(self, master_token, sites):
        if len(sites) < 2:
            pytest.skip("need at least 2 sites")
        in_site = sites[0]["id"]
        out_site = sites[1]["id"]
        sub = _make_sub(master_token, ["sites:view", "sites:manage"],
                        {"client_ids": [], "city_ids": [], "site_ids": [in_site], "vendor_ids": []})
        try:
            r = requests.patch(f"{API}/sites/{in_site}",
                               json={"contact_phone": "+91-9999999999"},
                               headers=_hdr(sub["token"]), timeout=30)
            assert r.status_code == 200, f"in-scope 200 expected, got {r.status_code} {r.text}"

            r2 = requests.patch(f"{API}/sites/{out_site}",
                                json={"contact_phone": "+91-8888888888"},
                                headers=_hdr(sub["token"]), timeout=30)
            assert r2.status_code == 403
        finally:
            _cleanup(sub)


# ---- Approvals stay Master (regression) ----
class TestApprovalsMasterOnly:
    def test_onboarding_master_decision_denied_for_sub_admin(self, master_token, clients):
        sub = _make_sub(master_token, ["vendors:onboard"],
                        {"client_ids": [clients[0]["id"]], "city_ids": [], "site_ids": [], "vendor_ids": []})
        try:
            # picking a dummy id; auth check happens before existence
            r = requests.post(f"{API}/onboarding/vendors/000000000000000000000000/master-decision",
                              json={"decision": "approve"}, headers=_hdr(sub["token"]), timeout=30)
            assert r.status_code == 403, f"sub_admin must not master-decide, got {r.status_code} {r.text[:200]}"
        finally:
            _cleanup(sub)


# ---- Deny-by-default ----
class TestDenyByDefault:
    @pytest.fixture(scope="class")
    def perm_less_ok(self):
        # We need something to create; use minimal perms then downgrade via PATCH
        master = _login(MASTER_EMAIL, MASTER_PW)
        r = requests.get(f"{API}/master/corporate-clients", headers=_hdr(master), timeout=30)
        cid = r.json()[0]["id"]
        sub = _make_sub(master, ["sales:view"],
                        {"client_ids": [cid], "city_ids": [], "site_ids": [], "vendor_ids": []})
        yield sub
        _cleanup(sub)

    def test_no_admins_list(self, perm_less_ok):
        r = requests.get(f"{API}/admin/admins", headers=_hdr(perm_less_ok["token"]), timeout=30)
        assert r.status_code == 403

    def test_no_sub_admin_activity(self, perm_less_ok):
        r = requests.get(f"{API}/admin/sub-admin-activity", headers=_hdr(perm_less_ok["token"]), timeout=30)
        assert r.status_code == 403


# ---- Activity Log ----
class TestActivityLog:
    def test_activity_log_master_only_and_records_updates(self, master_token, clients):
        in_scope = clients[0]["id"]
        sub = _make_sub(master_token, ["clients:view", "clients:manage"],
                        {"client_ids": [in_scope], "city_ids": [], "site_ids": [], "vendor_ids": []})
        try:
            # generate an audit event
            r = requests.patch(f"{API}/master/corporate-clients/{in_scope}",
                               json={"notes": f"activity log check {uuid.uuid4().hex[:6]}"},
                               headers=_hdr(sub["token"]), timeout=30)
            assert r.status_code == 200

            # Master reads activity
            act = requests.get(f"{API}/admin/sub-admin-activity",
                               headers=_hdr(master_token), timeout=30)
            assert act.status_code == 200, act.text
            rows = act.json()
            assert isinstance(rows, list)
            mine = [x for x in rows if x.get("user_id") == sub["id"]]
            assert mine, "sub-admin's action should appear"
            assert any(x["action"] == "updated_client" for x in mine)

            # filter by sub_admin_id
            act2 = requests.get(f"{API}/admin/sub-admin-activity",
                                params={"sub_admin_id": sub["id"], "limit": 10},
                                headers=_hdr(master_token), timeout=30)
            assert act2.status_code == 200
            assert all(x["user_id"] == sub["id"] for x in act2.json())
        finally:
            _cleanup(sub)


# ---- Task 3: forgot-password ----
class TestForgotPassword:
    def test_unknown_email_returns_200_uniform(self):
        r = requests.post(f"{API}/auth/forgot-password",
                          json={"email": f"nobody_{uuid.uuid4().hex[:6]}@example.com"}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("success") is True

    def test_known_email_returns_200(self):
        r = requests.post(f"{API}/auth/forgot-password",
                          json={"email": MASTER_EMAIL}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("success") is True

    def test_garbage_returns_200(self):
        r = requests.post(f"{API}/auth/forgot-password", json={"email": ""}, timeout=30)
        assert r.status_code == 200
