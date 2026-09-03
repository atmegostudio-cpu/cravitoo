"""Tests for admin menu replace/clear/dedupe + propagation across apps.

Covers:
- Excel upload mode=replace (idempotent, no duplicates)
- Excel upload mode=append (upsert by name)
- Clear menu (DELETE /sites/{id}/menu)
- Auto-reflection across GET /menu/{vendor_id} and GET /sites/{id}/menu
- RBAC on both endpoints (employee -> 403)
"""
import io
import os
import pytest
import requests
from openpyxl import Workbook

def _load_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return None

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env() or "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL not set"
SITE_ID = "6a96d37822127a5e04873e36"
VENDOR_ID = "6a96d37822127a5e04873e3c"

ADMIN = ("admin@cravitoo.com", "admin123")
VENDOR = ("audit_vendor1@corpa.com", "Audit#1234")
EMPLOYEE = ("audit_emp_a@corpa.com", "Audit#1234")


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json()["token"]


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def _make_xlsx(rows):
    wb = Workbook()
    ws = wb.active
    ws.append(["name", "description", "category", "price", "is_vegetarian"])
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


@pytest.fixture(scope="module")
def admin_token():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def employee_token():
    try:
        return _login(*EMPLOYEE)
    except AssertionError:
        pytest.skip("Employee login not available")


ROWS_A = [
    ("TEST_ReplaceDish1", "d1", "Main", 100, True),
    ("TEST_ReplaceDish2", "d2", "Main", 120, True),
    ("TEST_ReplaceDish3", "d3", "Dessert", 60, True),
]

ROWS_B_UPDATE = [
    ("TEST_ReplaceDish1", "updated desc", "Main", 150, True),  # existing name
    ("TEST_AppendNew", "new item", "Snack", 40, True),         # new name
]


def _upload(token, rows, mode):
    files = {"file": ("menu.xlsx", _make_xlsx(rows),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    return requests.post(
        f"{BASE}/api/sites/{SITE_ID}/menu/upload-excel",
        params={"vendor_id": VENDOR_ID, "mode": mode},
        headers=_hdr(token),
        files=files,
        timeout=30,
    )


def _site_items(token):
    r = requests.get(f"{BASE}/api/sites/{SITE_ID}/menu", headers=_hdr(token), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def _vendor_items(token):
    r = requests.get(f"{BASE}/api/menu/{VENDOR_ID}", headers=_hdr(token), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def test_replace_upload_twice_no_duplicates(admin_token):
    # First replace
    r1 = _upload(admin_token, ROWS_A, "replace")
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert body1["mode"] == "replace"
    assert body1["inserted"] == 3
    site_items1 = [i for i in _site_items(admin_token) if i["vendor_id"] == VENDOR_ID]
    count1 = len(site_items1)
    assert count1 == 3

    # Second replace with the SAME file - count must stay same
    r2 = _upload(admin_token, ROWS_A, "replace")
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["inserted"] == 3
    assert body2["removed"] == 3
    site_items2 = [i for i in _site_items(admin_token) if i["vendor_id"] == VENDOR_ID]
    assert len(site_items2) == count1, "replace must not create duplicates"

    # Live reader for customer/vendor apps (note: /menu/{vendor_id} doesn't project site_id)
    vendor_items = _vendor_items(admin_token)
    row_names = [r[0] for r in ROWS_A]
    for name in row_names:
        count = sum(1 for i in vendor_items if i["name"] == name)
        assert count == 1, f"expected 1 {name} in vendor menu, got {count}"


def test_append_upserts_by_name(admin_token):
    # Ensure ROWS_A present via replace first
    _upload(admin_token, ROWS_A, "replace")
    before = [i for i in _site_items(admin_token) if i["vendor_id"] == VENDOR_ID]
    before_count = len(before)

    r = _upload(admin_token, ROWS_B_UPDATE, "append")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mode"] == "append"
    assert body["updated"] == 1  # TEST_ReplaceDish1 exists -> updated
    assert body["inserted"] == 1  # TEST_AppendNew -> inserted
    assert body["removed"] == 0

    after = [i for i in _site_items(admin_token) if i["vendor_id"] == VENDOR_ID]
    assert len(after) == before_count + 1

    # Updated price on existing dish
    updated = next(i for i in after if i["name"] == "TEST_ReplaceDish1")
    assert updated["price"] == 150
    assert updated["description"] == "updated desc"

    # Re-upload same append file - counts should NOT grow
    r2 = _upload(admin_token, ROWS_B_UPDATE, "append")
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["updated"] == 2
    assert body2["inserted"] == 0
    after2 = [i for i in _site_items(admin_token) if i["vendor_id"] == VENDOR_ID]
    assert len(after2) == len(after), "append with same names must not duplicate"


def test_clear_menu(admin_token):
    # Seed something first
    _upload(admin_token, ROWS_A, "replace")
    before = [i for i in _site_items(admin_token) if i["vendor_id"] == VENDOR_ID]
    assert len(before) > 0

    r = requests.delete(
        f"{BASE}/api/sites/{SITE_ID}/menu",
        params={"vendor_id": VENDOR_ID},
        headers=_hdr(admin_token),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["removed"] == len(before)

    after = [i for i in _site_items(admin_token) if i["vendor_id"] == VENDOR_ID]
    assert after == []

    # Live reader also reflects removal - none of the uploaded ROWS_A names remain
    vendor_items = _vendor_items(admin_token)
    remaining_names = {i["name"] for i in vendor_items}
    for name in [r[0] for r in ROWS_A]:
        assert name not in remaining_names


def test_rbac_employee_forbidden(employee_token):
    # Upload
    files = {"file": ("menu.xlsx", _make_xlsx(ROWS_A),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    r = requests.post(
        f"{BASE}/api/sites/{SITE_ID}/menu/upload-excel",
        params={"vendor_id": VENDOR_ID, "mode": "replace"},
        headers=_hdr(employee_token),
        files=files,
        timeout=20,
    )
    assert r.status_code == 403

    # Clear
    r2 = requests.delete(
        f"{BASE}/api/sites/{SITE_ID}/menu",
        params={"vendor_id": VENDOR_ID},
        headers=_hdr(employee_token),
        timeout=20,
    )
    assert r2.status_code == 403


def test_invalid_mode(admin_token):
    files = {"file": ("menu.xlsx", _make_xlsx(ROWS_A),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    r = requests.post(
        f"{BASE}/api/sites/{SITE_ID}/menu/upload-excel",
        params={"vendor_id": VENDOR_ID, "mode": "bogus"},
        headers=_hdr(admin_token),
        files=files,
        timeout=20,
    )
    assert r.status_code == 400


def test_in_file_duplicate_names_skipped(admin_token):
    dup_rows = [
        ("TEST_DupItem", "a", "Main", 10, True),
        ("TEST_DupItem", "b", "Main", 20, True),
        ("TEST_UniqueItem", "c", "Main", 30, True),
    ]
    r = _upload(admin_token, dup_rows, "replace")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inserted"] == 2
    assert any("duplicate" in e.lower() for e in body["errors"])

    # cleanup
    requests.delete(
        f"{BASE}/api/sites/{SITE_ID}/menu",
        params={"vendor_id": VENDOR_ID},
        headers=_hdr(admin_token),
        timeout=20,
    )
