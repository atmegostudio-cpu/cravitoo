"""Backend tests for GET /api/vendors site-scoped filtering."""
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://feedback-analytics-20.preview.emergentagent.com").rstrip("/")

EMP_EMAIL = "qa_employee@gatetest.com"
EMP_PASS = "employee123"
ADMIN_EMAIL = "admin@cravitoo.com"
ADMIN_PASS = "admin123"

EXPECTED_EMP_VENDOR_IDS = {
    "6a855f5aba5f84a7d670e101",
    "6a856041b6a1ab0f0c187578",
    "6a8600534f709c7504387167",
    "6a8600e6b7fb9be04fb5bb6d",
    "6a8709bdefe50d76f60dac10",
    "6a871e4a7e320302089b784e",
    "6a884558bf79112300218819",
}
HIDDEN_INACTIVE_MAP = "6a89470ca3d33f4be9f1272c"
HIDDEN_SUSPENDED = "6a8946e88de95440e23f21cb"
OTHER_SITE_VENDOR = "6a85521d239a34f6433984ea"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in {r.json()}"
    return tok


def test_no_auth_returns_401():
    r = requests.get(f"{BASE_URL}/api/vendors", timeout=30)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


def test_employee_sees_only_mapped_active_vendors():
    tok = _login(EMP_EMAIL, EMP_PASS)
    r = requests.get(f"{BASE_URL}/api/vendors", headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert r.status_code == 200, r.text
    vendors = r.json()
    ids = {v["id"] for v in vendors}
    assert len(vendors) == 7, f"expected 7 vendors, got {len(vendors)}: {ids}"
    assert ids == EXPECTED_EMP_VENDOR_IDS, f"mismatch: got {ids}"
    assert HIDDEN_INACTIVE_MAP not in ids
    assert HIDDEN_SUSPENDED not in ids
    assert OTHER_SITE_VENDOR not in ids


def test_admin_sees_all_active_vendors():
    tok = _login(ADMIN_EMAIL, ADMIN_PASS)
    r = requests.get(f"{BASE_URL}/api/vendors", headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert r.status_code == 200, r.text
    vendors = r.json()
    ids = {v["id"] for v in vendors}
    assert len(vendors) == 9, f"expected 9 admin vendors, got {len(vendors)}"
    # admin should still see suspended? no — filter is status==active, so suspended excluded
    assert HIDDEN_SUSPENDED not in ids
    # inactive-mapping vendor is still an active vendor globally — admin should see it
    assert HIDDEN_INACTIVE_MAP in ids
    assert OTHER_SITE_VENDOR in ids
