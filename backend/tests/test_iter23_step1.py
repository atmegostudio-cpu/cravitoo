"""
Tests for iter23 — Step 1 from PDF gap analysis:
  1. Corporate domain allowlist (sign-up restriction)
  4. Email triggers (vendor decision, menu decision, site activated) — wiring verified
  7. Site lifecycle Draft → Configured → Live

We assert HTTP behaviours; we don't assert email delivery (best-effort via Resend),
only that endpoints respond OK and embed expected fields.
"""
from __future__ import annotations

import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://corporate-feast.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def master_token():
    return _login("admin@cravitoo.com", "admin123")


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Item #1: corporate domain restriction ----------

class TestAllowedDomains:
    def test_list_requires_master(self):
        r = requests.get(f"{API}/admin/allowed-domains", timeout=10)
        # unauthenticated → 401
        assert r.status_code in (401, 403)

    def test_master_can_list(self, master_token):
        r = requests.get(f"{API}/admin/allowed-domains", headers=H(master_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_master_can_add_and_remove(self, master_token):
        domain = f"itercheck-{uuid.uuid4().hex[:6]}.com"
        # add
        r = requests.post(
            f"{API}/admin/allowed-domains",
            json={"domain": domain, "notes": "itercheck"},
            headers=H(master_token),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        new_id = r.json()["id"]
        # duplicate add → 400
        r2 = requests.post(
            f"{API}/admin/allowed-domains",
            json={"domain": domain},
            headers=H(master_token),
            timeout=10,
        )
        assert r2.status_code == 400
        # remove
        r3 = requests.delete(f"{API}/admin/allowed-domains/{new_id}", headers=H(master_token), timeout=10)
        assert r3.status_code == 200

    def test_cannot_add_free_provider(self, master_token):
        r = requests.post(
            f"{API}/admin/allowed-domains",
            json={"domain": "gmail.com"},
            headers=H(master_token),
            timeout=10,
        )
        assert r.status_code == 400

    def test_check_domain_blocks_free_provider(self):
        r = requests.get(f"{API}/auth/check-domain/gmail.com", timeout=10)
        assert r.status_code == 200
        assert r.json()["allowed"] is False
        assert r.json()["reason"] == "free_provider"

    def test_register_blocks_gmail(self):
        r = requests.post(
            f"{API}/auth/register",
            json={"email": f"blocked-{uuid.uuid4().hex[:4]}@gmail.com", "password": "abcd1234", "name": "X", "role": "employee"},
            timeout=10,
        )
        assert r.status_code == 400
        assert "corporate" in r.json().get("detail", "").lower()


# ---------- Item #7: site lifecycle ----------

class TestSiteLifecycle:
    def test_create_site_default_draft(self, master_token):
        body = {
            "name": f"LCTest_{uuid.uuid4().hex[:6]}",
            "address": "1 Test Lane",
            "city": "Pune",
            "contact_email": "poc@test.com",
            "contact_phone": "+91-9999999999",
            "allow_pre_order": True,
            "allow_cash_carry": True,
        }
        r = requests.post(f"{API}/sites", json=body, headers=H(master_token), timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["lifecycle_status"] == "draft"
        TestSiteLifecycle.site_id = d["id"]

    def test_invalid_jump_draft_to_live(self, master_token):
        r = requests.post(
            f"{API}/sites/{TestSiteLifecycle.site_id}/lifecycle",
            json={"to": "live"},
            headers=H(master_token),
            timeout=10,
        )
        assert r.status_code == 400
        assert "configured" in r.json().get("detail", "")

    def test_draft_to_configured(self, master_token):
        r = requests.post(
            f"{API}/sites/{TestSiteLifecycle.site_id}/lifecycle",
            json={"to": "configured"},
            headers=H(master_token),
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["lifecycle_status"] == "configured"

    def test_configured_to_live_returns_email_status(self, master_token):
        r = requests.post(
            f"{API}/sites/{TestSiteLifecycle.site_id}/lifecycle",
            json={"to": "live", "poc_name": "Anjali"},
            headers=H(master_token),
            timeout=10,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["lifecycle_status"] == "live"
        # The response always tells us whether the email send was attempted.
        assert "site_activated_email_sent" in d

    def test_live_to_back_to_configured(self, master_token):
        r = requests.post(
            f"{API}/sites/{TestSiteLifecycle.site_id}/lifecycle",
            json={"to": "configured"},
            headers=H(master_token),
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["lifecycle_status"] == "configured"

    def test_invalid_target(self, master_token):
        r = requests.post(
            f"{API}/sites/{TestSiteLifecycle.site_id}/lifecycle",
            json={"to": "frozen"},
            headers=H(master_token),
            timeout=10,
        )
        assert r.status_code == 400

    def test_non_master_blocked(self):
        # Login a non-master (employee credentials)
        emp_tok = _login("employee@techcorp.com", "employee123")
        r = requests.post(
            f"{API}/sites/{TestSiteLifecycle.site_id}/lifecycle",
            json={"to": "live"},
            headers=H(emp_tok),
            timeout=10,
        )
        assert r.status_code == 403


# ---------- Item #1 + #7 interaction: lifecycle gating ----------

class TestRegistrationGatedBySiteLifecycle:
    def test_register_blocked_when_site_not_live(self, master_token):
        # Create a draft site bound to a fresh domain
        site_body = {
            "name": f"GateTest_{uuid.uuid4().hex[:6]}",
            "address": "Gate Lane",
            "city": "Mumbai",
            "contact_email": "gate@test.com",
            "contact_phone": "+91-9999999998",
            "allow_pre_order": True,
            "allow_cash_carry": True,
        }
        r = requests.post(f"{API}/sites", json=site_body, headers=H(master_token), timeout=10)
        assert r.status_code == 200
        site_id = r.json()["id"]
        assert r.json()["lifecycle_status"] == "draft"

        # Add an allowed-domain rule pointing at this draft site
        domain = f"gatetest-{uuid.uuid4().hex[:6]}.com"
        r = requests.post(
            f"{API}/admin/allowed-domains",
            json={"domain": domain, "site_id": site_id},
            headers=H(master_token),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        dom_id = r.json()["id"]

        # New employee from this domain should be blocked because site is not live
        r = requests.post(
            f"{API}/auth/register",
            json={"email": f"hi@{domain}", "password": "abcd1234", "name": "X", "role": "employee"},
            timeout=10,
        )
        assert r.status_code == 400
        assert "site" in r.json().get("detail", "").lower() or "live" in r.json().get("detail", "").lower()

        # cleanup the domain
        requests.delete(f"{API}/admin/allowed-domains/{dom_id}", headers=H(master_token), timeout=10)
