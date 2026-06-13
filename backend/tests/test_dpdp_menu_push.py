"""
Feature backend tests:
- DPDP data export / erasure endpoints (GET/DELETE /api/me/data)
- Vendor menu lock-down (vendors read-only on /api/menu)
- Expo push notification endpoints
- /privacy and /terms public pages
- Regression across roles after models.py refactor
"""
import os
import time
import requests
import pytest
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "master_admin":   ("admin@cravitoo.com",        "admin123"),
    "site_admin":     ("siteadmin@techcorp.com",    "site123"),
    "vendor":         ("vendor@spicekitchen.com",   "vendor123"),
    "employee":       ("employee@techcorp.com",     "employee123"),
    "corporate_admin": ("demo@techcorp.com",        "demo123"),
}


def login(role):
    email, password = CREDS[role]
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"{role} login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token
    return {"Authorization": f"Bearer {token}"}, data


@pytest.fixture(scope="session")
def tokens():
    return {role: login(role)[0] for role in CREDS}


# ====== AUTH SMOKE for all 5 roles ======
@pytest.mark.parametrize("role", list(CREDS.keys()))
def test_auth_all_roles(role):
    headers, _ = login(role)
    me = requests.get(f"{API}/auth/me", headers=headers, timeout=15)
    assert me.status_code == 200, f"{role} /auth/me failed: {me.text}"
    body = me.json()
    assert body.get("email") == CREDS[role][0]


# ====== DPDP export ======
def test_me_data_export_employee(tokens):
    r = requests.get(f"{API}/me/data", headers=tokens["employee"], timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["export_format_version"] == "1.0"
    for k in [
        "profile", "orders", "reviews", "favorites", "loyalty",
        "subscriptions", "notifications", "preferences", "push_tokens", "_note",
    ]:
        assert k in data, f"missing key {k}"
    # No password hash in profile
    assert "password_hash" not in data["profile"]
    # All push tokens must be redacted
    for pt in data["push_tokens"]:
        assert pt.get("token") == "[REDACTED]"


def test_me_data_export_no_auth():
    r = requests.get(f"{API}/me/data", timeout=15)
    assert r.status_code in (401, 403)


# ====== DPDP deletion edge cases ======
def test_me_data_delete_no_confirm(tokens):
    r = requests.delete(f"{API}/me/data", headers=tokens["employee"], timeout=15)
    assert r.status_code == 422, r.text


def test_me_data_delete_wrong_case(tokens):
    r = requests.delete(f"{API}/me/data?confirm=delete", headers=tokens["employee"], timeout=15)
    assert r.status_code == 400


def test_me_data_delete_master_admin_forbidden(tokens):
    r = requests.delete(f"{API}/me/data?confirm=DELETE", headers=tokens["master_admin"], timeout=15)
    assert r.status_code == 403


# ====== DPDP full deletion happy path (creates throwaway user) ======
def _register(email, password, role="employee"):
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": "TEST_DPDP", "role": role},
        timeout=20,
    )
    return r


def test_me_data_delete_happy_path():
    email = f"test_dpdp_{int(time.time()*1000)}@example.com"
    pw = "TestDpdp123!"
    reg = _register(email, pw)
    assert reg.status_code in (200, 201), f"register failed: {reg.status_code} {reg.text}"
    login_resp = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert login_resp.status_code == 200
    token = login_resp.json().get("token") or login_resp.json().get("access_token")
    h = {"Authorization": f"Bearer {token}"}
    # Confirm /auth/me works first
    me = requests.get(f"{API}/auth/me", headers=h, timeout=15)
    assert me.status_code == 200
    # Delete
    d = requests.delete(f"{API}/me/data?confirm=DELETE", headers=h, timeout=20)
    assert d.status_code == 200, d.text
    body = d.json()
    assert body.get("ok") is True
    assert "anonymisation_id" in body
    # After deletion, /auth/me should reject
    me2 = requests.get(f"{API}/auth/me", headers=h, timeout=15)
    assert me2.status_code in (401, 404), f"expected 401/404 got {me2.status_code}"


# ====== Vendor menu lock-down ======
def test_post_menu_vendor_forbidden(tokens):
    payload = {
        "name": "TEST__item", "description": "x", "category": "Main",
        "price": 99.0, "is_vegetarian": True, "vendor_id": "doesntmatter",
    }
    r = requests.post(f"{API}/menu", headers=tokens["vendor"], json=payload, timeout=15)
    assert r.status_code == 403


def test_patch_menu_vendor_forbidden(tokens):
    r = requests.patch(f"{API}/menu/000000000000000000000000",
                       headers=tokens["vendor"], json={"price": 1}, timeout=15)
    assert r.status_code == 403


def test_delete_menu_vendor_forbidden(tokens):
    r = requests.delete(f"{API}/menu/000000000000000000000000",
                        headers=tokens["vendor"], timeout=15)
    assert r.status_code == 403


def test_upload_menu_image_vendor_forbidden(tokens):
    files = {"file": ("x.png", b"\x89PNG\r\n\x1a\n", "image/png")}
    r = requests.post(f"{API}/upload/menu-image", headers=tokens["vendor"], files=files, timeout=15)
    assert r.status_code == 403


def test_menu_availability_vendor_allowed(tokens):
    # vendor toggles availability of one of their own menu items
    me = requests.get(f"{API}/menu/vendor/all", headers=tokens["vendor"], timeout=15)
    assert me.status_code == 200, me.text
    items = me.json()
    assert items, "Vendor should have at least one menu item seeded"
    item_id = items[0]["id"]
    r = requests.patch(
        f"{API}/menu/{item_id}/availability?is_available=true",
        headers=tokens["vendor"], timeout=15,
    )
    assert r.status_code == 200, r.text


def test_post_menu_master_admin_success(tokens):
    # Master admin needs a real vendor_id. Discover one.
    v = requests.get(f"{API}/vendors", headers=tokens["master_admin"], timeout=15)
    assert v.status_code == 200, v.text
    vendors = v.json()
    assert vendors
    vendor_id = vendors[0]["id"]
    payload = {
        "name": f"TEST__admin_item_{int(time.time())}",
        "description": "Created by master admin in tests",
        "category": "Test",
        "price": 49.0,
        "is_vegetarian": True,
        "vendor_id": vendor_id,
    }
    r = requests.post(f"{API}/menu", headers=tokens["master_admin"], json=payload, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "id" in body and body["vendor_id"] == vendor_id
    # Cleanup
    requests.delete(f"{API}/menu/{body['id']}", headers=tokens["master_admin"], timeout=15)


# ====== Push notifications ======
def test_push_token_register_valid(tokens):
    payload = {"token": "ExponentPushToken[-test-xxxxxxxxxxxxx]", "platform": "ios", "variant": "customer"}
    r = requests.post(f"{API}/notifications/push-token", headers=tokens["employee"], json=payload, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True


def test_push_token_register_invalid(tokens):
    payload = {"token": "not-an-expo-token", "platform": "ios"}
    r = requests.post(f"{API}/notifications/push-token", headers=tokens["employee"], json=payload, timeout=15)
    assert r.status_code == 400


def test_push_token_register_no_auth():
    r = requests.post(f"{API}/notifications/push-token",
                      json={"token": "ExponentPushToken[abc]"}, timeout=15)
    assert r.status_code in (401, 403)


def test_test_push(tokens):
    r = requests.post(f"{API}/notifications/test-push", headers=tokens["employee"], timeout=30)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True


def test_push_token_delete(tokens):
    tok = "ExponentPushToken[-test-xxxxxxxxxxxxx]"
    r = requests.delete(
        f"{API}/notifications/push-token?token={tok}",
        headers=tokens["employee"], timeout=15,
    )
    assert r.status_code == 200, r.text


# ====== Public legal pages (frontend SPA) ======
def test_privacy_page_loads():
    r = requests.get(f"{BASE_URL}/privacy", timeout=15)
    assert r.status_code == 200
    # SPA serves index.html; we don't strictly require server-side title
    assert "html" in r.headers.get("content-type", "").lower() or "<html" in r.text.lower()


def test_terms_page_loads():
    r = requests.get(f"{BASE_URL}/terms", timeout=15)
    assert r.status_code == 200
    assert "html" in r.headers.get("content-type", "").lower() or "<html" in r.text.lower()


# ====== Regression: random endpoints across roles ======
def test_regression_sites_master_admin(tokens):
    r = requests.get(f"{API}/sites", headers=tokens["master_admin"], timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_regression_vendors_list(tokens):
    r = requests.get(f"{API}/vendors", headers=tokens["employee"], timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_regression_orders_employee(tokens):
    r = requests.get(f"{API}/orders", headers=tokens["employee"], timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_regression_favorites_employee(tokens):
    r = requests.get(f"{API}/favorites", headers=tokens["employee"], timeout=15)
    assert r.status_code == 200


def test_regression_my_site_employee(tokens):
    r = requests.get(f"{API}/employee/my-site", headers=tokens["employee"], timeout=15)
    assert r.status_code in (200, 204), r.text


def test_regression_master_dashboard(tokens):
    r = requests.get(f"{API}/reports/master-dashboard", headers=tokens["master_admin"], timeout=15)
    assert r.status_code == 200, r.text


def test_regression_city_leaderboard(tokens):
    r = requests.get(f"{API}/reports/city-leaderboard", headers=tokens["master_admin"], timeout=15)
    assert r.status_code == 200, r.text


def test_regression_onboarding_list(tokens):
    r = requests.get(f"{API}/onboarding/vendors", headers=tokens["master_admin"], timeout=15)
    assert r.status_code == 200, r.text
