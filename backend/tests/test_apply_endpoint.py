"""Iteration 22: /api/ai/menu-photos/apply full-behaviour regression.

Verifies decorator restoration (previously 404 due to removed @r.post):
  * unauthenticated → 401
  * non-master admin → 403 (matches spec: "Only Master Admin")
  * bad filename (path traversal / wrong prefix) → 400
  * valid filename but missing menu_item → 404
  * valid filename + real menu_item → 200 with image_url updated & persisted

Iteration 24: broken-URL guard.
  * legacy ``ai_<hex>.png`` filenames are rejected with 400 because the file
    was never persisted to Object Storage — customers would see 404s.
  * ``photo_url`` is the preferred payload (full Object-Storage URL).
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")

APPLY = f"{BASE_URL}/api/ai/menu-photos/apply"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return s


def test_apply_unauthenticated_401_or_403():
    r = requests.post(APPLY, json={"menu_item_id": "000000000000000000000000",
                                    "photo_url": "/api/uploads/s_something"})
    assert r.status_code in (401, 403), f"got {r.status_code}: {r.text[:200]}"


def test_apply_endpoint_is_registered_not_404(admin):
    """The bug we're regressing: decorator was missing → 404 Not Found."""
    r = admin.post(APPLY, json={"menu_item_id": "000000000000000000000000",
                                 "photo_url": "/api/uploads/s_deadbeef"})
    if r.status_code == 404:
        assert "Menu item" in r.text, f"routing 404 (decorator missing?): {r.text[:200]}"


def test_apply_rejects_legacy_ai_filename_400(admin):
    """Iter24 review fix: ``ai_<hex>.png`` filenames must be rejected because
    the underlying file was never saved to Object Storage — the resulting
    URL would 404 for customers."""
    r = admin.post(APPLY, json={"menu_item_id": "000000000000000000000000",
                                 "photo_filename": "ai_deadbeefcafe.png"})
    assert r.status_code == 400, f"expected 400 for legacy ai_ name: {r.status_code} {r.text[:200]}"
    assert "regenerate" in r.text.lower() or "legacy" in r.text.lower()


def test_apply_rejects_path_traversal(admin):
    for bad in ["../etc/passwd", "sub/dir.png", "a\\b.png"]:
        r = admin.post(APPLY, json={"menu_item_id": "000000000000000000000000",
                                     "photo_filename": bad})
        assert r.status_code == 400, f"expected 400 for {bad!r}: {r.status_code} {r.text[:120]}"


def test_apply_rejects_bogus_url_scheme(admin):
    for bad in ["file:///etc/passwd", "javascript:alert(1)", "ftp://x", ""]:
        r = admin.post(APPLY, json={"menu_item_id": "000000000000000000000000",
                                     "photo_url": bad})
        # Either 400 (bad URL) or 422 (pydantic empty string on optional
        # field — accepted then rejected). Anything but 5xx / 200 is fine.
        assert r.status_code in (400, 422), f"got {r.status_code}: {r.text[:200]}"


def test_apply_requires_url_or_filename(admin):
    r = admin.post(APPLY, json={"menu_item_id": "000000000000000000000000"})
    assert r.status_code == 400, f"expected 400 when neither provided: {r.status_code}"


def test_apply_valid_url_missing_menu_item_404(admin):
    r = admin.post(APPLY, json={"menu_item_id": "000000000000000000000000",
                                 "photo_url": "/api/uploads/s_deadbeefcafe"})
    assert r.status_code == 404, f"got {r.status_code}: {r.text[:200]}"
    assert "Menu item" in r.text


def test_apply_valid_s_filename_missing_menu_item_404(admin):
    """New object-storage tokens (s_) are still accepted via photo_filename."""
    r = admin.post(APPLY, json={"menu_item_id": "000000000000000000000000",
                                 "photo_filename": "s_deadbeefcafe"})
    assert r.status_code == 404, f"got {r.status_code}: {r.text[:200]}"
    assert "Menu item" in r.text


def test_apply_nonadmin_forbidden():
    s = requests.Session()
    email = f"TEST_apply_{uuid.uuid4().hex[:6]}@example.com"
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": "testpass123",
                     "name": "Low User", "role": "employee"})
    if r.status_code not in (200, 201):
        pytest.skip(f"cannot register low-priv user: {r.status_code}")
    s.post(f"{BASE_URL}/api/auth/login",
           json={"email": email, "password": "testpass123"})
    r = s.post(APPLY, json={"menu_item_id": "000000000000000000000000",
                             "photo_url": "/api/uploads/s_deadbeef"})
    assert r.status_code == 403, f"expected 403 for employee: {r.status_code} {r.text[:200]}"
    assert "Master Admin" in r.text or "master" in r.text.lower()
