"""Test corporate_admin employee-mode switch + vendor order lifecycle collected status."""
import os
import requests
import pytest

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://feedback-analytics-20.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

VENDOR = ("audit_vendor1@corpa.com", "Audit#1234")
CORP_ADMIN = ("audit_corpadmin_a@corpa.com", "Audit#1234")
EMP_A = ("audit_emp_a@corpa.com", "Audit#1234")
EMP_B = ("audit_emp_b@corpb.com", "Audit#1234")


def login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return s


# --- ISSUE 1: Corporate admin employee-mode switch ---
class TestEmployeeModeSwitch:
    def test_corp_admin_can_switch_to_employee_and_back(self):
        s = login(*CORP_ADMIN)
        me = s.get(f"{API}/auth/me").json()
        assert me["role"] == "corporate_admin"

        # Switch on
        r = s.post(f"{API}/auth/employee-mode", json={"on": True})
        assert r.status_code == 200, r.text
        me = s.get(f"{API}/auth/me").json()
        assert me["role"] == "employee", f"Expected employee role, got {me['role']}"
        assert me.get("impersonating_admin") is True
        assert me.get("site_id")  # must resolve site

        # In employee mode: /vendors should work
        r = s.get(f"{API}/vendors")
        assert r.status_code == 200

        # Switch off
        r = s.post(f"{API}/auth/employee-mode", json={"on": False})
        assert r.status_code == 200
        me = s.get(f"{API}/auth/me").json()
        assert me["role"] == "corporate_admin"
        assert not me.get("impersonating_admin")

    def test_normal_employee_cannot_use_employee_mode_as_switch(self):
        # Regression: normal employee doesn't get impersonating_admin flag
        s = login(*EMP_B)
        me = s.get(f"{API}/auth/me").json()
        assert me["role"] == "employee"
        assert not me.get("impersonating_admin")


# --- ISSUE 2: Vendor order lifecycle including 'collected' ---
class TestOrderLifecycleCollected:
    def test_full_lifecycle_pending_to_collected(self):
        # employee places an order
        emp = login(*EMP_A)
        vendors = emp.get(f"{API}/vendors").json()
        assert vendors, "No vendors visible to employee"
        # find vendor 'audit_vendor1' -> match by owner? Just try each until menu has item
        chosen_vendor = None
        chosen_item = None
        for v in vendors:
            menu = emp.get(f"{API}/menu/{v['id']}").json()
            for item in menu:
                if item.get('available', True):
                    chosen_vendor = v
                    chosen_item = item
                    break
            if chosen_item:
                break
        if not chosen_item:
            pytest.skip("No available menu item found to place order")

        payload = {
            "vendor_id": chosen_vendor["id"],
            "items": [{"menu_item_id": chosen_item["id"], "quantity": 1,
                       "name": chosen_item["name"], "price": chosen_item["price"]}],
            "total_amount": chosen_item["price"],
            "payment_method": "cash",
        }
        r = emp.post(f"{API}/orders", json=payload)
        if r.status_code not in (200, 201):
            pytest.skip(f"Order creation not accepted: {r.status_code} {r.text[:200]}")
        order = r.json()
        order_id = order.get("id") or order.get("order_id")
        assert order_id

        # vendor moves it through lifecycle
        vend = login(*VENDOR)
        for status in ("confirmed", "preparing", "ready", "collected"):
            r = vend.patch(f"{API}/orders/{order_id}?status={status}")
            assert r.status_code == 200, f"PATCH {status} failed: {r.status_code} {r.text[:200]}"

        # verify final status
        r = vend.get(f"{API}/orders")
        found = [o for o in r.json() if o["id"] == order_id]
        # order may not appear in vendor list after collected; check employee side
        r2 = emp.get(f"{API}/orders")
        found2 = [o for o in r2.json() if o["id"] == order_id]
        assert found2, "Order missing from employee orders after collect"
        assert found2[0]["status"] == "collected", f"Final status {found2[0]['status']}"

    def test_error_on_terminal_order_is_readable_string(self):
        # try to transition a collected order again — must return string detail
        vend = login(*VENDOR)
        r = vend.get(f"{API}/orders?status=collected")
        # fetch any collected order via broader query
        r2 = vend.get(f"{API}/orders")
        collected = [o for o in r2.json() if o["status"] == "collected"]
        if not collected:
            pytest.skip("No collected orders to test terminal transition")
        oid = collected[0]["id"]
        r = vend.patch(f"{API}/orders/{oid}?status=preparing")
        assert r.status_code in (400, 403, 409, 422), f"Expected error, got {r.status_code}"
        body = r.json()
        detail = body.get("detail")
        # must not be nested [object Object]-like; either string or list of dicts with msg
        if isinstance(detail, list):
            for x in detail:
                assert isinstance(x, dict) and (x.get("msg") or x.get("message")), x
        else:
            assert isinstance(detail, str) and detail.strip(), f"Non-readable detail: {detail}"
