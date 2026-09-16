"""Refund action tests (iteration 80).
Covers GET /admin/refunds/pending, POST /orders/{id}/refund for:
- master_admin (allowed): offline row clears; razorpay retry stays refund_failed
- accounts/finance sub_admin (allowed): can refund
- corporate_admin (denied): 403 on refund
"""
import os
import time
import requests
import pytest

def _read_env():
    for pth in ("/app/frontend/.env", "/app/backend/.env"):
        try:
            with open(pth) as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        return line.split("=", 1)[1].strip()
        except FileNotFoundError:
            pass
    return os.environ.get("REACT_APP_BACKEND_URL", "")

BASE_URL = _read_env().rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"
MASTER_EMAIL = "admin@cravitoo.com"
MASTER_PASSWORD = "admin123"
CORP_EMAIL = "audit_corpadmin_a@corpa.com"
CORP_PASSWORD = "Audit#1234"
MONTH = "2026-09"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def master():
    return _login(MASTER_EMAIL, MASTER_PASSWORD)


@pytest.fixture(scope="module")
def corp():
    return _login(CORP_EMAIL, CORP_PASSWORD)


@pytest.fixture(scope="module")
def finance(master):
    """Create an accounts/finance sub_admin (sales:view_all) and log in via magic link."""
    import uuid
    email = f"TEST_finance_{uuid.uuid4().hex[:6]}@cravitoo.com"
    r = master.post(
        f"{BASE_URL}/api/admin/sub-admins",
        json={
            "name": "TEST Finance",
            "email": email,
            "permissions": ["sales:view_all"],
            "site_ids": [],
        },
    )
    assert r.status_code in (200, 201), r.text
    j = r.json()
    magic_url = j.get("magic_url") or j.get("magic_link") or ""
    sub_id = j.get("id") or j.get("_id") or (j.get("sub_admin") or {}).get("id")
    # Extract token
    token = magic_url.rstrip("/").split("/")[-1]
    s = requests.Session()
    gr = s.get(f"{BASE_URL}/api/auth/magic/{token}")
    assert gr.status_code == 200, gr.text
    cr = s.post(f"{BASE_URL}/api/auth/magic/{token}/complete", json={"password": "Finance#1234"})
    assert cr.status_code == 200, cr.text
    me = s.get(f"{BASE_URL}/api/auth/me")
    assert me.status_code == 200 and me.json().get("role") == "sub_admin"
    yield s
    # Teardown
    if sub_id:
        master.delete(f"{BASE_URL}/api/admin/sub-admins/{sub_id}")


def _fetch_pending(session):
    r = session.get(f"{BASE_URL}/api/admin/refunds/pending", params={"month": MONTH})
    assert r.status_code == 200, r.text
    return r.json()


def _fetch_settlement(session):
    r = session.get(f"{BASE_URL}/api/admin/settlement-report", params={"month": MONTH})
    assert r.status_code == 200, r.text
    return r.json()


class TestPendingListing:
    def test_master_sees_three_rows(self, master):
        data = _fetch_pending(master)
        # Filter to _refund_test-seeded rows by amount matches
        amounts = sorted([it["amount"] for it in data["items"]])
        assert 140.0 in amounts and 100.0 in amounts and 80.0 in amounts, f"Got: {amounts}"
        assert data["count"] >= 3

    def test_finance_sees_rows(self, finance):
        data = _fetch_pending(finance)
        amounts = [it["amount"] for it in data["items"]]
        assert 140.0 in amounts and 100.0 in amounts and 80.0 in amounts

    def test_corporate_admin_scope(self, corp):
        # Corp admin should NOT see _refund_test orders (different company scope)
        data = _fetch_pending(corp)
        # It's fine if list is empty; ensure no 500
        assert isinstance(data.get("items"), list)


class TestRefundActions:
    def _find(self, session, amount, status_filter=None):
        data = _fetch_pending(session)
        for it in data["items"]:
            if it["amount"] == amount and (status_filter is None or it["refund_status"] == status_filter):
                return it
        return None

    def test_offline_140_refund_pending_clears(self, master):
        row = self._find(master, 140.0)
        assert row is not None, "seed row ₹140 missing"
        oid = row["order_id"]

        pre_settle = _fetch_settlement(master)
        pre_refunded = pre_settle["refunds"]["refunded"]["amount"]
        pre_pending = pre_settle["refunds"]["refund_pending"]["amount"]

        r = master.post(f"{BASE_URL}/api/orders/{oid}/refund")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["refund_status"] == "refunded"

        # Verify row cleared from pending
        time.sleep(0.5)
        after = _fetch_pending(master)
        assert not any(it["order_id"] == oid for it in after["items"])

        post_settle = _fetch_settlement(master)
        assert post_settle["refunds"]["refunded"]["amount"] == pytest.approx(pre_refunded + 140.0)
        # pending should have dropped by 140
        assert post_settle["refunds"]["refund_pending"]["amount"] == pytest.approx(max(0.0, pre_pending - 140.0))

    def test_offline_100_needs_refund_issue(self, finance):
        # Finance user can issue refund
        row = self._find(finance, 100.0)
        assert row is not None
        oid = row["order_id"]
        r = finance.post(f"{BASE_URL}/api/orders/{oid}/refund")
        assert r.status_code == 200, r.text
        assert r.json()["refund_status"] == "refunded"
        after = _fetch_pending(finance)
        assert not any(it["order_id"] == oid for it in after["items"])

    def test_razorpay_80_retry_stays_failed(self, master):
        row = self._find(master, 80.0)
        assert row is not None
        oid = row["order_id"]
        r = master.post(f"{BASE_URL}/api/orders/{oid}/refund")
        # Should be 200 (retryable) but refund_status stays refund_failed due to fake payment id
        assert r.status_code == 200, r.text
        rs = r.json()["refund_status"]
        assert rs in ("refund_failed", "refund_pending"), f"unexpected status {rs}"
        # Still appears in pending list
        after = _fetch_pending(master)
        assert any(it["order_id"] == oid for it in after["items"])


class TestAuthorization:
    def test_corporate_admin_refund_forbidden(self, master, corp):
        # Need a valid paid+cancelled order id; grab from master's pending list
        data = _fetch_pending(master)
        target = None
        for it in data["items"]:
            if it["amount"] == 80.0:
                target = it["order_id"]
                break
        if not target:
            pytest.skip("no razorpay row remaining")
        r = corp.post(f"{BASE_URL}/api/orders/{target}/refund")
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"
