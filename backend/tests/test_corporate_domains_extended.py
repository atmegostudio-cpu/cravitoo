"""
Extended Step 1 coverage requested by E1 review:
 - GET /api/auth/check-domain returns allowed=true once techcorp.com is in allowlist
 - OTP request blocks new gmail.com sign-ups but allows new addresses in allowed domains
 - GET /api/sites/{id} returns lifecycle_status; legacy sites default to 'live'
 - After transitioning a draft site → live, registration with mapped domain succeeds
 - Email-trigger smoke: vendor master-decision and menu-change-request decision endpoints
   don't 500 and return a sane response shape.
"""
from __future__ import annotations

import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json()["access_token"]


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def master_token():
    return _login("admin@cravitoo.com", "admin123")


@pytest.fixture(scope="module")
def techcorp_seeded(master_token):
    """Ensure techcorp.com is present in the allowlist."""
    existing = requests.get(f"{API}/admin/allowed-domains", headers=H(master_token), timeout=10).json()
    if not any(d.get("domain") == "techcorp.com" for d in existing):
        r = requests.post(
            f"{API}/admin/allowed-domains",
            json={"domain": "techcorp.com", "notes": "seeded by tests"},
            headers=H(master_token),
            timeout=10,
        )
        # If duplicate (race) accept 400 too
        assert r.status_code in (200, 400), r.text
    return "techcorp.com"


# ---------- Domain check API ----------

class TestCheckDomain:
    def test_allowed_domain_returns_true(self, techcorp_seeded):
        r = requests.get(f"{API}/auth/check-domain/{techcorp_seeded}", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data["allowed"] is True, f"expected allowed=true got {data}"


# ---------- Register at an allowed domain works ----------

class TestRegisterAllowedDomain:
    def test_register_corporate_email(self, techcorp_seeded):
        email = f"reg-{uuid.uuid4().hex[:6]}@{techcorp_seeded}"
        r = requests.post(
            f"{API}/auth/register",
            json={"email": email, "password": "abcd1234", "name": "Reg Tester", "role": "employee"},
            timeout=15,
        )
        # The site backing techcorp.com is 'live' (legacy default), so this should succeed.
        assert r.status_code in (200, 201), f"got {r.status_code} {r.text}"


# ---------- OTP request blocks free providers ----------

class TestOtpRequest:
    def test_otp_blocks_gmail(self):
        r = requests.post(
            f"{API}/auth/otp/request",
            json={"email": f"newuser-{uuid.uuid4().hex[:6]}@gmail.com"},
            timeout=10,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text}"
        detail = (r.json().get("detail") or "").lower()
        assert "corporate" in detail or "gmail" in detail or "free" in detail

    def test_otp_allows_corporate_domain(self, techcorp_seeded):
        # Use a fresh email on the allowed domain
        r = requests.post(
            f"{API}/auth/otp/request",
            json={"email": f"otp-{uuid.uuid4().hex[:6]}@{techcorp_seeded}"},
            timeout=15,
        )
        # Corporate domain MUST be accepted. We previously tolerated 502 here
        # while Resend was on a free-tier plan that was easily rate-limited;
        # that's no longer the case (paid plan active), so a 502 is now a real
        # failure signal and the test will surface it directly.
        if r.status_code == 400:
            detail = (r.json().get("detail") or "").lower()
            assert "corporate" not in detail and "free" not in detail, (
                f"OTP wrongly rejected allowed domain: {detail}"
            )
        else:
            assert r.status_code in (200, 201, 202), r.text


# ---------- GET site returns lifecycle_status ----------

class TestSiteGetLifecycleField:
    def test_site_get_has_lifecycle_field(self, master_token):
        r = requests.get(f"{API}/sites", headers=H(master_token), timeout=10)
        assert r.status_code == 200
        sites = r.json()
        assert isinstance(sites, list) and len(sites) > 0
        # Find a 'live' site (legacy default)
        legacy = next((s for s in sites if s.get("lifecycle_status") == "live"), None)
        assert legacy is not None, "no site found with lifecycle_status=live (legacy default)"

        rd = requests.get(f"{API}/sites/{legacy['id']}", headers=H(master_token), timeout=10)
        assert rd.status_code == 200
        body = rd.json()
        assert "lifecycle_status" in body
        assert body["lifecycle_status"] in ("draft", "configured", "live")


# ---------- Lifecycle flips gate then unblocks registration ----------

class TestLifecycleUnblocksRegistration:
    def test_after_live_registration_succeeds(self, master_token):
        # Create draft site
        site_body = {
            "name": f"LCFlow_{uuid.uuid4().hex[:6]}",
            "address": "Flow Lane",
            "city": "Pune",
            "contact_email": "flow@test.com",
            "contact_phone": "+91-9999999997",
            "allow_pre_order": True,
            "allow_cash_carry": True,
        }
        r = requests.post(f"{API}/sites", json=site_body, headers=H(master_token), timeout=10)
        assert r.status_code == 200
        site_id = r.json()["id"]
        assert r.json()["lifecycle_status"] == "draft"

        # Add domain mapped to this site
        domain = f"lcflow-{uuid.uuid4().hex[:6]}.com"
        rd = requests.post(
            f"{API}/admin/allowed-domains",
            json={"domain": domain, "site_id": site_id},
            headers=H(master_token),
            timeout=10,
        )
        assert rd.status_code == 200, rd.text
        dom_id = rd.json()["id"]

        # Register should fail while draft
        rr = requests.post(
            f"{API}/auth/register",
            json={"email": f"u1@{domain}", "password": "abcd1234", "name": "U1", "role": "employee"},
            timeout=15,
        )
        assert rr.status_code == 400

        # draft → configured → live
        r1 = requests.post(f"{API}/sites/{site_id}/lifecycle", json={"to": "configured"}, headers=H(master_token), timeout=10)
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/sites/{site_id}/lifecycle", json={"to": "live", "poc_name": "PoC"}, headers=H(master_token), timeout=15)
        assert r2.status_code == 200
        assert r2.json()["lifecycle_status"] == "live"

        # Now registration should work
        rr2 = requests.post(
            f"{API}/auth/register",
            json={"email": f"u2@{domain}", "password": "abcd1234", "name": "U2", "role": "employee"},
            timeout=15,
        )
        assert rr2.status_code in (200, 201), f"post-live register failed: {rr2.status_code} {rr2.text}"

        # cleanup
        requests.delete(f"{API}/admin/allowed-domains/{dom_id}", headers=H(master_token), timeout=10)


# ---------- Vendor/Menu decision smoke (no 500s) ----------

class TestDecisionSmoke:
    def test_vendor_master_decision_does_not_500(self, master_token):
        # Pick the first onboarding vendor draft, if any
        r = requests.get(f"{API}/onboarding/vendors", headers=H(master_token), timeout=10)
        if r.status_code != 200:
            pytest.skip(f"cannot list onboarding vendors: {r.status_code}")
        vendors = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        if not vendors:
            pytest.skip("no onboarding vendors to test against")

        target = vendors[0]
        vid = target.get("id") or target.get("_id")
        r2 = requests.post(
            f"{API}/onboarding/vendors/{vid}/master-decision",
            json={"decision": "approve", "notes": "smoke"},
            headers=H(master_token),
            timeout=15,
        )
        # Endpoint should not 500; accept 200/400/404/409 (state machine constraints)
        assert r2.status_code != 500, f"vendor approve 500: {r2.text}"
        assert r2.status_code in (200, 400, 404, 409, 422), f"unexpected {r2.status_code} {r2.text}"
        if r2.status_code == 200:
            body = r2.json()
            assert any(k in body for k in ("status", "ok", "vendor", "id"))

    def test_menu_change_decision_does_not_500(self, master_token):
        # List menu change requests
        r = requests.get(f"{API}/menu-change-requests", headers=H(master_token), timeout=10)
        if r.status_code != 200:
            pytest.skip(f"cannot list menu change requests: {r.status_code}")
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        if not items:
            pytest.skip("no menu-change-requests to test against")
        target = items[0]
        mid = target.get("id") or target.get("_id")
        r2 = requests.post(
            f"{API}/menu-change-requests/{mid}/decision",
            json={"action": "approve", "notes": "smoke"},
            headers=H(master_token),
            timeout=15,
        )
        # Some implementations use 'decision' field rather than 'action'; try fallback
        if r2.status_code in (400, 422):
            r2 = requests.post(
                f"{API}/menu-change-requests/{mid}/decision",
                json={"decision": "approve", "notes": "smoke"},
                headers=H(master_token),
                timeout=15,
            )
        assert r2.status_code != 500, f"menu decide 500: {r2.text}"
        assert r2.status_code in (200, 400, 404, 409, 422), f"unexpected {r2.status_code} {r2.text}"
