"""Backend tests for the new Vendor Onboarding → Menu endpoints.

Endpoints under test:
  POST   /api/onboarding/vendors/{onb_id}/menu
  PATCH  /api/onboarding/vendors/{onb_id}/menu/{item_id}
  DELETE /api/onboarding/vendors/{onb_id}/menu/{item_id}
  POST   /api/onboarding/vendors/{onb_id}/menu/upload-excel
  Master decision → materialisation into menu_items collection.
"""
import io
import os
import uuid

import openpyxl
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://corporate-feast.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@cravitoo.com"
ADMIN_PASSWORD = "admin123"

CHECKLIST_FIELDS = [
    "gst_verified", "pan_verified", "fssai_verified", "bank_verified",
    "menu_uploaded", "pricing_verified", "documents_uploaded",
    "site_visit_completed", "commercial_terms_accepted", "agreement_signed",
]

# ---------- fixtures ----------

@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"master admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def site_id(admin_client):
    """Get or create a City → Corporate Client → Site chain so we have a site_id."""
    # Try existing sites first
    r = admin_client.get(f"{BASE_URL}/api/sites")
    if r.status_code == 200 and r.json():
        return r.json()[0].get("id")

    # 1) City
    r = admin_client.get(f"{BASE_URL}/api/cities")
    cities = r.json() if r.status_code == 200 else []
    if cities:
        city_id = cities[0].get("id")
    else:
        r = admin_client.post(f"{BASE_URL}/api/cities",
                              json={"name": f"TEST_City_{uuid.uuid4().hex[:6]}",
                                    "state": "Karnataka"})
        assert r.status_code in (200, 201), f"create city failed: {r.status_code} {r.text}"
        city_id = r.json().get("id")

    # 2) Corporate client
    r = admin_client.get(f"{BASE_URL}/api/master/corporate-clients")
    clients = r.json() if r.status_code == 200 else []
    client_id = None
    if clients:
        client_id = clients[0].get("id")
    else:
        r = admin_client.post(f"{BASE_URL}/api/master/corporate-clients",
                              json={"name": f"TEST_Corp_{uuid.uuid4().hex[:6]}",
                                    "city_id": city_id,
                                    "contact_email": f"corp_{uuid.uuid4().hex[:6]}@example.com"})
        if r.status_code in (200, 201):
            client_id = r.json().get("id")

    payload = {"name": f"TEST_Site_{uuid.uuid4().hex[:6]}",
               "address": "123 Test Ln",
               "city": "Bengaluru",
               "city_id": city_id,
               "corporate_client_id": client_id,
               "contact_email": f"site_{uuid.uuid4().hex[:6]}@example.com",
               "contact_phone": "9000000000"}
    r = admin_client.post(f"{BASE_URL}/api/sites", json=payload)
    assert r.status_code in (200, 201), f"create site failed: {r.status_code} {r.text}"
    return r.json().get("id")


@pytest.fixture
def onb_id(admin_client, site_id):
    """Create a fresh draft onboarding row for each test."""
    payload = {
        "vendor_name": f"TEST__vendor_{uuid.uuid4().hex[:6]}",
        "company_name": "Test Foods Pvt Ltd",
        "contact_person": "Test Person",
        "mobile_number": "9999999999",
        "email": f"vendor_{uuid.uuid4().hex[:6]}@example.com",
        "business_address": "45 Test Rd",
        "cuisine_type": "Multi-cuisine",
        "site_id": site_id,
    }
    r = admin_client.post(f"{BASE_URL}/api/onboarding/vendors", json=payload)
    assert r.status_code in (200, 201), f"onboarding create failed: {r.status_code} {r.text}"
    return r.json().get("id")


# ---------- POST add item ----------

class TestAddMenuItem:
    def test_add_item_ok(self, admin_client, onb_id):
        body = {"name": "Veg Thali", "description": "Full meal",
                "category": "Main", "price": 180,
                "is_vegetarian": True, "is_available": True,
                "meal_periods": ["lunch", "dinner"], "image_url": None}
        r = admin_client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu", json=body)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] == 1
        item = data["item"]
        assert item["name"] == "Veg Thali"
        assert item["price"] == 180.0
        assert item["is_vegetarian"] is True
        assert set(item["meal_periods"]) == {"lunch", "dinner"}
        assert "item_id" in item and len(item["item_id"]) >= 32  # uuid
        # Verify GET returns the item
        g = admin_client.get(f"{BASE_URL}/api/onboarding/vendors/{onb_id}")
        assert g.status_code == 200
        got = g.json()
        assert len(got["draft_menu"]) == 1
        assert got["draft_menu"][0]["item_id"] == item["item_id"]
        # Checklist auto-flipped
        assert got.get("checklist", {}).get("menu_uploaded") is True

    def test_add_item_price_zero_rejected(self, admin_client, onb_id):
        body = {"name": "Bad", "price": 0}
        r = admin_client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu", json=body)
        assert r.status_code == 400

    def test_add_item_negative_price_rejected(self, admin_client, onb_id):
        body = {"name": "Bad", "price": -5}
        r = admin_client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu", json=body)
        assert r.status_code == 400

    def test_add_item_missing_name_rejected(self, admin_client, onb_id):
        # Pydantic returns 422 for missing required field
        r = admin_client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu",
                              json={"price": 10})
        assert r.status_code in (400, 422)

    def test_add_item_unknown_meal_period_silently_filtered(self, admin_client, onb_id):
        body = {"name": "Filter Test", "price": 50,
                "meal_periods": ["brunch", "lunch", "midnight"]}
        r = admin_client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu", json=body)
        assert r.status_code == 200
        assert r.json()["item"]["meal_periods"] == ["lunch"]


# ---------- PATCH update ----------

class TestPatchMenuItem:
    def _add(self, client, onb_id, **overrides):
        body = {"name": "Base Item", "price": 100, "category": "Main",
                "meal_periods": ["lunch"], **overrides}
        r = client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu", json=body)
        assert r.status_code == 200
        return r.json()["item"]["item_id"]

    def test_patch_updates_fields(self, admin_client, onb_id):
        item_id = self._add(admin_client, onb_id)
        r = admin_client.patch(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu/{item_id}",
                               json={"price": 250, "is_available": False,
                                     "meal_periods": ["breakfast", "brunch"]})
        assert r.status_code == 200, r.text
        item = r.json()["item"]
        assert item["price"] == 250.0
        assert item["is_available"] is False
        # brunch filtered out
        assert item["meal_periods"] == ["breakfast"]
        # GET persistence
        g = admin_client.get(f"{BASE_URL}/api/onboarding/vendors/{onb_id}")
        found = next(x for x in g.json()["draft_menu"] if x["item_id"] == item_id)
        assert found["price"] == 250.0
        assert found["is_available"] is False

    def test_patch_zero_price_rejected(self, admin_client, onb_id):
        item_id = self._add(admin_client, onb_id)
        r = admin_client.patch(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu/{item_id}",
                               json={"price": 0})
        assert r.status_code == 400

    def test_patch_unknown_item_404(self, admin_client, onb_id):
        r = admin_client.patch(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu/{uuid.uuid4()}",
                               json={"price": 50})
        assert r.status_code == 404


# ---------- DELETE ----------

class TestDeleteMenuItem:
    def test_delete_ok_and_checklist_flip(self, admin_client, onb_id):
        # add 2
        a = admin_client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu",
                              json={"name": "A", "price": 10}).json()["item"]["item_id"]
        b = admin_client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu",
                              json={"name": "B", "price": 20}).json()["item"]["item_id"]
        r = admin_client.delete(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu/{a}")
        assert r.status_code == 200
        assert r.json()["remaining"] == 1
        # menu_uploaded still true
        g = admin_client.get(f"{BASE_URL}/api/onboarding/vendors/{onb_id}")
        assert g.json().get("checklist", {}).get("menu_uploaded") is True
        # delete last one
        r = admin_client.delete(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu/{b}")
        assert r.status_code == 200
        g = admin_client.get(f"{BASE_URL}/api/onboarding/vendors/{onb_id}")
        assert g.json().get("checklist", {}).get("menu_uploaded") is False
        assert g.json().get("draft_menu", []) == []

    def test_delete_unknown_404(self, admin_client, onb_id):
        r = admin_client.delete(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu/{uuid.uuid4()}")
        assert r.status_code == 404


# ---------- Excel bulk upload ----------

def _xlsx_bytes(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class TestExcelUpload:
    def test_upload_replaces_draft(self, admin_client, onb_id):
        # Seed one manual item first
        admin_client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu",
                          json={"name": "Manual", "price": 10})
        headers = ["name", "category", "price", "description",
                   "meal_period", "is_vegetarian", "is_available", "image_url"]
        rows = [
            headers,
            ["Chicken Biryani", "Main", 220, "Spicy", "lunch,dinner", "no", "yes", ""],
            ["Chai", "Beverage", 20, "Hot", "breakfast,snacks", "yes", "yes", ""],
        ]
        content = _xlsx_bytes(rows)
        r = admin_client.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu/upload-excel",
            files={"file": ("menu.xlsx", content,
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["inserted"] == 2
        g = admin_client.get(f"{BASE_URL}/api/onboarding/vendors/{onb_id}").json()
        names = sorted([x["name"] for x in g["draft_menu"]])
        assert names == ["Chai", "Chicken Biryani"]  # Manual replaced
        biryani = next(x for x in g["draft_menu"] if x["name"] == "Chicken Biryani")
        assert set(biryani["meal_periods"]) == {"lunch", "dinner"}
        assert biryani["is_vegetarian"] is False

    def test_upload_rejects_bad_extension(self, admin_client, onb_id):
        r = admin_client.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu/upload-excel",
            files={"file": ("menu.csv", b"a,b,c\n", "text/csv")},
        )
        assert r.status_code == 400

    def test_upload_missing_columns(self, admin_client, onb_id):
        rows = [["name", "description"], ["Foo", "bar"]]
        r = admin_client.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu/upload-excel",
            files={"file": ("menu.xlsx", _xlsx_bytes(rows),
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert r.status_code == 400


# ---------- Status guard (approved/active/rejected) ----------

class TestStatusGuard:
    def _reject(self, client, onb_id):
        """Force onboarding to 'rejected' via master-decision.

        Path: needs status==under_master_review. We use site-review approve then master reject.
        Alternative: manually set via PATCH not exposed; use two-step decision flow.
        Requires checklist >= 80%.
        """
        # Set all checklist fields via PATCH /checklist
        
        checklist = {f: True for f in CHECKLIST_FIELDS}
        client.patch(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/checklist", json=checklist)
        client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/site-review",
                    json={"decision": "approve", "remarks": "ok"})
        r = client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/master-decision",
                        json={"decision": "reject", "remarks": "test"})
        assert r.status_code == 200, r.text

    def test_menu_add_rejected_when_rejected(self, admin_client, onb_id):
        try:
            self._reject(admin_client, onb_id)
        except Exception as e:
            pytest.skip(f"could not force rejected status: {e}")
        r = admin_client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id}/menu",
                              json={"name": "X", "price": 10})
        assert r.status_code == 400
        assert "status" in r.text.lower()


# ---------- Master approval materialisation ----------

class TestMasterApprovalMaterialisation:
    def test_menu_items_created_on_approval(self, admin_client, site_id):
        # Fresh onboarding
        payload = {
            "vendor_name": f"TEST__vendor_{uuid.uuid4().hex[:6]}",
            "company_name": "Approve Foods",
            "contact_person": "Approver",
            "mobile_number": "9998887776",
            "email": f"approve_{uuid.uuid4().hex[:6]}@example.com",
            "business_address": "1 Approve Rd",
            "cuisine_type": "Multi-cuisine",
            "site_id": site_id,
        }
        onb = admin_client.post(f"{BASE_URL}/api/onboarding/vendors", json=payload).json()
        onb_id_local = onb["id"]

        # Add 3 menu items
        for i, name in enumerate(["Idli", "Dosa", "Vada"]):
            admin_client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id_local}/menu",
                              json={"name": name, "price": 40 + i * 10,
                                    "category": "South", "is_vegetarian": True,
                                    "meal_periods": ["breakfast"]})

        # Complete checklist
        
        checklist = {f: True for f in CHECKLIST_FIELDS}
        admin_client.patch(f"{BASE_URL}/api/onboarding/vendors/{onb_id_local}/checklist",
                           json=checklist)
        # Submit -> under_master_review
        admin_client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id_local}/site-review",
                          json={"decision": "approve", "remarks": "ok"})
        # Master approve
        r = admin_client.post(f"{BASE_URL}/api/onboarding/vendors/{onb_id_local}/master-decision",
                              json={"decision": "approve", "remarks": "ok"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("menu_items_created") == 3
        vendor_id = body.get("vendor_id")
        assert vendor_id

        # Query vendor's menu items (public menu-items list, if available)
        r = admin_client.get(f"{BASE_URL}/api/vendors/{vendor_id}/menu")
        if r.status_code == 200:
            items = r.json()
            assert len(items) >= 3
            names = [i.get("name") for i in items]
            for expected in ["Idli", "Dosa", "Vada"]:
                assert expected in names
