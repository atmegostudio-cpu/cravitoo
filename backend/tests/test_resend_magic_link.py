"""
Backend tests for resend onboarding magic link flow (iter 46).

Covers:
- Master admin login (cookies)
- Create test vendor
- Resend onboarding: returns magic_url + email_delivered even if delivery fails
- Verify magic token (GET /api/auth/magic/{token}) -> 200
- Complete magic link (set password) -> 200, cookies set, role=vendor
- Re-verify same token -> 410 (single-use consumed)
- Email/password login works, forgot-password returns success
- Resend AFTER completion returns NEW valid magic_url that can be completed again
- Cleanup vendor + user + magic_links + email log
"""
import os
import re
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "http://localhost:8001"

ADMIN_EMAIL = "admin@cravitoo.com"
ADMIN_PASSWORD = "admin123"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "cravitoo_db")


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture
def test_vendor(admin_session, db):
    """Create a throwaway vendor and clean up afterwards."""
    slug = uuid.uuid4().hex[:6]
    email = f"TEST_vendor_resend_{slug}@example.com"
    payload = {
        "name": f"TEST_ResendVendor_{slug}",
        "description": "resend magic-link test vendor",
        "cuisine_type": "Indian",
        "email": email,
        "phone": "+919000000000",
        "contact_person": "Test Contact",
    }
    r = admin_session.post(f"{BASE_URL}/api/vendors", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"create vendor failed: {r.status_code} {r.text}"
    vendor = r.json()
    vendor_id = vendor.get("id") or vendor.get("_id") or vendor.get("vendor_id")
    assert vendor_id, f"no vendor id in response: {vendor}"

    yield {"id": vendor_id, "email": email, "name": payload["name"]}

    # Cleanup
    try:
        admin_session.delete(f"{BASE_URL}/api/vendors/{vendor_id}", timeout=30)
    except Exception:
        pass
    try:
        db.users.delete_many({"email": email})
        db.vendor_magic_links.delete_many({"email": email})
        db.vendor_email_log.delete_many({"email": email})
        db.vendors.delete_many({"id": vendor_id})
    except Exception:
        pass


TOKEN_RE = re.compile(r"/auth/magic/([A-Za-z0-9_\-]+)")


def _extract_token(magic_url: str) -> str:
    m = TOKEN_RE.search(magic_url or "")
    assert m, f"could not extract token from magic_url: {magic_url!r}"
    return m.group(1)


# ---------- Test 1: resend returns working link ----------
def test_resend_returns_working_magic_url(admin_session, test_vendor):
    r = admin_session.post(
        f"{BASE_URL}/api/admin/vendors/{test_vendor['id']}/resend-onboarding",
        json={"email": test_vendor["email"]},
        timeout=30,
    )
    assert r.status_code == 200, f"resend failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("success") is True
    assert "email_delivered" in data and isinstance(data["email_delivered"], bool)
    assert (data.get("delivered_to") or "").lower() == test_vendor["email"].lower()
    magic_url = data.get("magic_url")
    assert magic_url and "/auth/magic/" in magic_url, f"missing magic_url: {data}"

    token = _extract_token(magic_url)

    # verify token (non-consuming GET)
    v = requests.get(f"{BASE_URL}/api/auth/magic/{token}", timeout=30)
    assert v.status_code == 200, f"verify expected 200, got {v.status_code} {v.text}"
    vd = v.json()
    assert (vd.get("email") or "").lower() == test_vendor["email"].lower()
    assert vd.get("purpose") == "onboarding"
    assert "vendor_name" in vd


# ---------- Test 2: complete + login + forgot-password ----------
def test_complete_login_and_forgot_password(admin_session, test_vendor):
    r = admin_session.post(
        f"{BASE_URL}/api/admin/vendors/{test_vendor['id']}/resend-onboarding",
        json={"email": test_vendor["email"]},
        timeout=30,
    )
    assert r.status_code == 200
    token = _extract_token(r.json()["magic_url"])

    # complete
    c = requests.post(
        f"{BASE_URL}/api/auth/magic/{token}/complete",
        json={"password": "NewPass123"},
        timeout=30,
    )
    assert c.status_code == 200, f"complete failed: {c.status_code} {c.text}"
    cd = c.json()
    assert cd.get("success") is True
    assert cd.get("role") == "vendor"
    # cookies should be set
    assert any(
        ck.name in ("access_token", "session", "auth_token", "token")
        for ck in c.cookies
    ), f"no auth cookie set. cookies={list(c.cookies)}"

    # re-verify -> 410
    v2 = requests.get(f"{BASE_URL}/api/auth/magic/{token}", timeout=30)
    assert v2.status_code == 410, f"expected 410 after consume, got {v2.status_code} {v2.text}"

    # login with new password
    ls = requests.Session()
    lr = ls.post(f"{BASE_URL}/api/auth/login",
                 json={"email": test_vendor["email"], "password": "NewPass123"},
                 timeout=30)
    assert lr.status_code == 200, f"login failed: {lr.status_code} {lr.text}"
    ld = lr.json()
    role = ld.get("role") or (ld.get("user") or {}).get("role")
    assert role == "vendor", f"expected role vendor, got {role} in {ld}"

    # forgot-password
    fr = requests.post(f"{BASE_URL}/api/auth/forgot-password",
                       json={"email": test_vendor["email"]},
                       timeout=30)
    assert fr.status_code == 200, f"forgot-password failed: {fr.status_code} {fr.text}"
    assert fr.json().get("success") is True


# ---------- Test 3: resend AFTER completion produces a NEW valid link ----------
def test_resend_after_completion_yields_new_working_link(admin_session, test_vendor):
    vid = test_vendor["id"]

    # 1st resend
    r1 = admin_session.post(
        f"{BASE_URL}/api/admin/vendors/{vid}/resend-onboarding",
        json={"email": test_vendor["email"]},
        timeout=30,
    )
    assert r1.status_code == 200
    token1 = _extract_token(r1.json()["magic_url"])

    # complete
    c1 = requests.post(f"{BASE_URL}/api/auth/magic/{token1}/complete",
                       json={"password": "FirstPass123"}, timeout=30)
    assert c1.status_code == 200

    # 2nd resend (production scenario)
    r2 = admin_session.post(
        f"{BASE_URL}/api/admin/vendors/{vid}/resend-onboarding",
        json={"email": test_vendor["email"]},
        timeout=30,
    )
    assert r2.status_code == 200, f"2nd resend failed: {r2.status_code} {r2.text}"
    d2 = r2.json()
    assert d2.get("success") is True
    magic_url2 = d2.get("magic_url")
    assert magic_url2, f"no magic_url in 2nd resend: {d2}"
    token2 = _extract_token(magic_url2)
    assert token2 != token1, "second resend should mint a NEW token"

    # verify 2nd token
    v = requests.get(f"{BASE_URL}/api/auth/magic/{token2}", timeout=30)
    assert v.status_code == 200, f"2nd token verify failed: {v.status_code} {v.text}"

    # complete 2nd token -> confirms end-to-end still works after prior onboarding
    c2 = requests.post(f"{BASE_URL}/api/auth/magic/{token2}/complete",
                       json={"password": "SecondPass123"}, timeout=30)
    assert c2.status_code == 200, f"2nd complete failed: {c2.status_code} {c2.text}"
    assert c2.json().get("role") == "vendor"



# ---------- Test 4 (FIX 2a): magic_url uses PUBLIC_APP_URL (preview host) even through ingress ----------
def test_magic_url_uses_public_app_url_via_ingress(admin_session, test_vendor):
    preview_origin = "https://feedback-analytics-20.preview.emergentagent.com"
    # NOTE: intentionally do NOT pass Origin/Referer — we want to confirm
    # PUBLIC_APP_URL (backend/.env) is used, so the host is correct even when
    # the k8s ingress strips Origin.
    r = admin_session.post(
        f"{BASE_URL}/api/admin/vendors/{test_vendor['id']}/resend-onboarding",
        json={"email": test_vendor["email"]},
        timeout=30,
    )
    assert r.status_code == 200, f"resend failed: {r.status_code} {r.text}"
    data = r.json()
    magic_url = data.get("magic_url", "")
    token = data.get("token", "")
    assert token and isinstance(token, str) and len(token) > 10, (
        f"expected non-empty token in response, got: {data}"
    )
    assert "app.cravitoo.com" not in magic_url, (
        f"magic_url leaks hardcoded prod host: {magic_url}"
    )
    assert "emergentcf.cloud" not in magic_url, (
        f"magic_url leaks internal cluster host: {magic_url}"
    )
    assert magic_url.startswith(preview_origin), (
        f"expected magic_url to start with {preview_origin}, got {magic_url}"
    )
    assert magic_url.endswith(f"/auth/magic/{token}"), (
        f"magic_url path/token mismatch: url={magic_url} token={token}"
    )
