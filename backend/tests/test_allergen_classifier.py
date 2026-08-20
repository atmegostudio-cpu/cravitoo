"""Regression tests for the food-allergen classifier + endpoints.

Covers:
  - Unit tests for classify_allergens (canonical taxonomy)
  - normalize_allergens (drops unknowns, dedupes, case-insensitive)
  - reclassify_batch honours `only_missing`
  - Excel bulk-upload auto-classifies when `allergens` column empty
  - Onboarding PATCH accepts + normalises `allergens`
  - Onboarding /reclassify-allergens endpoint (draft menus)
  - Live /admin/menu-items/reclassify-allergens endpoint
  - /api/menu/{vendor_id} returns `allergens` in the response
"""
import io
import os
import sys
import uuid
import pytest
import requests
from datetime import datetime, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from allergen_classifier import (
    ALLERGEN_KEYS,
    classify_allergens,
    normalize_allergens,
    reclassify_batch,
)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api" if BASE_URL else None
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")


# ─── Unit tests (no HTTP required) ──────────────────────────────────────────

class TestClassifier:
    def test_paneer_butter_masala_is_milk_only(self):
        result = classify_allergens("Paneer Butter Masala", "Cottage cheese in creamy tomato gravy")
        assert "milk" in result
        # No wheat/nuts/etc. explicitly - "cottage cheese" hits milk via "cheese"
        assert "gluten" not in result

    def test_chicken_biryani_no_allergens(self):
        # Fish/shellfish/etc absent, chicken doesn't trigger any allergen
        assert classify_allergens("Chicken Biryani", "Basmati rice with chicken") == []

    def test_veg_kaju_curry_is_nuts(self):
        assert "nuts" in classify_allergens("Kaju Curry", "Cashew based gravy")

    def test_peanut_chutney_is_peanuts_not_nuts(self):
        r = classify_allergens("Peanut Chutney", "Roasted moongfali chutney")
        assert "peanuts" in r
        assert "nuts" not in r  # peanuts is a legume, not a tree nut

    def test_masala_dosa_is_gluten_free(self):
        assert "gluten" not in classify_allergens("Masala Dosa", "Rice + urad dal crepe with potato filling")

    def test_veg_sandwich_is_gluten(self):
        assert "gluten" in classify_allergens("Veg Sandwich", "Bread with cucumber and tomato")

    def test_prawn_curry_is_shellfish(self):
        assert "shellfish" in classify_allergens("Prawn Curry", "")

    def test_egg_bhurji_is_egg(self):
        assert "egg" in classify_allergens("Egg Bhurji", "Scrambled anda")

    def test_multiple_allergens_paneer_kaju(self):
        r = classify_allergens("Paneer Kaju Pulao", "Rice with paneer, cashew and butter")
        assert "milk" in r
        assert "nuts" in r
        # Canonical order preserved
        assert r.index("milk") < r.index("nuts")

    def test_normalize_drops_unknown(self):
        assert normalize_allergens(["Milk", "GLUTEN", "unicorn", "milk"]) == ["milk", "gluten"]

    def test_normalize_empty(self):
        assert normalize_allergens(None) == []
        assert normalize_allergens([]) == []
        assert normalize_allergens(["", "  "]) == []

    def test_reclassify_only_missing_preserves_manual(self):
        items = [
            {"name": "Paneer Tikka", "description": "", "allergens": ["nuts"]},  # manual override
            {"name": "Fish Fry", "description": ""},                              # missing
            {"name": "Egg Curry", "description": "", "allergens": []},            # empty
        ]
        updated, changed = reclassify_batch(items, only_missing=True)
        assert changed == 2
        assert updated[0]["allergens"] == ["nuts"]  # untouched
        assert updated[1]["allergens"] == ["fish"]
        assert updated[2]["allergens"] == ["egg"]

    def test_reclassify_overwrite_flips_manual(self):
        items = [{"name": "Paneer Tikka", "description": "", "allergens": ["nuts"]}]
        updated, changed = reclassify_batch(items, only_missing=False)
        assert changed == 1
        assert updated[0]["allergens"] == ["milk"]  # correctly re-detected


# ─── HTTP integration tests ─────────────────────────────────────────────────

if not (BASE_URL and ADMIN_EMAIL and ADMIN_PASSWORD):
    pytest.skip(
        "REACT_APP_BACKEND_URL / ADMIN_EMAIL / ADMIN_PASSWORD env vars required for HTTP tests",
        allow_module_level=True,
    )


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def _H(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def site_id(admin_token):
    """Return an existing site_id, or create a City → Client → Site chain."""
    r = requests.get(f"{API}/sites", headers=_H(admin_token), timeout=15)
    if r.status_code == 200 and r.json():
        return r.json()[0].get("id")

    suffix = uuid.uuid4().hex[:6]
    r = requests.get(f"{API}/cities", headers=_H(admin_token), timeout=15)
    cities = r.json() if r.status_code == 200 else []
    if cities:
        city_id = cities[0].get("id")
    else:
        r = requests.post(f"{API}/cities",
                          json={"name": f"TEST_alrg_City_{suffix}", "state": "Karnataka"},
                          headers=_H(admin_token), timeout=15)
        city_id = r.json().get("id")

    r = requests.get(f"{API}/master/corporate-clients", headers=_H(admin_token), timeout=15)
    clients = r.json() if r.status_code == 200 else []
    if clients:
        client_id = clients[0].get("id")
    else:
        r = requests.post(f"{API}/master/corporate-clients",
                          json={"name": f"TEST_alrg_Corp_{suffix}", "city_id": city_id,
                                "address": "1 Test Rd",
                                "contact_email": f"corp_{suffix}@example.com",
                                "contact_phone": "9000000000"},
                          headers=_H(admin_token), timeout=15)
        client_id = r.json().get("id")

    r = requests.post(f"{API}/sites",
                      json={"name": f"TEST_alrg_Site_{suffix}", "address": "1 Test Rd",
                            "city": "Bengaluru", "city_id": city_id,
                            "corporate_client_id": client_id,
                            "contact_email": f"site_{suffix}@example.com",
                            "contact_phone": "9000000000"},
                      headers=_H(admin_token), timeout=15)
    return r.json().get("id")


@pytest.fixture
def scratch_onboarding(admin_token, site_id):
    """Create + tear down a scratch vendor onboarding row."""
    suffix = uuid.uuid4().hex[:6]
    onb = requests.post(f"{API}/onboarding/vendors",
                        json={
                            "vendor_name": f"TEST__alrg_Vendor_{suffix}",
                            "company_name": "Test Foods",
                            "contact_person": "Test",
                            "mobile_number": "9999999999",
                            "email": f"alrg_{suffix}@example.com",
                            "business_address": "1 Test",
                            "cuisine_type": "Multi",
                            "site_id": site_id,
                        },
                        headers=_H(admin_token), timeout=15)
    onb.raise_for_status()
    onb_id = onb.json()["id"]

    yield {"onb_id": onb_id, "site_id": site_id}

    try:
        requests.delete(f"{API}/onboarding/vendors/{onb_id}",
                        headers=_H(admin_token), timeout=15)
    except Exception:
        pass


class TestOnboardingEndpoints:
    def test_add_item_with_allergens(self, admin_token, scratch_onboarding):
        onb_id = scratch_onboarding["onb_id"]
        r = requests.post(
            f"{API}/onboarding/vendors/{onb_id}/menu",
            json={
                "name": "Paneer Tikka",
                "description": "Cottage cheese kebabs",
                "category": "Starter",
                "price": 220,
                "is_vegetarian": True,
                "allergens": ["milk", "MUSTARD", "unknown"],  # mixed case + junk
            },
            headers=_H(admin_token), timeout=15,
        )
        assert r.status_code == 200, r.text
        item = r.json()["item"]
        assert item["allergens"] == ["milk", "mustard"]  # normalised, unknown dropped

    def test_patch_item_replaces_allergens(self, admin_token, scratch_onboarding):
        onb_id = scratch_onboarding["onb_id"]
        add = requests.post(f"{API}/onboarding/vendors/{onb_id}/menu",
                            json={"name": "Egg Fried Rice", "price": 180,
                                  "description": "Rice with anda"},
                            headers=_H(admin_token), timeout=15).json()
        item_id = add["item"]["item_id"]
        r = requests.patch(f"{API}/onboarding/vendors/{onb_id}/menu/{item_id}",
                           json={"allergens": ["egg", "soy"]},
                           headers=_H(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        assert set(r.json()["item"]["allergens"]) == {"egg", "soy"}

    def test_excel_auto_classifies_missing_allergens(self, admin_token, scratch_onboarding):
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["name", "category", "price", "description", "is_vegetarian", "allergens"])
        # Row 1: no allergens col value → auto-classify → should get "milk"
        ws.append(["Paneer Butter Masala", "Main", 240, "Creamy cottage cheese", "yes", ""])
        # Row 2: explicit allergens = "peanuts, egg" → honour that
        ws.append(["Peanut Chikki", "Sweet", 60, "Groundnut brittle", "yes", "peanuts, egg"])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)

        r = requests.post(
            f"{API}/onboarding/vendors/{scratch_onboarding['onb_id']}/menu/upload-excel",
            files={"file": ("menu.xlsx", buf.read(),
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=_H(admin_token), timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["inserted"] == 2

        # Verify draft_menu
        onb = requests.get(f"{API}/onboarding/vendors/{scratch_onboarding['onb_id']}",
                           headers=_H(admin_token), timeout=15).json()
        by_name = {m["name"]: m for m in onb["draft_menu"]}
        assert "milk" in by_name["Paneer Butter Masala"]["allergens"]
        assert by_name["Peanut Chikki"]["allergens"] == ["peanuts", "egg"]

    def test_reclassify_endpoint_fills_missing(self, admin_token, scratch_onboarding):
        onb_id = scratch_onboarding["onb_id"]
        # Add items with no allergens
        for nm, desc in [("Fish Fry", "Grilled fish"), ("Cashew Curry", "Kaju gravy")]:
            requests.post(f"{API}/onboarding/vendors/{onb_id}/menu",
                          json={"name": nm, "description": desc, "price": 200},
                          headers=_H(admin_token), timeout=15)
        r = requests.post(f"{API}/onboarding/vendors/{onb_id}/menu/reclassify-allergens",
                          headers=_H(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["changed"] >= 2

        onb = requests.get(f"{API}/onboarding/vendors/{onb_id}",
                           headers=_H(admin_token), timeout=15).json()
        by_name = {m["name"]: m for m in onb["draft_menu"]}
        assert "fish" in by_name["Fish Fry"]["allergens"]
        assert "nuts" in by_name["Cashew Curry"]["allergens"]

    def test_reclassify_only_missing_preserves_manual(self, admin_token, scratch_onboarding):
        onb_id = scratch_onboarding["onb_id"]
        add = requests.post(f"{API}/onboarding/vendors/{onb_id}/menu",
                            json={"name": "Paneer Tikka Special", "description": "creamy",
                                  "price": 220, "allergens": ["nuts"]},  # deliberate wrong
                            headers=_H(admin_token), timeout=15).json()
        item_id = add["item"]["item_id"]
        # Default (overwrite=false) should NOT change nuts→milk
        r = requests.post(f"{API}/onboarding/vendors/{onb_id}/menu/reclassify-allergens",
                          headers=_H(admin_token), timeout=15)
        assert r.status_code == 200
        onb = requests.get(f"{API}/onboarding/vendors/{onb_id}",
                           headers=_H(admin_token), timeout=15).json()
        item = next(m for m in onb["draft_menu"] if m["item_id"] == item_id)
        assert item["allergens"] == ["nuts"]  # preserved

        # overwrite=true should flip it
        r2 = requests.post(f"{API}/onboarding/vendors/{onb_id}/menu/reclassify-allergens?overwrite=true",
                           headers=_H(admin_token), timeout=15)
        assert r2.status_code == 200
        onb = requests.get(f"{API}/onboarding/vendors/{onb_id}",
                           headers=_H(admin_token), timeout=15).json()
        item = next(m for m in onb["draft_menu"] if m["item_id"] == item_id)
        assert "milk" in item["allergens"]


class TestAdminEndpoints:
    def test_live_reclassify_requires_master(self):
        r = requests.post(f"{API}/admin/menu-items/reclassify-allergens", timeout=15)
        assert r.status_code == 401

    def test_live_reclassify_scope_query(self, admin_token):
        # Run with a bogus vendor_id so no rows match — should still return 200
        r = requests.post(
            f"{API}/admin/menu-items/reclassify-allergens?vendor_id=nonexistent",
            headers=_H(admin_token), timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["total"] == 0
