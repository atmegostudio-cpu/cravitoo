"""Cravitoo Iteration 3 - New feature tests:
Menu CRUD, Employees, Bulk Orders, Events, Notifications, AI Forecast/Wastage, Loyalty
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://corporate-feast.preview.emergentagent.com").rstrip("/")

CREDS = {
    "super_admin": ("admin@cravitoo.com", "admin123"),
    "master_admin": ("admin@cravitoo.com", "admin123"),
    "corporate_admin": ("demo@techcorp.com", "demo123"),
    "vendor": ("vendor@spicekitchen.com", "vendor123"),
    "employee": ("employee@techcorp.com", "employee123"),
}


def login(role):
    s = requests.Session()
    email, pwd = CREDS[role]
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, f"Login failed for {role}: {r.status_code} {r.text}"
    return s, r.json()


def get_spice_kitchen_and_menu():
    vendors = requests.get(f"{BASE_URL}/api/vendors", timeout=10).json()
    v = next(v for v in vendors if v["name"] == "Spice Kitchen")
    menu = requests.get(f"{BASE_URL}/api/menu/{v['id']}", timeout=10).json()
    return v, menu


# ---- Menu CRUD ----
class TestMenuCRUD:
    def test_vendor_get_all_menu_includes_unavailable(self):
        vs, _ = login("vendor")
        r = vs.get(f"{BASE_URL}/api/menu/vendor/all", timeout=10)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 1

    def test_create_update_delete_menu_item(self):
        # NOTE (iter12): vendor menu CRUD is now master_admin-only. Vendors get 403.
        # We test (a) vendor is blocked, (b) master_admin happy path with vendor_id.
        vs, _ = login("vendor")
        vendor_id = vs.get(f"{BASE_URL}/api/auth/me", timeout=10).json().get("vendor_id")
        # Vendor blocked
        payload = {
            "name": f"TEST_dish_{int(time.time())}",
            "description": "Test item",
            "category": "Appetizer",
            "price": 99.0,
            "is_vegetarian": True,
            "is_available": True,
        }
        vr = vs.post(f"{BASE_URL}/api/menu", json=payload, timeout=10)
        assert vr.status_code == 403, vr.text
        # Master admin happy path
        ms, _ = login("master_admin")
        cr = ms.post(f"{BASE_URL}/api/menu", json={**payload, "vendor_id": vendor_id}, timeout=10)
        assert cr.status_code == 200, cr.text
        item_id = cr.json()["id"]
        # UPDATE — master only
        ur = ms.patch(f"{BASE_URL}/api/menu/{item_id}", json={"price": 120.0, "is_available": False}, timeout=10)
        assert ur.status_code == 200
        # Vendor update blocked
        vur = vs.patch(f"{BASE_URL}/api/menu/{item_id}", json={"price": 10.0}, timeout=10)
        assert vur.status_code == 403
        # Verify update via vendor-all read
        all_items = vs.get(f"{BASE_URL}/api/menu/vendor/all", timeout=10).json()
        found = [i for i in all_items if i["id"] == item_id]
        assert found and found[0]["price"] == 120.0 and found[0]["is_available"] is False
        # Vendor delete blocked
        vdr = vs.delete(f"{BASE_URL}/api/menu/{item_id}", timeout=10)
        assert vdr.status_code == 403
        # Master DELETE
        dr = ms.delete(f"{BASE_URL}/api/menu/{item_id}", timeout=10)
        assert dr.status_code == 200, dr.text
        # Verify deletion
        after = vs.get(f"{BASE_URL}/api/menu/vendor/all", timeout=10).json()
        assert not any(i["id"] == item_id for i in after)

    def test_non_vendor_cannot_access_vendor_all(self):
        es, _ = login("employee")
        r = es.get(f"{BASE_URL}/api/menu/vendor/all", timeout=10)
        assert r.status_code == 403

    def test_non_vendor_cannot_delete_menu_item(self):
        es, _ = login("employee")
        # use a fake but valid ObjectId-like
        r = es.delete(f"{BASE_URL}/api/menu/507f1f77bcf86cd799439011", timeout=10)
        assert r.status_code == 403


# ---- Employee Management ----
class TestEmployees:
    def test_add_list_remove_employee(self):
        cs, _ = login("corporate_admin")
        email = f"TEST_emp_{int(time.time())}@techcorp.com"
        payload = {
            "email": email,
            "password": "TestPass123!",
            "name": "TEST Employee",
            "department": "Engineering",
            "employee_id": "E999",
        }
        cr = cs.post(f"{BASE_URL}/api/companies/employees", json=payload, timeout=10)
        assert cr.status_code == 200, cr.text
        emp_id = cr.json()["id"]
        # LIST
        lr = cs.get(f"{BASE_URL}/api/companies/employees", timeout=10)
        assert lr.status_code == 200
        emps = lr.json()
        assert any(e["id"] == emp_id and e["department"] == "Engineering" for e in emps)
        # DELETE
        dr = cs.delete(f"{BASE_URL}/api/companies/employees/{emp_id}", timeout=10)
        assert dr.status_code == 200
        # Verify removal
        emps2 = cs.get(f"{BASE_URL}/api/companies/employees", timeout=10).json()
        assert not any(e["id"] == emp_id for e in emps2)

    def test_employee_cannot_add_employee(self):
        es, _ = login("employee")
        r = es.post(f"{BASE_URL}/api/companies/employees", json={
            "email": "TEST_x@techcorp.com", "password": "X", "name": "X"
        }, timeout=10)
        assert r.status_code == 403


# ---- Bulk Orders ----
class TestBulkOrders:
    def test_bulk_sponsored_creates_paid_confirmed_orders_with_notifications(self):
        cs, _ = login("corporate_admin")
        v, menu = get_spice_kitchen_and_menu()
        payload = {
            "vendor_id": v["id"],
            "orders": [
                {
                    "user_email": "employee@techcorp.com",
                    "items": [{"menu_item_id": menu[0]["id"], "quantity": 1, "price": menu[0]["price"]}]
                }
            ],
            "delivery_type": "pickup",
            "sponsored": True,
            "occasion": "TEST_TeamLunch",
        }
        r = cs.post(f"{BASE_URL}/api/orders/bulk", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total_amount"] > 0
        assert len(body["orders"]) == 1
        order_id = body["orders"][0]["order_id"]
        # Verify order is confirmed + paid
        es, _ = login("employee")
        orders = es.get(f"{BASE_URL}/api/orders", timeout=10).json()
        target = next((o for o in orders if o["id"] == order_id), None)
        assert target is not None
        assert target["status"] == "confirmed"
        assert target["payment_status"] == "paid"
        # Notification with occasion in message
        notifs = es.get(f"{BASE_URL}/api/notifications", timeout=10).json()
        match = [n for n in notifs if "TEST_TeamLunch" in n.get("message", "")]
        assert len(match) >= 1, f"No notification with occasion found in {[n.get('message') for n in notifs[:5]]}"


# ---- Event Catering ----
class TestEvents:
    def test_create_event_total_calc_and_approve(self):
        cs, _ = login("corporate_admin")
        v, menu = get_spice_kitchen_and_menu()
        item = menu[0]
        payload = {
            "vendor_id": v["id"],
            "event_name": f"TEST_event_{int(time.time())}",
            "event_date": "2026-02-15",
            "headcount": 10,
            "menu_items": [{"menu_item_id": item["id"], "quantity": 2, "price": item["price"]}],
            "notes": "test event",
        }
        cr = cs.post(f"{BASE_URL}/api/events", json=payload, timeout=10)
        assert cr.status_code == 200, cr.text
        body = cr.json()
        event_id = body["id"]
        expected_total = item["price"] * 2 * 10
        assert abs(body["total_amount"] - expected_total) < 0.01
        assert body["status"] == "pending_approval"
        # LIST
        lr = cs.get(f"{BASE_URL}/api/events", timeout=10)
        assert lr.status_code == 200
        events = lr.json()
        assert any(e["id"] == event_id for e in events)
        # APPROVE
        ar = cs.patch(f"{BASE_URL}/api/events/{event_id}/approve", timeout=10)
        assert ar.status_code == 200
        events2 = cs.get(f"{BASE_URL}/api/events", timeout=10).json()
        target = next(e for e in events2 if e["id"] == event_id)
        assert target["status"] == "approved"


# ---- Notifications ----
class TestNotifications:
    def test_new_order_creates_vendor_notification_and_mark_all_read(self):
        # vendor reads existing notifications first
        vs, _ = login("vendor")
        before = vs.get(f"{BASE_URL}/api/notifications", timeout=10).json()
        before_count = len(before)
        # employee creates an order
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        es.post(f"{BASE_URL}/api/orders", json={
            "vendor_id": v["id"],
            "items": [{"menu_item_id": menu[0]["id"], "quantity": 1, "price": menu[0]["price"]}],
            "delivery_type": "pickup",
        }, timeout=15)
        # vendor should now have an additional notification
        after = vs.get(f"{BASE_URL}/api/notifications", timeout=10).json()
        assert len(after) >= before_count + 1
        new_notif = after[0]  # most recent
        assert "New Order" in new_notif.get("title", "")
        assert new_notif.get("read") is False
        # mark single as read
        mr = vs.patch(f"{BASE_URL}/api/notifications/{new_notif['id']}/read", timeout=10)
        assert mr.status_code == 200
        # mark-all-read
        ma = vs.post(f"{BASE_URL}/api/notifications/mark-all-read", timeout=10)
        assert ma.status_code == 200
        all_after = vs.get(f"{BASE_URL}/api/notifications", timeout=10).json()
        unread = [n for n in all_after if not n.get("read")]
        assert len(unread) == 0


# ---- AI Demand Forecast ----
class TestAIForecast:
    def test_demand_forecast_returns_text_and_top_items(self):
        vs, _ = login("vendor")
        r = vs.post(f"{BASE_URL}/api/ai/demand-forecast", timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "forecast" in body
        assert isinstance(body["forecast"], str) and len(body["forecast"]) > 10
        assert "top_items" in body and isinstance(body["top_items"], list)

    def test_non_vendor_blocked_forecast(self):
        es, _ = login("employee")
        r = es.post(f"{BASE_URL}/api/ai/demand-forecast", timeout=10)
        assert r.status_code == 403


# ---- AI Wastage ----
class TestAIWastage:
    def test_wastage_analysis_metrics(self):
        vs, _ = login("vendor")
        r = vs.post(f"{BASE_URL}/api/ai/wastage-analysis", timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "analysis" in body
        assert "metrics" in body
        m = body["metrics"]
        for k in ("total_orders", "completed_orders", "cancelled_orders", "cancellation_rate"):
            assert k in m
        assert m["total_orders"] >= 0


# ---- Loyalty ----
class TestLoyalty:
    def test_loyalty_summary_shape(self):
        es, _ = login("employee")
        r = es.get(f"{BASE_URL}/api/loyalty", timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("tier", "total_spent", "points_earned", "points_redeemed", "available_points"):
            assert k in body
        assert body["tier"] in ("Starter", "Bronze", "Silver", "Gold")

    def test_redeem_insufficient_points_rejected(self):
        es, _ = login("employee")
        # request a huge redemption
        # need an order id
        v, menu = get_spice_kitchen_and_menu()
        oresp = es.post(f"{BASE_URL}/api/orders", json={
            "vendor_id": v["id"],
            "items": [{"menu_item_id": menu[0]["id"], "quantity": 1, "price": menu[0]["price"]}],
            "delivery_type": "pickup",
        }, timeout=15)
        order_id = oresp.json()["id"]
        r = es.post(f"{BASE_URL}/api/loyalty/redeem", json={"points": 999999, "order_id": order_id}, timeout=10)
        assert r.status_code == 400

    def test_redeem_below_minimum_rejected(self):
        es, _ = login("employee")
        v, menu = get_spice_kitchen_and_menu()
        oresp = es.post(f"{BASE_URL}/api/orders", json={
            "vendor_id": v["id"],
            "items": [{"menu_item_id": menu[0]["id"], "quantity": 1, "price": menu[0]["price"]}],
            "delivery_type": "pickup",
        }, timeout=15)
        order_id = oresp.json()["id"]
        r = es.post(f"{BASE_URL}/api/loyalty/redeem", json={"points": 50, "order_id": order_id}, timeout=10)
        assert r.status_code == 400
