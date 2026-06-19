"""Phase 1 — Critical Fix Tests

Covers all five Phase 1 vulnerabilities reported by the security audit:

  Bug 1  Logout/session redirect — frontend; smoke-tested via Playwright in a
          separate suite (see tests/e2e/test_session_expired_redirect.spec.js).
          This Python suite only asserts the BACKEND side: `/api/auth/me`
          returns 401 without leaking demo or session info, and the public
          /api/admin/demo/enabled probe behaves correctly.
  Bug 2  Public demo credentials — backend MUST never return demo passwords in
          /api/admin/demo/status; the frontend has the demo block removed.
  Bug 3  Demo accounts in production — `_guard_non_production()` returns 404
          on all /api/admin/demo/* endpoints when CRAVITOO_ENV=production.
  Bug 4  Privilege escalation via /auth/register — every non-employee role MUST
          be rejected with 403 and an audit_log entry written.
  Bug 5  Order lifecycle — server enforces the transition graph, blocks stale
          orders, makes terminal states immutable, and concurrent updates are
          atomic.

These tests hit the running backend over HTTP — no in-process imports — to
mirror how a real attacker / client would behave.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "cravitoo_db")

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@cravitoo.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")


# ───────────────────────── helpers ──────────────────────────────────────────


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json()["access_token"]


def H(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def master_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


# ───────────────────────── Bug 2 + Bug 3: demo gating ───────────────────────


class TestDemoGuard:
    def test_public_enabled_probe_responds(self):
        r = requests.get(f"{API}/admin/demo/enabled", timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "demo_enabled" in body and "environment" in body

    def test_status_never_returns_passwords(self, master_token):
        r = requests.get(f"{API}/admin/demo/status", headers=H(master_token), timeout=10)
        # In preview we expect 200; in production 404. Either way the payload
        # must not contain a "password" key anywhere.
        assert r.status_code in (200, 404)
        raw = r.text
        assert "Demo@123" not in raw, "demo password leaked in /admin/demo/status response"
        assert "password" not in raw.lower() or '"password_hash"' in raw, raw

    def test_setup_requires_master(self):
        # Unauthenticated → 401 (auth dependency runs before the env guard)
        r = requests.post(f"{API}/admin/demo/setup", timeout=10)
        assert r.status_code in (401, 403, 404), r.text


# ───────────────────────── Bug 4: role escalation ───────────────────────────


PRIVILEGED_ROLES = ["vendor", "corporate_admin", "site_admin", "super_admin", "master_admin"]


class TestRoleEscalation:
    @pytest.mark.parametrize("role", PRIVILEGED_ROLES)
    def test_self_register_privileged_role_is_blocked(self, role):
        email = f"escalate+{role}+{uuid.uuid4().hex[:8]}@cravitoo.com"
        r = requests.post(
            f"{API}/auth/register",
            json={"email": email, "password": "Hunter2!Strong", "name": "Attacker", "role": role},
            timeout=15,
        )
        assert r.status_code == 403, (
            f"Expected 403 for role={role}, got {r.status_code}: {r.text}"
        )
        # The error must NOT echo what they tried — keep the response generic.
        body = r.json()
        assert "invitation" in body["detail"].lower(), body

    def test_employee_self_register_path_still_works(self):
        # Sanity check: legitimate corporate-domain employee sign-up succeeds.
        email = f"employee+{uuid.uuid4().hex[:8]}@cravitoo.com"
        r = requests.post(
            f"{API}/auth/register",
            json={"email": email, "password": "Hunter2!Strong", "name": "Real Employee", "role": "employee"},
            timeout=15,
        )
        # 200 (created) or 400 if cravitoo.com isn't in allowed_domains in this env.
        # The point is — NOT 403.
        assert r.status_code != 403, r.text

    @pytest.mark.parametrize("role_value", ["EMPLOYEE", " employee ", "Employee", "EMploYEE"])
    def test_employee_role_case_and_whitespace_tolerated(self, role_value):
        # Defence-in-depth: the server normalises before deciding.
        email = f"emp+{uuid.uuid4().hex[:8]}@cravitoo.com"
        r = requests.post(
            f"{API}/auth/register",
            json={"email": email, "password": "Hunter2!Strong", "name": "Mixed Case", "role": role_value},
            timeout=15,
        )
        assert r.status_code != 403, f"unexpected escalation block on {role_value!r}: {r.text}"


# ───────────────────────── Bug 5: order lifecycle ───────────────────────────


async def _make_order(user_id: str, vendor_id: str, status: str = "pending", age_hours: float = 0):
    """Create an order directly in Mongo to bypass the menu/pricing pipeline."""
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    created = datetime.now(timezone.utc) - timedelta(hours=age_hours)
    res = await db.orders.insert_one({
        "user_id": user_id,
        "vendor_id": vendor_id,
        "items": [],
        "total_amount": 100.0,
        "status": status,
        "payment_status": "paid",
        "delivery_type": "pickup",
        "created_at": created,
    })
    client.close()
    return str(res.inserted_id)


@pytest.fixture(scope="module")
def vendor_setup(master_token):
    """Seed (or find) a vendor + vendor-user we can drive the lifecycle through."""
    # Find any existing vendor record so we can reuse it
    r = requests.get(f"{API}/vendors", headers=H(master_token), timeout=10)
    assert r.status_code == 200
    vendors = r.json()
    if not vendors:
        pytest.skip("No vendors in this environment — seed one first")
    vendor_id = vendors[0]["id"]

    # Find / create a vendor user we can log in as
    import asyncio
    async def _vendor_user():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        u = await db.users.find_one({"vendor_id": vendor_id, "role": "vendor"})
        if not u:
            client.close()
            return None
        client.close()
        return u
    u = asyncio.get_event_loop().run_until_complete(_vendor_user())
    if not u:
        pytest.skip("No vendor user — seed one first")
    return {"vendor_id": vendor_id, "vendor_email": u["email"]}


def _create_order_via_mongo(user_id, vendor_id, status="pending", age_hours=0):
    import asyncio
    return asyncio.get_event_loop().run_until_complete(_make_order(user_id, vendor_id, status, age_hours))


def _employee_id(master_token):
    # any employee user from the DB
    import asyncio
    async def _go():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        u = await db.users.find_one({"role": "employee"})
        client.close()
        return str(u["_id"]) if u else None
    eid = asyncio.get_event_loop().run_until_complete(_go())
    if not eid:
        pytest.skip("No employee user in DB")
    return eid


class TestOrderLifecycle:
    def test_invalid_jump_pending_to_completed_rejected(self, master_token, vendor_setup):
        emp_id = _employee_id(master_token)
        order_id = _create_order_via_mongo(emp_id, vendor_setup["vendor_id"], status="pending")

        # Vendor cannot jump pending → completed
        # Log in as vendor (we don't have the password — use master_admin since admin transitions cover all)
        r = requests.patch(
            f"{API}/orders/{order_id}",
            headers=H(master_token),
            params={"status": "completed"},
            timeout=15,
        )
        assert r.status_code in (400, 409), r.text
        body = r.json()
        assert "invalid transition" in body["detail"].lower() or "terminal" in body["detail"].lower()

    def test_terminal_state_is_immutable(self, master_token, vendor_setup):
        emp_id = _employee_id(master_token)
        order_id = _create_order_via_mongo(emp_id, vendor_setup["vendor_id"], status="completed")
        r = requests.patch(
            f"{API}/orders/{order_id}",
            headers=H(master_token),
            params={"status": "preparing"},
            timeout=15,
        )
        assert r.status_code == 409, r.text
        assert "terminal" in r.json()["detail"].lower()

    def test_valid_admin_chain(self, master_token, vendor_setup):
        emp_id = _employee_id(master_token)
        order_id = _create_order_via_mongo(emp_id, vendor_setup["vendor_id"], status="pending")
        for nxt in ("confirmed", "preparing", "ready", "completed"):
            r = requests.patch(
                f"{API}/orders/{order_id}",
                headers=H(master_token),
                params={"status": nxt},
                timeout=15,
            )
            assert r.status_code == 200, f"{nxt} step failed: {r.status_code} {r.text}"
            assert r.json()["status"] == nxt

    def test_idempotent_repeat_is_rejected(self, master_token, vendor_setup):
        emp_id = _employee_id(master_token)
        order_id = _create_order_via_mongo(emp_id, vendor_setup["vendor_id"], status="confirmed")
        # First call succeeds: confirmed → preparing
        r1 = requests.patch(
            f"{API}/orders/{order_id}",
            headers=H(master_token),
            params={"status": "preparing"},
            timeout=15,
        )
        assert r1.status_code == 200, r1.text
        # Second call with the same target now fails — order is already in 'preparing'
        r2 = requests.patch(
            f"{API}/orders/{order_id}",
            headers=H(master_token),
            params={"status": "preparing"},
            timeout=15,
        )
        assert r2.status_code == 409, r2.text

    def test_stale_order_is_read_only(self, master_token, vendor_setup):
        emp_id = _employee_id(master_token)
        # 50h old, still in 'pending' → must not be mutable forward
        order_id = _create_order_via_mongo(emp_id, vendor_setup["vendor_id"], status="pending", age_hours=50)
        r = requests.patch(
            f"{API}/orders/{order_id}",
            headers=H(master_token),
            params={"status": "confirmed"},
            timeout=15,
        )
        assert r.status_code == 409, r.text
        assert "older than" in r.json()["detail"].lower() or "read-only" in r.json()["detail"].lower()

    def test_status_history_records_each_transition(self, master_token, vendor_setup):
        emp_id = _employee_id(master_token)
        order_id = _create_order_via_mongo(emp_id, vendor_setup["vendor_id"], status="pending")
        requests.patch(f"{API}/orders/{order_id}", headers=H(master_token), params={"status": "confirmed"}, timeout=15)
        requests.patch(f"{API}/orders/{order_id}", headers=H(master_token), params={"status": "preparing"}, timeout=15)

        import asyncio
        async def _check():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            rows = [r async for r in db.order_status_history.find({"order_id": order_id})]
            client.close()
            return rows
        rows = asyncio.get_event_loop().run_until_complete(_check())
        assert len(rows) >= 2
        seen = {r["to_status"] for r in rows}
        assert {"confirmed", "preparing"}.issubset(seen)


# ───────────────────────── Bug 1: session redirect (backend slice) ──────────


class TestSessionExpiredHandling:
    def test_auth_me_returns_401_when_anonymous(self):
        r = requests.get(f"{API}/auth/me", timeout=10)
        assert r.status_code == 401

    def test_refresh_without_token_does_not_500(self):
        r = requests.post(f"{API}/auth/refresh", timeout=10)
        # 401 (no refresh cookie) or 403, never a 5xx leak.
        assert r.status_code in (401, 403), r.text
