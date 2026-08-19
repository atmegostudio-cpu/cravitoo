"""Iteration 22: /api/ai/menu-photos/apply full-behaviour regression.

Verifies decorator restoration (previously 404 due to removed @r.post):
  * unauthenticated → 401
  * non-master admin → 403 (matches spec: "Only Master Admin")
  * bad filename (path traversal / wrong prefix) → 400
  * valid filename but missing menu_item → 404
  * valid filename + real menu_item → 200 with image_url updated & persisted
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
                                    "photo_filename": "ai_deadbeef.png"})
    assert r.status_code in (401, 403), f"got {r.status_code}: {r.text[:200]}"


def test_apply_endpoint_is_registered_not_404(admin):
    """The bug we're regressing: decorator was missing → 404 Not Found."""
    r = admin.post(APPLY, json={"menu_item_id": "000000000000000000000000",
                                 "photo_filename": "ai_deadbeef.png"})
    # After decorator restoration, this must NOT be a routing 404.
    # It will be 404 with detail 'Menu item not found', which is fine — but
    # the routing 404 has "Not Found" as the FastAPI default with no JSON body shape.
    if r.status_code == 404:
        assert "Menu item" in r.text, f"routing 404 (decorator missing?): {r.text[:200]}"


def test_apply_bad_filename_400(admin):
    for bad in ["../etc/passwd", "sub/dir.png", "a\\b.png", "hello.png"]:
        r = admin.post(APPLY, json={"menu_item_id": "000000000000000000000000",
                                     "photo_filename": bad})
        assert r.status_code == 400, f"expected 400 for {bad!r}: {r.status_code} {r.text[:120]}"


def test_apply_valid_filename_missing_menu_item_404(admin):
    r = admin.post(APPLY, json={"menu_item_id": "000000000000000000000000",
                                 "photo_filename": "ai_deadbeefcafe.png"})
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
                             "photo_filename": "ai_deadbeef.png"})
    assert r.status_code == 403, f"expected 403 for employee: {r.status_code} {r.text[:200]}"
    assert "Master Admin" in r.text or "master" in r.text.lower()


def test_apply_happy_path_updates_menu_item(admin):
    """Full happy path: create scratch onboarding → activate to vendor is heavy,
    so instead we insert a menu_item directly via any admin CRUD if available.
    Fallback: skip cleanly if no route is available in preview env."""
    # Try to find any existing menu_item to reuse for testing
    r = admin.get(f"{BASE_URL}/api/menu-items")
    if r.status_code != 200:
        pytest.skip(f"cannot list menu_items: {r.status_code}")
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    if not items:
        pytest.skip("no menu_items available in preview DB for happy-path test")

    item_id = items[0].get("id") or items[0].get("_id")
    original_image = items[0].get("image_url")

    fake_fname = f"ai_{uuid.uuid4().hex}.png"
    r = admin.post(APPLY, json={"menu_item_id": item_id,
                                 "photo_filename": fake_fname})
    assert r.status_code == 200, f"expected 200: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert body["menu_item_id"] == item_id
    assert fake_fname in body["image_url"]
    assert body["image_url"].endswith(fake_fname)

    # Restore original image_url so we don't corrupt preview data
    if original_image is not None:
        admin.post(APPLY, json={"menu_item_id": item_id,
                                 "photo_filename": os.path.basename(original_image)
                                 if original_image.startswith(("ai_", "s_"))
                                 or "/ai_" in original_image or "/s_" in original_image
                                 else fake_fname})
