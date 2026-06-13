"""
Backend tests for iteration 4: Master Admin / Site Admin / multi-site endpoints.
Covers sites CRUD, vendor-site mapping, meal schedule, site menu, Excel upload,
admin management, reports, /employee/my-site, and authZ boundary checks.
"""
import io
import os
import time
import uuid
import pytest
import requests
import openpyxl

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "master":   ("admin@cravitoo.com",       "admin123"),
    "site":     ("siteadmin@techcorp.com",   "site123"),
    "vendor":   ("vendor@spicekitchen.com",  "vendor123"),
    "employee": ("employee@techcorp.com",    "employee123"),
}


# ----------- helpers / fixtures -----------
def _login(email: str, password: str) -> dict:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data, f"missing access_token: {data}"
    assert "role" in data, f"missing role: {data}"
    # Build a uniform shape: {access_token, user: {...}}
    return {"access_token": data["access_token"], "user": data}


@pytest.fixture(scope="session")
def tokens():
    out = {}
    for k, (email, pwd) in CREDS.items():
        out[k] = _login(email, pwd)
    return out


def H(tokens, role):
    return {"Authorization": f"Bearer {tokens[role]['access_token']}"}


# ----------- Login & roles -----------
class TestAuth:
    def test_login_all_roles_return_role_and_token(self, tokens):
        assert tokens["master"]["user"]["role"] == "master_admin"
        assert tokens["site"]["user"]["role"] == "site_admin"
        assert tokens["vendor"]["user"]["role"] == "vendor"
        assert tokens["employee"]["user"]["role"] == "employee"
        for k in tokens:
            assert isinstance(tokens[k]["access_token"], str) and len(tokens[k]["access_token"]) > 10


# Shared state across test classes (created site/admins for cleanup)
STATE = {}


# ----------- Sites CRUD -----------
class TestSitesCRUD:
    def test_master_create_site(self, tokens):
        payload = {
            "name": f"TEST_Site_{uuid.uuid4().hex[:6]}",
            "address": "1 Test Way",
            "city": "Bengaluru",
            "contact_email": "test_site@example.com",
            "contact_phone": "9999999999",
            "allow_pre_order": True,
            "allow_cash_carry": True,
            "allow_company_paid": False,
            "allow_employee_paid": True,
        }
        r = requests.post(f"{API}/sites", json=payload, headers=H(tokens, "master"), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "id" in body and body["name"] == payload["name"]
        STATE["site_id"] = body["id"]
        STATE["site_name"] = body["name"]

    def test_non_master_cannot_create_site(self, tokens):
        payload = {
            "name": "TEST_should_fail",
            "address": "x", "city": "y",
            "contact_email": "x@example.com", "contact_phone": "1",
        }
        for role in ("site", "vendor", "employee"):
            r = requests.post(f"{API}/sites", json=payload, headers=H(tokens, role), timeout=10)
            assert r.status_code == 403, f"{role} got {r.status_code}"

    def test_master_lists_all_sites_includes_new(self, tokens):
        r = requests.get(f"{API}/sites", headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 200
        ids = [s["id"] for s in r.json()]
        assert STATE["site_id"] in ids

    def test_site_admin_lists_only_own_site(self, tokens):
        r = requests.get(f"{API}/sites", headers=H(tokens, "site"), timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert len(body) <= 1
        # Save site_admin's own site_id for later
        if body:
            STATE["site_admin_site_id"] = body[0]["id"]

    def test_vendor_lists_only_mapped_sites(self, tokens):
        r = requests.get(f"{API}/sites", headers=H(tokens, "vendor"), timeout=10)
        assert r.status_code == 200
        # Should be a list (possibly empty)
        assert isinstance(r.json(), list)

    def test_get_site_master(self, tokens):
        r = requests.get(f"{API}/sites/{STATE['site_id']}", headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 200
        assert r.json()["id"] == STATE["site_id"]

    def test_get_site_vendor_unmapped_denied(self, tokens):
        r = requests.get(f"{API}/sites/{STATE['site_id']}", headers=H(tokens, "vendor"), timeout=10)
        assert r.status_code == 403, f"vendor unmapped should be 403, got {r.status_code}"

    def test_patch_site_toggle_pre_order(self, tokens):
        r = requests.patch(
            f"{API}/sites/{STATE['site_id']}",
            json={"allow_pre_order": False, "allow_cash_carry": False},
            headers=H(tokens, "master"), timeout=10,
        )
        assert r.status_code == 200
        # verify via GET
        g = requests.get(f"{API}/sites/{STATE['site_id']}", headers=H(tokens, "master"), timeout=10)
        assert g.status_code == 200
        body = g.json()
        assert body.get("allow_pre_order") is False
        assert body.get("allow_cash_carry") is False

    def test_patch_site_rejects_no_valid_fields(self, tokens):
        r = requests.patch(
            f"{API}/sites/{STATE['site_id']}",
            json={"unknown_field": 1},
            headers=H(tokens, "master"), timeout=10,
        )
        assert r.status_code == 400


# ----------- Vendor-Site Mapping -----------
class TestVendorSiteMapping:
    def test_map_vendor_to_site(self, tokens):
        vendor_id = tokens["vendor"]["user"].get("vendor_id")
        assert vendor_id, "vendor login response missing vendor_id"
        STATE["vendor_id"] = vendor_id
        payload = {"vendor_id": vendor_id, "site_id": STATE["site_id"]}
        r = requests.post(f"{API}/sites/{STATE['site_id']}/vendors", json=payload,
                          headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 200, r.text

    def test_map_duplicate_returns_400(self, tokens):
        payload = {"vendor_id": STATE["vendor_id"], "site_id": STATE["site_id"]}
        r = requests.post(f"{API}/sites/{STATE['site_id']}/vendors", json=payload,
                          headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 400

    def test_list_site_vendors(self, tokens):
        r = requests.get(f"{API}/sites/{STATE['site_id']}/vendors",
                         headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 200
        vendors = r.json()
        assert any(v["id"] == STATE["vendor_id"] for v in vendors)

    def test_vendor_now_sees_mapped_site(self, tokens):
        r = requests.get(f"{API}/sites", headers=H(tokens, "vendor"), timeout=10)
        assert r.status_code == 200
        ids = [s["id"] for s in r.json()]
        assert STATE["site_id"] in ids

    def test_unmap_vendor(self, tokens):
        r = requests.delete(
            f"{API}/sites/{STATE['site_id']}/vendors/{STATE['vendor_id']}",
            headers=H(tokens, "master"), timeout=10,
        )
        assert r.status_code == 200
        # re-map for downstream tests (Excel upload etc.)
        rmap = requests.post(
            f"{API}/sites/{STATE['site_id']}/vendors",
            json={"vendor_id": STATE["vendor_id"], "site_id": STATE["site_id"]},
            headers=H(tokens, "master"), timeout=10,
        )
        assert rmap.status_code == 200


# ----------- Meal Schedule -----------
class TestMealSchedule:
    def test_get_default_schedule(self, tokens):
        r = requests.get(f"{API}/sites/{STATE['site_id']}/schedule",
                         headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["site_id"] == STATE["site_id"]
        meals = [s["meal_period"] for s in body["schedules"]]
        assert set(meals) >= {"breakfast", "lunch", "snacks", "dinner"}

    def test_update_schedule(self, tokens):
        new_sched = {
            "schedules": [
                {"meal_period": "breakfast", "start_time": "08:00", "end_time": "10:00", "enabled": True},
                {"meal_period": "lunch",     "start_time": "12:30", "end_time": "14:30", "enabled": True},
                {"meal_period": "snacks",    "start_time": "16:30", "end_time": "18:00", "enabled": True},
                {"meal_period": "dinner",    "start_time": "19:30", "end_time": "21:30", "enabled": True},
            ]
        }
        r = requests.put(f"{API}/sites/{STATE['site_id']}/schedule", json=new_sched,
                         headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 200
        # verify
        g = requests.get(f"{API}/sites/{STATE['site_id']}/schedule",
                         headers=H(tokens, "master"), timeout=10).json()
        b = next(s for s in g["schedules"] if s["meal_period"] == "breakfast")
        assert b["start_time"] == "08:00" and b["end_time"] == "10:00"


# ----------- Site Menu (Excel upload + site control) -----------
class TestSiteMenuAndExcel:
    def _make_xlsx(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["name", "description", "category", "price", "is_vegetarian", "meal_periods"])
        for i in range(1, 7):
            ws.append([f"TEST_Dish_{i}", f"desc {i}", "Main Course", 100 + i * 10, True, "lunch,dinner"])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return buf

    def test_upload_excel_inserts_items(self, tokens):
        buf = self._make_xlsx()
        files = {"file": ("menu.xlsx", buf,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(
            f"{API}/sites/{STATE['site_id']}/menu/upload-excel?vendor_id={STATE['vendor_id']}",
            files=files, headers=H(tokens, "master"), timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["inserted"] >= 6, body
        assert body["errors"] == []

    def test_upload_excel_missing_columns_rejected(self, tokens):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["name", "price"])  # missing description, category
        ws.append(["BadDish", 100])
        buf = io.BytesIO(); wb.save(buf); buf.seek(0)
        files = {"file": ("bad.xlsx", buf,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(
            f"{API}/sites/{STATE['site_id']}/menu/upload-excel?vendor_id={STATE['vendor_id']}",
            files=files, headers=H(tokens, "master"), timeout=15,
        )
        assert r.status_code == 400

    def test_get_site_menu_master(self, tokens):
        r = requests.get(f"{API}/sites/{STATE['site_id']}/menu",
                         headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 6
        STATE["sample_menu_item_id"] = items[0]["id"]

    def test_patch_menu_site_control(self, tokens):
        item_id = STATE["sample_menu_item_id"]
        r = requests.patch(f"{API}/menu/{item_id}/site-control",
                           json={"is_available": False, "show_price": False, "price": 222.0},
                           headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 200
        # verify by listing
        items = requests.get(f"{API}/sites/{STATE['site_id']}/menu",
                             headers=H(tokens, "master"), timeout=10).json()
        item = next(i for i in items if i["id"] == item_id)
        assert item["is_available"] is False
        assert item["show_price"] is False
        assert abs(item["price"] - 222.0) < 0.01

    def test_employee_site_admin_cannot_patch_other_site_menu(self, tokens):
        # site admin token is for a different site - patching our TEST site's item must 403
        item_id = STATE["sample_menu_item_id"]
        r = requests.patch(f"{API}/menu/{item_id}/site-control",
                           json={"is_available": True},
                           headers=H(tokens, "site"), timeout=10)
        assert r.status_code == 403


# ----------- Admin management -----------
class TestAdminManagement:
    def test_create_site_admin(self, tokens):
        email = f"test_siteadmin_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/admin/site-admins",
                          json={"email": email, "password": "Pass1234!",
                                "name": "TEST Site Admin", "site_id": STATE["site_id"]},
                          headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["role"] == "site_admin" and body["site_id"] == STATE["site_id"]
        STATE["site_admin_id"] = body["id"]

    def test_create_super_admin(self, tokens):
        email = f"test_superadmin_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/admin/super-admins",
                          json={"email": email, "password": "Pass1234!",
                                "name": "TEST Super Admin",
                                "assigned_sites": [STATE["site_id"]]},
                          headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["role"] == "super_admin"
        STATE["super_admin_id"] = body["id"]

    def test_create_master_admin_bad_email_rejected(self, tokens):
        r = requests.post(f"{API}/admin/master-admins",
                          json={"email": "not_cravitoo@example.com",
                                "password": "Pass1234!", "name": "BadMaster"},
                          headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 400

    def test_create_master_admin_valid(self, tokens):
        email = f"test_master_{uuid.uuid4().hex[:6]}@cravitoo.com"
        r = requests.post(f"{API}/admin/master-admins",
                          json={"email": email, "password": "Pass1234!",
                                "name": "TEST Master"},
                          headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 200, r.text
        STATE["master_admin_id"] = r.json()["id"]

    def test_non_master_cannot_list_admins(self, tokens):
        for role in ("site", "vendor", "employee"):
            r = requests.get(f"{API}/admin/admins", headers=H(tokens, role), timeout=10)
            assert r.status_code == 403, f"{role} got {r.status_code}"

    def test_master_list_admins_contains_created(self, tokens):
        r = requests.get(f"{API}/admin/admins", headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 200
        ids = [a["id"] for a in r.json()]
        assert STATE["site_admin_id"] in ids
        assert STATE["super_admin_id"] in ids
        assert STATE["master_admin_id"] in ids

    def test_cannot_delete_seed_admin(self, tokens):
        # find seed admin id
        admins = requests.get(f"{API}/admin/admins",
                              headers=H(tokens, "master"), timeout=10).json()
        seed = next((a for a in admins if a["email"] == "admin@cravitoo.com"), None)
        assert seed, "seed admin not found in list"
        r = requests.delete(f"{API}/admin/admins/{seed['id']}",
                            headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 400, r.text

    def test_site_admin_cannot_delete_admin(self, tokens):
        r = requests.delete(f"{API}/admin/admins/{STATE['site_admin_id']}",
                            headers=H(tokens, "site"), timeout=10)
        assert r.status_code == 403

    def test_delete_created_admins_cleanup(self, tokens):
        for k in ("site_admin_id", "super_admin_id", "master_admin_id"):
            r = requests.delete(f"{API}/admin/admins/{STATE[k]}",
                                headers=H(tokens, "master"), timeout=10)
            assert r.status_code == 200, f"{k}: {r.text}"


# ----------- Reports -----------
class TestReports:
    def test_master_dashboard(self, tokens):
        r = requests.get(f"{API}/reports/master-dashboard",
                         headers=H(tokens, "master"), timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ("total_sites", "total_vendors", "total_users", "total_employees",
                  "total_orders", "paid_orders", "total_revenue", "top_sites", "top_vendors"):
            assert k in body, f"missing {k}"
        assert isinstance(body["top_sites"], list)
        assert isinstance(body["top_vendors"], list)

    def test_master_dashboard_forbidden_for_others(self, tokens):
        for role in ("site", "vendor", "employee"):
            r = requests.get(f"{API}/reports/master-dashboard",
                             headers=H(tokens, role), timeout=10)
            assert r.status_code == 403, f"{role} got {r.status_code}"

    def test_site_report_master(self, tokens):
        r = requests.get(f"{API}/reports/site/{STATE['site_id']}",
                         headers=H(tokens, "master"), timeout=10)
        assert r.status_code == 200
        body = r.json()
        for k in ("total_orders", "paid_orders", "total_revenue", "employees", "vendors"):
            assert k in body

    def test_site_report_vendor_forbidden(self, tokens):
        r = requests.get(f"{API}/reports/site/{STATE['site_id']}",
                         headers=H(tokens, "vendor"), timeout=10)
        assert r.status_code == 403


# ----------- Employee my-site -----------
class TestEmployeeMySite:
    def test_employee_my_site(self, tokens):
        r = requests.get(f"{API}/employee/my-site",
                         headers=H(tokens, "employee"), timeout=10)
        assert r.status_code == 200
        body = r.json()
        for k in ("site", "vendors", "meal_schedule", "current_meal_period", "ordering_modes"):
            assert k in body
        assert isinstance(body["vendors"], list)
        for k in ("pre_order", "cash_carry", "company_paid", "employee_paid"):
            assert k in body["ordering_modes"]

    def test_non_employee_forbidden(self, tokens):
        for role in ("master", "site", "vendor"):
            r = requests.get(f"{API}/employee/my-site",
                             headers=H(tokens, role), timeout=10)
            assert r.status_code == 403


# ----------- AuthZ extra checks -----------
class TestAuthZBoundary:
    def test_employee_cannot_list_admins(self, tokens):
        r = requests.get(f"{API}/admin/admins",
                         headers=H(tokens, "employee"), timeout=10)
        assert r.status_code == 403

    def test_vendor_get_other_site_denied(self, tokens):
        # Unmap first so test is meaningful
        requests.delete(
            f"{API}/sites/{STATE['site_id']}/vendors/{STATE['vendor_id']}",
            headers=H(tokens, "master"), timeout=10,
        )
        r = requests.get(f"{API}/sites/{STATE['site_id']}",
                         headers=H(tokens, "vendor"), timeout=10)
        assert r.status_code == 403


# ----------- Regression of legacy endpoints -----------
class TestRegression:
    def test_get_menu_legacy(self, tokens):
        # GET /menu/vendor/all (vendor-only) — legacy menu listing
        r = requests.get(f"{API}/menu/vendor/all", headers=H(tokens, "vendor"), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_get_orders_legacy(self, tokens):
        r = requests.get(f"{API}/orders", headers=H(tokens, "employee"), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ----------- Cleanup created site -----------
class TestZCleanup:
    def test_delete_created_menu_items(self, tokens):
        # delete every menu item we inserted with TEST_Dish prefix for our site
        items = requests.get(f"{API}/sites/{STATE['site_id']}/menu",
                             headers=H(tokens, "master"), timeout=10).json()
        # only attempt if DELETE menu endpoint exists; ignore failures silently
        for it in items:
            if str(it.get("name", "")).startswith("TEST_Dish"):
                requests.delete(f"{API}/menu/{it['id']}",
                                headers=H(tokens, "master"), timeout=10)
        # Best effort - just ensure call did not crash
        assert True
