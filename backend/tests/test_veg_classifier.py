"""Tests for the Veg / Non-Veg classifier module and the two
reclassify endpoints (onboarding draft menu + live menu_items).

Covers:
  - Unit-level classify_veg happy/sad paths.
  - Excel bulk upload auto-classify when is_vegetarian column is missing.
  - Excel bulk upload honours explicit is_vegetarian values.
  - POST /api/onboarding/vendors/{id}/menu/reclassify-veg (draft menus).
  - POST /api/admin/menu-items/reclassify-veg (live menu_items).
"""
from __future__ import annotations

import io
import os
import sys
import uuid
from pathlib import Path

import openpyxl
import pytest
import requests

# Make the backend package importable so we can unit-test the classifier
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from veg_classifier import classify_veg, reclassify_batch  # noqa: E402

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://corporate-feast.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")


# ---------------------------------------------------------------------------
# Unit tests for the classifier — do NOT hit the network.
# ---------------------------------------------------------------------------
class TestClassifyVegUnit:
    @pytest.mark.parametrize("name", [
        "Veg Sandwich", "Paneer Masala", "Aloo Paratha", "Chana Masala",
        "Masala Dosa", "Paneer Tikka Kebab", "Tomato Soup",
        "Fruit Grill Sandwich",
    ])
    def test_veg_defaults(self, name):
        assert classify_veg(name) is True, f"{name} should be veg"

    @pytest.mark.parametrize("name", [
        "Chicken Biryani", "Egg Bhurji", "Fish Curry", "Mutton Rogan Josh",
        "Prawn Koliwada", "Chicken 65",
        # Regression: "Non-Veg" must beat the accidental \bveg\b substring match.
        "Non-Veg Thali", "Non Veg Combo", "nonveg biryani", "NON-VEGETARIAN Special",
    ])
    def test_non_veg(self, name):
        assert classify_veg(name) is False, f"{name} should be non-veg"

    def test_word_boundary_peach_not_prawn(self):
        # "peach" must NOT trigger "prawn"; "orange" must NOT trigger any non-veg
        assert classify_veg("Peach Melba") is True
        assert classify_veg("Orange Juice") is True

    def test_default_unknown_is_veg(self):
        # No matching keywords — Indian corporate FSSAI default is veg
        assert classify_veg("Random Nonexistent Dish", "no keywords here") is True

    def test_reclassify_batch_counts_changes(self):
        items = [
            {"name": "Paneer Masala", "is_vegetarian": False},   # should flip
            {"name": "Chicken Biryani", "is_vegetarian": True},  # should flip
            {"name": "Aloo Paratha", "is_vegetarian": True},     # no change
        ]
        updated, changed = reclassify_batch(items)
        assert changed == 2
        assert updated[0]["is_vegetarian"] is True
        assert updated[1]["is_vegetarian"] is False
        assert updated[2]["is_vegetarian"] is True

    # ------------------------------------------------------------------
    # Safety regressions from the Feb 2026 code review — meat words MUST
    # beat vegetable ingredient words. "Chicken Corn Soup" was previously
    # returning True (veg) because `\bcorn\b` was a strong-veg override.
    # ------------------------------------------------------------------
    @pytest.mark.parametrize("name,expected", [
        # Ambiguous vegetables next to meat: meat MUST win.
        ("Chicken Corn Soup",             False),
        ("Chicken Mushroom Soup",         False),
        ("Chicken with Palak",            False),
        ("Palak Chicken Curry",           False),
        ("Mutton with Peas",              False),
        ("Chicken Corn and Mushroom Soup", False),
        ("Chicken Dal",                   False),
        # Truly veg dishes named after their vegetable stay veg.
        ("Sweet Corn Soup",               True),
        ("Mushroom Soup",                 True),
        ("Palak Paneer",                  True),
        ("Corn Chaat",                    True),
        # Paneer/aloo/dal override ambiguous meaty modifiers.
        ("Paneer Tikka",                  True),
        ("Paneer Tikka Kebab",            True),
        ("Aloo Tikki",                    True),
        ("Vegetable Fried Rice",          True),
    ])
    def test_meat_beats_ambiguous_vegetables(self, name, expected):
        assert classify_veg(name) is expected, f"{name} expected={expected}"

    def test_reclassify_batch_only_missing_preserves_manual(self):
        items = [
            {"name": "Chicken Biryani", "is_vegetarian": True},   # bad manual tag
            {"name": "Paneer Masala"},                             # no field → fill
        ]
        updated, changed = reclassify_batch(items, only_missing=True)
        # In only_missing mode the manually-tagged chicken row is preserved,
        # only the missing one is filled.
        assert changed == 1
        assert updated[0]["is_vegetarian"] is True     # preserved (still wrong)
        assert updated[1]["is_vegetarian"] is True     # filled correctly


# ---------------------------------------------------------------------------
# Backend integration — needs a live server. Auto-skips if login fails.
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=15)
    if r.status_code != 200:
        pytest.skip(f"master admin login failed: {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def site_id(admin_client):
    r = admin_client.get(f"{API}/sites", timeout=15)
    if r.status_code == 200 and r.json():
        return r.json()[0].get("id")

    # City
    r = admin_client.get(f"{API}/cities", timeout=15)
    cities = r.json() if r.status_code == 200 else []
    if cities:
        city_id = cities[0].get("id")
    else:
        r = admin_client.post(f"{API}/cities",
                              json={"name": f"TEST_City_{uuid.uuid4().hex[:6]}",
                                    "state": "Karnataka"}, timeout=15)
        assert r.status_code in (200, 201), r.text
        city_id = r.json().get("id")

    # Corporate client
    r = admin_client.get(f"{API}/master/corporate-clients", timeout=15)
    clients = r.json() if r.status_code == 200 else []
    if clients:
        client_id = clients[0].get("id")
    else:
        r = admin_client.post(f"{API}/master/corporate-clients",
                              json={"name": f"TEST_Corp_{uuid.uuid4().hex[:6]}",
                                    "city_id": city_id,
                                    "contact_email": f"corp_{uuid.uuid4().hex[:6]}@example.com"},
                              timeout=15)
        assert r.status_code in (200, 201), r.text
        client_id = r.json().get("id")

    payload = {"name": f"TEST_Site_{uuid.uuid4().hex[:6]}",
               "address": "123 Test Ln", "city": "Bengaluru",
               "city_id": city_id, "corporate_client_id": client_id,
               "contact_email": f"site_{uuid.uuid4().hex[:6]}@example.com",
               "contact_phone": "9000000000"}
    r = admin_client.post(f"{API}/sites", json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json().get("id")


@pytest.fixture
def onb_id(admin_client, site_id):
    payload = {
        "vendor_name": f"TEST_vendor_{uuid.uuid4().hex[:6]}",
        "company_name": "TEST Foods",
        "contact_person": "T Person",
        "mobile_number": "9999999999",
        "email": f"vendor_{uuid.uuid4().hex[:6]}@example.com",
        "business_address": "45 Test Rd",
        "cuisine_type": "Multi-cuisine",
        "site_id": site_id,
    }
    r = admin_client.post(f"{API}/onboarding/vendors", json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json().get("id")


def _build_xlsx(rows_with_headers):
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows_with_headers:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


# ---------- Excel upload ----------
class TestExcelAutoClassify:
    def test_missing_column_auto_classifies(self, admin_client, onb_id):
        buf = _build_xlsx([
            ["name", "category", "price"],
            ["Paneer Butter Masala", "Main", 200],
            ["Chicken Tikka", "Starter", 240],
            ["Aloo Gobi", "Main", 160],
            ["Fish Fry", "Starter", 280],
        ])
        r = admin_client.post(
            f"{API}/onboarding/vendors/{onb_id}/menu/upload-excel",
            files={"file": ("m.xlsx", buf,
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["inserted"] == 4

        got = admin_client.get(f"{API}/onboarding/vendors/{onb_id}", timeout=15).json()
        by_name = {i["name"]: i["is_vegetarian"] for i in got["draft_menu"]}
        assert by_name["Paneer Butter Masala"] is True
        assert by_name["Chicken Tikka"] is False
        assert by_name["Aloo Gobi"] is True
        assert by_name["Fish Fry"] is False

    def test_explicit_column_honoured(self, admin_client, onb_id):
        # Explicit user values should override the classifier
        buf = _build_xlsx([
            ["name", "category", "price", "is_vegetarian"],
            ["Item A", "Main", 100, "yes"],
            ["Item B", "Main", 100, "no"],
            ["Item C", "Main", 100, "veg"],
            ["Item D", "Main", 100, "NON-VEG"],
        ])
        r = admin_client.post(
            f"{API}/onboarding/vendors/{onb_id}/menu/upload-excel",
            files={"file": ("m.xlsx", buf,
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        got = admin_client.get(f"{API}/onboarding/vendors/{onb_id}", timeout=15).json()
        by_name = {i["name"]: i["is_vegetarian"] for i in got["draft_menu"]}
        assert by_name["Item A"] is True
        assert by_name["Item B"] is False
        assert by_name["Item C"] is True
        assert by_name["Item D"] is False


# ---------- reclassify-veg draft endpoint ----------
def _add_item(client, onb_id, name, is_veg):
    r = client.post(
        f"{API}/onboarding/vendors/{onb_id}/menu",
        json={"name": name, "price": 100, "category": "Main",
              "is_vegetarian": is_veg},
        timeout=15,
    )
    assert r.status_code == 200, r.text


class TestReclassifyOnboarding:
    def test_reclassify_flips_wrong_flags(self, admin_client, onb_id):
        # All 5 flagged wrong on purpose
        for n, v in [
            ("Paneer Masala", False),
            ("Chicken Biryani", True),
            ("Aloo Paratha", False),
            ("Fish Curry", True),
            ("Chana Masala", False),
        ]:
            _add_item(admin_client, onb_id, n, v)

        r = admin_client.post(
            f"{API}/onboarding/vendors/{onb_id}/menu/reclassify-veg", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data == {"changed": 5, "total": 5}

        got = admin_client.get(f"{API}/onboarding/vendors/{onb_id}", timeout=15).json()
        by_name = {i["name"]: i["is_vegetarian"] for i in got["draft_menu"]}
        assert by_name["Paneer Masala"] is True
        assert by_name["Chicken Biryani"] is False
        assert by_name["Aloo Paratha"] is True
        assert by_name["Fish Curry"] is False
        assert by_name["Chana Masala"] is True

    def test_reclassify_noop_when_already_correct(self, admin_client, onb_id):
        for n, v in [("Paneer Masala", True), ("Chicken Biryani", False)]:
            _add_item(admin_client, onb_id, n, v)
        r = admin_client.post(
            f"{API}/onboarding/vendors/{onb_id}/menu/reclassify-veg", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["changed"] == 0
        assert data["total"] == 2

    def test_reclassify_requires_auth(self, onb_id):
        # No cookies → 401/403
        r = requests.post(
            f"{API}/onboarding/vendors/{onb_id}/menu/reclassify-veg", timeout=15)
        assert r.status_code in (401, 403), r.text

    def test_reclassify_400_when_rejected(self, admin_client, site_id):
        # Fresh onboarding, reject it via site-review → status=rejected
        payload = {
            "vendor_name": f"TEST_vrej_{uuid.uuid4().hex[:6]}",
            "company_name": "TEST", "contact_person": "P",
            "mobile_number": "9999999999",
            "email": f"vrej_{uuid.uuid4().hex[:6]}@example.com",
            "business_address": "x", "cuisine_type": "Multi",
            "site_id": site_id,
        }
        r = admin_client.post(f"{API}/onboarding/vendors", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        rid = r.json()["id"]
        _add_item(admin_client, rid, "Chicken Biryani", True)

        rj = admin_client.post(f"{API}/onboarding/vendors/{rid}/site-review",
                               json={"decision": "reject", "remarks": "test"},
                               timeout=15)
        assert rj.status_code == 200, rj.text

        r2 = admin_client.post(
            f"{API}/onboarding/vendors/{rid}/menu/reclassify-veg", timeout=15)
        assert r2.status_code == 400, r2.text


# ---------- reclassify-veg live menu_items endpoint ----------
class TestReclassifyLiveMenuItems:
    def test_master_only(self):
        # Unauthenticated → 401/403
        r = requests.post(f"{API}/admin/menu-items/reclassify-veg", timeout=15)
        assert r.status_code in (401, 403)

    def test_scope_by_vendor(self, admin_client, site_id):
        """Insert two scratch rows via direct API-visible flow.

        We cannot POST to menu_items directly (no public create), so we
        approve an onboarding to materialise real menu_items rows. To keep
        this test compact, we just call the endpoint with a bogus vendor_id
        that matches nothing — response must be {changed:0, total:0}.
        """
        r = admin_client.post(
            f"{API}/admin/menu-items/reclassify-veg",
            params={"vendor_id": f"nonexistent_{uuid.uuid4().hex[:8]}"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["changed"] == 0
        assert data["total"] == 0
        assert data.get("scope", {}).get("vendor_id", "").startswith("nonexistent_")
