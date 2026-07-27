"""Backend contract tests for long-lived sessions + admin deactivate/reactivate.

Covers iteration-14 changes:
 - 365-day refresh_token lifetime (login + OTP flows)
 - /auth/refresh returns new access_token; rejects expired/invalid; rejects is_active=false
 - /admin/users/{id}/deactivate + /reactivate (role checks, self-guard, master-admin guard)
 - audit_log rows on deactivate/reactivate
 - Backwards-compat: users w/o is_active field still active
"""
import os
import time
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import jwt
import bcrypt
import pytest
import requests
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://corporate-feast.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@cravitoo.com"
ADMIN_PASSWORD = "admin123"

# Load JWT/Mongo config from /app/backend/.env
def _load_env():
    env = {}
    try:
        with open("/app/backend/.env") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return env

_ENV = _load_env()
JWT_SECRET = _ENV.get("JWT_SECRET", os.environ.get("JWT_SECRET", ""))
JWT_ALG = _ENV.get("JWT_ALGORITHM", "HS256")
MONGO_URL = _ENV.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = _ENV.get("DB_NAME", "cravitoo_db")


# ─── Shared fixtures ─────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def admin_tokens():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data and "refresh_token" in data
    return data


@pytest.fixture(scope="session")
def admin_id(admin_tokens):
    return admin_tokens["id"]


@pytest.fixture(scope="session")
def admin_headers(admin_tokens):
    return {"Authorization": f"Bearer {admin_tokens['access_token']}"}


@pytest.fixture(scope="session")
def scratch_employee():
    """Insert a throwaway employee user directly into Mongo, yield the id/email/password_hash,
    then delete on teardown (also cleans any audit_log rows we produced)."""
    email = f"test_session_{uuid.uuid4().hex[:8]}@cravitootest.com"
    password = "Passw0rd!123"
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    doc = {
        "email": email,
        "name": "Scratch Session Employee",
        "role": "employee",
        "password_hash": password_hash,
        "phone": None,
        "company_id": None,
        "vendor_id": None,
        "email_verified": True,
        "created_at": datetime.now(timezone.utc),
        "created_via": "test_session_persistence",
    }

    async def _insert():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        res = await db.users.insert_one(doc)
        client.close()
        return str(res.inserted_id)

    user_id = asyncio.get_event_loop().run_until_complete(_insert())

    yield {"id": user_id, "email": email, "password": password}

    async def _cleanup():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.users.delete_one({"_id": ObjectId(user_id)})
        await db.audit_log.delete_many({"entity_type": "user", "entity_id": user_id})
        await db.otp_codes.delete_many({"identifier": email})
        client.close()

    asyncio.get_event_loop().run_until_complete(_cleanup())


def _decode(token):
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])


# ─── 1. Token lifetimes on login ─────────────────────────────────────────────

class TestLoginTokenLifetimes:
    def test_login_returns_access_and_refresh(self, admin_tokens):
        assert admin_tokens.get("access_token")
        assert admin_tokens.get("refresh_token")
        assert admin_tokens["email"] == ADMIN_EMAIL
        assert admin_tokens["role"] == "master_admin"

    def test_access_token_is_15_minutes(self, admin_tokens):
        payload = _decode(admin_tokens["access_token"])
        assert payload["type"] == "access"
        delta = payload["exp"] - int(time.time())
        # 15 min = 900s, allow ±60s window
        assert 840 <= delta <= 960, f"access_token exp delta was {delta}s"

    def test_refresh_token_is_365_days(self, admin_tokens):
        payload = _decode(admin_tokens["refresh_token"])
        assert payload["type"] == "refresh"
        delta = payload["exp"] - int(time.time())
        expected = 365 * 86400
        # allow ±1 day drift
        assert abs(delta - expected) < 86400, f"refresh_token exp delta was {delta}s (expected ~{expected}s)"


# ─── 2. /auth/refresh happy + sad paths ──────────────────────────────────────

class TestAuthRefresh:
    def test_refresh_returns_new_access_and_me_works(self, admin_tokens):
        r = requests.post(
            f"{API}/auth/refresh",
            headers={"Authorization": f"Bearer {admin_tokens['refresh_token']}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        new_access = r.json().get("access_token")
        assert new_access
        # Note: within the same second, JWT can be byte-identical (exp resolution is seconds).
        # The key contract is: new token is valid & callable.

        me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {new_access}"}, timeout=15)
        assert me.status_code == 200
        assert me.json()["email"] == ADMIN_EMAIL

    def test_refresh_with_invalid_token_401(self):
        r = requests.post(f"{API}/auth/refresh", headers={"Authorization": "Bearer not.a.jwt"}, timeout=15)
        assert r.status_code == 401
        assert "invalid" in r.json().get("detail", "").lower()

    def test_refresh_with_expired_token_401(self):
        # Craft an already-expired refresh token
        expired = jwt.encode(
            {"sub": "507f1f77bcf86cd799439011", "type": "refresh",
             "exp": datetime.now(timezone.utc) - timedelta(minutes=5)},
            JWT_SECRET, algorithm=JWT_ALG,
        )
        r = requests.post(f"{API}/auth/refresh", headers={"Authorization": f"Bearer {expired}"}, timeout=15)
        assert r.status_code == 401
        assert "expired" in r.json().get("detail", "").lower()

    def test_refresh_with_access_token_type_rejected(self, admin_tokens):
        r = requests.post(
            f"{API}/auth/refresh",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
            timeout=15,
        )
        assert r.status_code == 401
        assert "type" in r.json().get("detail", "").lower() or "invalid" in r.json().get("detail", "").lower()


# ─── 3. Deactivate / Reactivate flow ─────────────────────────────────────────

class TestDeactivateReactivate:
    def _login_scratch(self, scratch):
        r = requests.post(f"{API}/auth/login",
                          json={"email": scratch["email"], "password": scratch["password"]},
                          timeout=15)
        assert r.status_code == 200, r.text
        return r.json()

    def test_scratch_user_can_login_before_deactivate(self, scratch_employee):
        toks = self._login_scratch(scratch_employee)
        assert toks["access_token"]
        # refresh_token also 365 days for employees
        payload = _decode(toks["refresh_token"])
        delta = payload["exp"] - int(time.time())
        assert abs(delta - 365*86400) < 86400

    def test_non_admin_cannot_deactivate(self, scratch_employee, admin_id):
        toks = self._login_scratch(scratch_employee)
        r = requests.post(
            f"{API}/admin/users/{admin_id}/deactivate",
            headers={"Authorization": f"Bearer {toks['access_token']}"},
            timeout=15,
        )
        assert r.status_code == 403

    def test_cannot_self_deactivate(self, admin_headers, admin_id):
        r = requests.post(f"{API}/admin/users/{admin_id}/deactivate", headers=admin_headers, timeout=15)
        assert r.status_code == 400
        assert "own account" in r.json().get("detail", "").lower()

    def test_cannot_deactivate_master_admin(self, admin_headers, scratch_employee, admin_id):
        # Try to deactivate the master admin (self is caught first, so create a second master admin?
        # We only have one — the self-guard fires. So this test uses a scratch master_admin via direct insert)
        # Insert a second master admin, attempt deactivate, expect 400 "master admin", then cleanup.
        async def _make_and_cleanup():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            doc = {
                "email": f"test_ma_{uuid.uuid4().hex[:6]}@cravitootest.com",
                "name": "Scratch Master",
                "role": "master_admin",
                "password_hash": bcrypt.hashpw(b"x", bcrypt.gensalt()).decode(),
                "created_at": datetime.now(timezone.utc),
            }
            res = await db.users.insert_one(doc)
            client.close()
            return str(res.inserted_id)

        async def _delete(uid):
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            await db.users.delete_one({"_id": ObjectId(uid)})
            await db.audit_log.delete_many({"entity_type": "user", "entity_id": uid})
            client.close()

        loop = asyncio.get_event_loop()
        second_master_id = loop.run_until_complete(_make_and_cleanup())
        try:
            r = requests.post(f"{API}/admin/users/{second_master_id}/deactivate",
                              headers=admin_headers, timeout=15)
            assert r.status_code == 400, r.text
            assert "master admin" in r.json().get("detail", "").lower()
        finally:
            loop.run_until_complete(_delete(second_master_id))

    def test_deactivate_kills_session_and_reactivate_restores(self, admin_headers, scratch_employee):
        # 1. Fresh login as scratch employee — capture BOTH tokens
        toks_before = self._login_scratch(scratch_employee)
        access_before = toks_before["access_token"]
        refresh_before = toks_before["refresh_token"]

        # Sanity: /auth/me works
        me1 = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {access_before}"}, timeout=15)
        assert me1.status_code == 200

        # 2. Admin deactivates
        d = requests.post(f"{API}/admin/users/{scratch_employee['id']}/deactivate",
                          headers=admin_headers, timeout=15)
        assert d.status_code == 200, d.text
        body = d.json()
        assert body["ok"] is True
        assert body["is_active"] is False

        # 3. /auth/me now 403 with "Account deactivated"
        me2 = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {access_before}"}, timeout=15)
        assert me2.status_code == 403
        assert me2.json().get("detail") == "Account deactivated"

        # 4. /auth/refresh with the previously-issued refresh_token also 403
        rf = requests.post(f"{API}/auth/refresh",
                           headers={"Authorization": f"Bearer {refresh_before}"}, timeout=15)
        assert rf.status_code == 403
        assert rf.json().get("detail") == "Account deactivated"

        # 5. Fresh login is also blocked (invalid_credentials or similar; not 200)
        # NOTE: contract doesn't specify login-time check; we don't assert 401 here specifically,
        # only that no valid token is issued.
        rl = requests.post(f"{API}/auth/login",
                           json={"email": scratch_employee["email"], "password": scratch_employee["password"]},
                           timeout=15)
        # Deactivated users may either be rejected outright or issued a token that immediately 403s.
        # The critical guarantee is /auth/me + /auth/refresh both 403 — which we just verified.
        if rl.status_code == 200:
            probe = requests.get(f"{API}/auth/me",
                                 headers={"Authorization": f"Bearer {rl.json()['access_token']}"}, timeout=15)
            assert probe.status_code == 403

        # 6. Reactivate
        ra = requests.post(f"{API}/admin/users/{scratch_employee['id']}/reactivate",
                           headers=admin_headers, timeout=15)
        assert ra.status_code == 200, ra.text
        assert ra.json()["is_active"] is True

        # 7. Fresh login now works
        toks_after = self._login_scratch(scratch_employee)
        me3 = requests.get(f"{API}/auth/me",
                           headers={"Authorization": f"Bearer {toks_after['access_token']}"}, timeout=15)
        assert me3.status_code == 200

        # 8. Previously-issued refresh_token (from before deactivate) also works again
        rf2 = requests.post(f"{API}/auth/refresh",
                            headers={"Authorization": f"Bearer {refresh_before}"}, timeout=15)
        assert rf2.status_code == 200, rf2.text
        assert rf2.json().get("access_token")


# ─── 4. Audit-log rows written ───────────────────────────────────────────────

class TestAuditLog:
    def test_audit_rows_on_deactivate_and_reactivate(self, admin_headers, scratch_employee):
        # trigger both
        d = requests.post(f"{API}/admin/users/{scratch_employee['id']}/deactivate",
                          headers=admin_headers, timeout=15)
        assert d.status_code == 200
        ra = requests.post(f"{API}/admin/users/{scratch_employee['id']}/reactivate",
                           headers=admin_headers, timeout=15)
        assert ra.status_code == 200

        async def _fetch():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            rows = await db.audit_log.find({"entity_type": "user", "entity_id": scratch_employee["id"]}).to_list(100)
            client.close()
            return rows

        rows = asyncio.get_event_loop().run_until_complete(_fetch())
        actions = {r.get("action") for r in rows}
        assert "deactivated" in actions
        assert "reactivated" in actions


# ─── 5. OTP flow issues 365-day refresh ──────────────────────────────────────

class TestOtpFlow:
    def test_otp_verify_returns_365_day_refresh(self, scratch_employee):
        """Inject a known OTP directly into db.otp_codes then hit /auth/otp/verify."""
        from email_service import hash_otp
        code = "246810"
        now = datetime.now(timezone.utc)
        record = {
            "identifier": scratch_employee["email"],
            "channel": "email",
            "purpose": "Login",
            "code_hash": hash_otp(code),
            "attempts": 0,
            "used": False,
            "superseded": False,
            "created_at": now,
            "expires_at": now + timedelta(minutes=10),
        }

        async def _insert():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            r = await db.otp_codes.insert_one(record)
            client.close()
            return r.inserted_id

        asyncio.get_event_loop().run_until_complete(_insert())

        r = requests.post(f"{API}/auth/otp/verify",
                          json={"email": scratch_employee["email"], "code": code}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("access_token") and body.get("refresh_token")
        payload = _decode(body["refresh_token"])
        assert payload["type"] == "refresh"
        delta = payload["exp"] - int(time.time())
        assert abs(delta - 365*86400) < 86400

    def test_otp_request_endpoint_reachable(self):
        # We can't fully exercise real email delivery here, but the endpoint must
        # respond (either 200 anti-enumeration, 400 corp-only, or 502 delivery fail).
        r = requests.post(f"{API}/auth/otp/request",
                          json={"email": "admin@cravitoo.com", "channel": "email"}, timeout=15)
        assert r.status_code in (200, 400, 429, 502), r.text


# ─── 6. Backwards compat: users without is_active field are active ───────────

class TestBackwardsCompat:
    def test_admin_has_no_is_active_field_yet_still_active(self, admin_tokens):
        """The seeded master admin has no is_active field. /auth/me must still succeed."""
        async def _check():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            u = await db.users.find_one({"email": ADMIN_EMAIL})
            client.close()
            return u

        u = asyncio.get_event_loop().run_until_complete(_check())
        # Either field is missing OR explicitly True — never False
        assert u is not None
        assert u.get("is_active") is not False

        r = requests.get(f"{API}/auth/me",
                         headers={"Authorization": f"Bearer {admin_tokens['access_token']}"}, timeout=15)
        assert r.status_code == 200

        # And refresh works too
        rf = requests.post(f"{API}/auth/refresh",
                           headers={"Authorization": f"Bearer {admin_tokens['refresh_token']}"}, timeout=15)
        assert rf.status_code == 200
