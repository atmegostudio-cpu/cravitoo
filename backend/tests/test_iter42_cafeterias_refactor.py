"""Iteration 42 regression tests:
   1) Cafeteria layer (routers/cafeterias.py) - CRUD + vendor mapping/move.
   2) Refactor smoke: routes moved to routers/orders.py + routers/admin.py.
      Ensures no route went missing after the physical move.
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://duplicate-prevention-4.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "admin@cravitoo.com"
ADMIN_PASS = "admin123"
EMP_EMAIL = "timefix_emp@cravitoo.com"
EMP_PASS = "Test#1234"
VENDOR_EMAIL = "timefix_vendor@cravitoo.com"
VENDOR_PASS = "Test#1234"


def _login(email, pw):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASS)}"}


@pytest.fixture(scope="module")
def emp_headers():
    return {"Authorization": f"Bearer {_login(EMP_EMAIL, EMP_PASS)}"}


@pytest.fixture(scope="module")
def vendor_headers():
    return {"Authorization": f"Bearer {_login(VENDOR_EMAIL, VENDOR_PASS)}"}


@pytest.fixture(scope="module")
def demo_site_id(admin_headers):
    r = requests.get(f"{BASE}/api/sites", headers=admin_headers, timeout=20)
    assert r.status_code == 200
    sites = r.json()
    assert sites, "no site available"
    return sites[0]["id"]


# ---------------- CAFETERIA CRUD ----------------
class TestCafeteriaCRUD:
    def test_list_creates_default(self, admin_headers, demo_site_id):
        r = requests.get(f"{BASE}/api/sites/{demo_site_id}/cafeterias", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        cafs = r.json()
        assert isinstance(cafs, list) and len(cafs) >= 1
        defaults = [c for c in cafs if c.get("is_default")]
        assert len(defaults) == 1, f"expected exactly 1 default, got {len(defaults)}"
        d = defaults[0]
        assert d["name"] == "Main Cafeteria"
        assert "vendor_count" in d and isinstance(d["vendor_count"], int)
        assert "id" in d

    def test_create_rename_delete_flow(self, admin_headers, demo_site_id):
        name = f"TEST_Caf_{uuid.uuid4().hex[:6]}"
        # create
        r = requests.post(f"{BASE}/api/sites/{demo_site_id}/cafeterias",
                          json={"name": name, "description": "pytest"},
                          headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        caf = r.json()
        cid = caf["id"]
        assert caf["is_default"] is False
        assert caf["name"] == name

        # duplicate -> 400
        r2 = requests.post(f"{BASE}/api/sites/{demo_site_id}/cafeterias",
                           json={"name": name}, headers=admin_headers, timeout=15)
        assert r2.status_code == 400

        # empty name on rename -> 400
        r3 = requests.patch(f"{BASE}/api/cafeterias/{cid}",
                            json={"name": "   "}, headers=admin_headers, timeout=15)
        assert r3.status_code == 400

        # rename ok
        newname = name + "_R"
        r4 = requests.patch(f"{BASE}/api/cafeterias/{cid}",
                            json={"name": newname}, headers=admin_headers, timeout=15)
        assert r4.status_code == 200
        assert r4.json()["name"] == newname

        # verify via GET
        r5 = requests.get(f"{BASE}/api/sites/{demo_site_id}/cafeterias", headers=admin_headers, timeout=15)
        assert any(c["id"] == cid and c["name"] == newname for c in r5.json())

        # delete
        rd = requests.delete(f"{BASE}/api/cafeterias/{cid}", headers=admin_headers, timeout=15)
        assert rd.status_code == 200

        # confirm gone
        r6 = requests.get(f"{BASE}/api/sites/{demo_site_id}/cafeterias", headers=admin_headers, timeout=15)
        assert not any(c["id"] == cid for c in r6.json())

    def test_default_cannot_be_deleted(self, admin_headers, demo_site_id):
        r = requests.get(f"{BASE}/api/sites/{demo_site_id}/cafeterias", headers=admin_headers, timeout=15)
        default = next(c for c in r.json() if c["is_default"])
        rd = requests.delete(f"{BASE}/api/cafeterias/{default['id']}", headers=admin_headers, timeout=15)
        assert rd.status_code == 400

    def test_default_cannot_be_deactivated(self, admin_headers, demo_site_id):
        r = requests.get(f"{BASE}/api/sites/{demo_site_id}/cafeterias", headers=admin_headers, timeout=15)
        default = next(c for c in r.json() if c["is_default"])
        r2 = requests.patch(f"{BASE}/api/cafeterias/{default['id']}",
                            json={"is_active": False}, headers=admin_headers, timeout=15)
        assert r2.status_code == 400


# ---------------- REFACTOR SMOKE: ORDERS ROUTER ----------------
class TestOrdersRouter:
    def test_payment_mode_config(self, emp_headers):
        r = requests.get(f"{BASE}/api/config/payment-mode", headers=emp_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "mode" in data
        assert data["mode"] in ("RAZORPAY", "OFFLINE")

    def test_employee_orders_utc_aware(self, emp_headers):
        r = requests.get(f"{BASE}/api/orders", headers=emp_headers, timeout=15)
        assert r.status_code == 200
        orders = r.json()
        assert isinstance(orders, list)
        # timefix emp should have >=2 paid orders
        assert len(orders) >= 2
        for o in orders:
            ca = o.get("created_at")
            assert isinstance(ca, str) and ca.endswith("+00:00"), f"created_at not UTC-aware: {ca}"

    def test_vendor_orders_scoped(self, vendor_headers):
        r = requests.get(f"{BASE}/api/orders", headers=vendor_headers, timeout=15)
        assert r.status_code == 200
        orders = r.json()
        assert isinstance(orders, list)

    def test_mark_paid_already_paid_returns_409(self, admin_headers, emp_headers):
        r = requests.get(f"{BASE}/api/orders", headers=emp_headers, timeout=15)
        orders = r.json()
        paid = [o for o in orders if o.get("payment_status") == "paid"]
        if not paid:
            pytest.skip("no paid orders to test")
        oid = paid[0]["id"]
        r2 = requests.post(f"{BASE}/api/orders/{oid}/mark-paid",
                           json={"method": "physical_qr"},
                           headers=admin_headers, timeout=15)
        assert r2.status_code == 409, f"expected 409, got {r2.status_code}: {r2.text}"

    def test_reconciliation_buckets(self, admin_headers):
        r = requests.get(f"{BASE}/api/admin/orders/reconciliation", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "payment_mode" in data
        assert "buckets" in data
        expected = {"total", "pending", "cash", "physical_qr", "paid", "unpaid",
                    "ready_for_collection", "collected", "cancelled"}
        present = set(data["buckets"].keys())
        missing = expected - present
        assert not missing, f"reconciliation missing buckets: {missing}. keys={present}"
        assert len(expected) == 9  # spec: 9 buckets
        for k in expected:
            b = data["buckets"][k]
            assert "count" in b and "amount" in b

    def test_orders_last(self, emp_headers):
        r = requests.get(f"{BASE}/api/orders/last", headers=emp_headers, timeout=15)
        assert r.status_code in (200, 404)

    def test_razorpay_checkout_intent_exists(self, emp_headers):
        # Just verify route is wired; body may 400 on missing items but must not 404.
        r = requests.post(f"{BASE}/api/payments/razorpay/checkout-intent",
                          json={}, headers=emp_headers, timeout=20)
        assert r.status_code != 404, "checkout-intent route missing"


# ---------------- REFACTOR SMOKE: ADMIN ROUTER ----------------
class TestAdminRouter:
    def test_reconciliation_requires_master(self, emp_headers):
        r = requests.get(f"{BASE}/api/admin/orders/reconciliation", headers=emp_headers, timeout=15)
        assert r.status_code == 403

    def test_commission_patch_requires_master(self, emp_headers):
        r = requests.patch(f"{BASE}/api/admin/vendors/deadbeef/commission",
                           json={"commission_percentage": 5}, headers=emp_headers, timeout=15)
        assert r.status_code == 403

    def test_vendor_patch_requires_master(self, emp_headers):
        r = requests.patch(f"{BASE}/api/admin/vendors/deadbeef",
                           json={"name": "x"}, headers=emp_headers, timeout=15)
        assert r.status_code == 403

    def test_sanitize_mappings_master(self, admin_headers):
        r = requests.post(f"{BASE}/api/admin/vendor-site-mappings/sanitize",
                          headers=admin_headers, timeout=30)
        assert r.status_code == 200

    def test_backfill_orders_master(self, admin_headers):
        r = requests.post(f"{BASE}/api/admin/integrity/backfill-orders",
                          headers=admin_headers, timeout=30)
        assert r.status_code == 200

    def test_backfill_sites_master(self, admin_headers):
        r = requests.post(f"{BASE}/api/admin/integrity/backfill-sites",
                          headers=admin_headers, timeout=30)
        assert r.status_code == 200

    def test_backfill_employee_sites_master(self, admin_headers):
        r = requests.post(f"{BASE}/api/admin/integrity/backfill-employee-sites",
                          headers=admin_headers, timeout=30)
        assert r.status_code == 200

    def test_employee_menu_report(self, admin_headers):
        r = requests.get(f"{BASE}/api/admin/integrity/employee-menu-report",
                         headers=admin_headers, timeout=30)
        assert r.status_code == 200

    def test_employee_visibility(self, admin_headers):
        r = requests.get(f"{BASE}/api/admin/integrity/employee-visibility",
                         params={"email": EMP_EMAIL},
                         headers=admin_headers, timeout=30)
        assert r.status_code == 200

    def test_admin_routes_unauth(self):
        # no token => 401 (or 403 if middleware). Accept either.
        r = requests.get(f"{BASE}/api/admin/orders/reconciliation", timeout=15)
        assert r.status_code in (401, 403)


# ---------------- CAFETERIA VENDOR ASSIGNMENT ----------------
class TestCafeteriaVendorAssignment:
    def test_list_site_vendors_includes_cafeteria_fields(self, admin_headers, demo_site_id):
        r = requests.get(f"{BASE}/api/sites/{demo_site_id}/vendors", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        vendors = r.json()
        assert isinstance(vendors, list)
        # If any vendors exist, each must expose cafeteria_id + cafeteria_name.
        for v in vendors:
            assert "cafeteria_id" in v, f"vendor {v.get('id')} missing cafeteria_id"
            assert "cafeteria_name" in v, f"vendor {v.get('id')} missing cafeteria_name"


# ---------------- REGRESSION: EMPLOYEE / VENDOR SCOPING ----------------
class TestOrderScopingRegression:
    def test_employee_sees_own_orders_only(self, emp_headers):
        r = requests.get(f"{BASE}/api/orders", headers=emp_headers, timeout=15)
        assert r.status_code == 200
        orders = r.json()
        # timefix seed = exactly 2
        assert len(orders) == 2, f"expected 2 orders for timefix emp, got {len(orders)}"
        codes = {o.get("collection_code") for o in orders}
        assert codes == {"CRV-TIMEFIX1", "CRV-TIMEFIX2"}

    def test_vendor_sees_own_orders(self, vendor_headers):
        r = requests.get(f"{BASE}/api/orders", headers=vendor_headers, timeout=15)
        assert r.status_code == 200
        orders = r.json()
        assert len(orders) >= 2
