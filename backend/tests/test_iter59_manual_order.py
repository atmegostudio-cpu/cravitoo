"""Iteration 59 — Vendor Manual Order (non-corporate walk-in)
Covers:
  * GET /api/customer-types (seeds defaults if empty)
  * POST /api/vendor/manual-order (happy path + RBAC + validation)
  * Manual order appears in /api/orders with customer_type + is_manual
  * Sales Report rolls up under MO Client/MO Site/MO Vendor
  * Admin customer-types CRUD (master only)
"""
import os
import requests
import pytest
from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

VENDOR = {"email": "movendor@x.com", "password": "vpass123"}
ADMIN = {"email": "admin@cravitoo.com", "password": "admin123"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def vendor_session():
    return _login(VENDOR)


@pytest.fixture(scope="module")
def admin_session():
    return _login(ADMIN)


# ── Customer types ────────────────────────────────────────────────────────
class TestCustomerTypes:
    def test_list_customer_types_seeded(self, vendor_session):
        r = vendor_session.get(f"{API}/customer-types", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 5
        names = {t["name"] for t in data}
        for expected in ["Guest", "Housekeeping", "Security", "Drivers", "Facility Management"]:
            assert expected in names, f"missing seeded type: {expected}"
        for t in data:
            assert "id" in t and "name" in t

    def test_admin_add_and_delete_customer_type(self, admin_session):
        test_name = "TEST_Interns"
        # Cleanup any prior
        listing = admin_session.get(f"{API}/customer-types").json()
        for t in listing:
            if t["name"] == test_name:
                admin_session.delete(f"{API}/admin/customer-types/{t['id']}")

        r = admin_session.post(f"{API}/admin/customer-types", json={"name": test_name})
        assert r.status_code == 200, r.text
        listing = admin_session.get(f"{API}/customer-types").json()
        found = [t for t in listing if t["name"] == test_name]
        assert len(found) == 1
        tid = found[0]["id"]

        r = admin_session.delete(f"{API}/admin/customer-types/{tid}")
        assert r.status_code == 200
        listing = admin_session.get(f"{API}/customer-types").json()
        assert not any(t["name"] == test_name for t in listing)

    def test_non_master_cannot_add_customer_type(self, vendor_session):
        r = vendor_session.post(f"{API}/admin/customer-types", json={"name": "TEST_Nope"})
        assert r.status_code == 403

    def test_non_master_cannot_delete_customer_type(self, vendor_session, admin_session):
        listing = admin_session.get(f"{API}/customer-types").json()
        tid = listing[0]["id"]
        r = vendor_session.delete(f"{API}/admin/customer-types/{tid}")
        assert r.status_code == 403


# ── Vendor manual order ───────────────────────────────────────────────────
class TestManualOrder:
    @pytest.fixture(scope="class")
    def menu(self, vendor_session):
        me = vendor_session.get(f"{API}/auth/me").json()
        vid = me.get("vendor_id")
        assert vid, f"vendor account has no vendor_id: {me}"
        r = vendor_session.get(f"{API}/menu/{vid}")
        assert r.status_code == 200, r.text
        items = r.json()
        by_name = {i["name"]: i for i in items}
        assert "Veg Meal" in by_name and "Coffee" in by_name, f"MO menu missing items: {[i['name'] for i in items]}"
        return by_name

    def test_manual_order_happy_path(self, vendor_session, menu):
        veg = menu["Veg Meal"]
        coffee = menu["Coffee"]
        payload = {
            "customer_type": "Guest",
            "items": [
                {"menu_item_id": veg["id"], "quantity": 2, "price": veg["price"]},
                {"menu_item_id": coffee["id"], "quantity": 1, "price": coffee["price"]},
            ],
            "mark_paid": True,
            "payment_method": "physical_qr",
        }
        r = vendor_session.post(f"{API}/vendor/manual-order", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["payment_status"] == "paid"
        assert data["customer_type"] == "Guest"
        assert float(data["total_amount"]) == 280.0
        assert data["collection_code"].startswith("CRV-")
        assert "id" in data
        # Also verify it shows in /api/orders
        orders = vendor_session.get(f"{API}/orders").json()
        match = [o for o in orders if o.get("id") == data["id"] or o.get("_id") == data["id"]]
        # order id can be projected as id or "id" depending on serializer; do broader search
        found = next((o for o in orders if o.get("collection_code") == data["collection_code"]), None)
        assert found is not None, "manual order not visible in /api/orders"
        assert found.get("is_manual") is True
        assert found.get("customer_type") == "Guest"
        assert found.get("payment_status") == "paid"

    def test_unknown_customer_type_400(self, vendor_session, menu):
        veg = menu["Veg Meal"]
        r = vendor_session.post(f"{API}/vendor/manual-order", json={
            "customer_type": "NotARealType",
            "items": [{"menu_item_id": veg["id"], "quantity": 1, "price": veg["price"]}],
        })
        assert r.status_code == 400

    def test_wrong_site_id_403(self, vendor_session, admin_session, menu):
        # Grab a site that is NOT MO Site
        sites = admin_session.get(f"{API}/sites").json()
        me = vendor_session.get(f"{API}/auth/me").json()
        maps = admin_session.get(f"{API}/vendors/{me['vendor_id']}/mappings")
        my_site_ids = set()
        if maps.status_code == 200:
            for m in maps.json():
                if m.get("site_id"):
                    my_site_ids.add(str(m["site_id"]))
        other = next((s for s in sites if str(s.get("id") or s.get("_id")) not in my_site_ids), None)
        if not other:
            pytest.skip("No other site to test cross-site rejection")
        veg = menu["Veg Meal"]
        r = vendor_session.post(f"{API}/vendor/manual-order", json={
            "customer_type": "Guest",
            "site_id": other.get("id") or other.get("_id"),
            "items": [{"menu_item_id": veg["id"], "quantity": 1, "price": veg["price"]}],
        })
        assert r.status_code == 403, r.text

    def test_master_admin_cannot_punch(self, admin_session, vendor_session, menu):
        veg = menu["Veg Meal"]
        r = admin_session.post(f"{API}/vendor/manual-order", json={
            "customer_type": "Guest",
            "items": [{"menu_item_id": veg["id"], "quantity": 1, "price": veg["price"]}],
        })
        assert r.status_code == 403


# ── Sales report roll-up ──────────────────────────────────────────────────
class TestSalesReport:
    def test_sales_report_includes_manual_order(self, admin_session):
        r = admin_session.get(f"{API}/admin/sales-report",
                              params={"start": "2026-06-01", "end": "2026-12-31"})
        assert r.status_code == 200, r.text
        data = r.json()
        # dump keys for context
        rows = data.get("rows") or data.get("data") or data.get("items") or data
        text_blob = str(data)
        assert "MO Client" in text_blob, f"MO Client not found in sales report: {text_blob[:500]}"
        assert "MO Vendor" in text_blob or "MO Site" in text_blob
