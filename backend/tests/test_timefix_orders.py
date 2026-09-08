"""Tests for duplicate orders and UTC time normalisation fix."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://admin-sales-report.preview.emergentagent.com").rstrip("/")

EMP = {"email": "timefix_emp@cravitoo.com", "password": "Test#1234"}
VEN = {"email": "timefix_vendor@cravitoo.com", "password": "Test#1234"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"no token in response: {data}"
    return token


def test_employee_orders_no_duplicates_and_utc():
    token = _login(EMP)
    r = requests.get(f"{BASE_URL}/api/orders", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 200, r.text
    orders = r.json()
    if isinstance(orders, dict):
        orders = orders.get("orders", orders.get("data", []))
    print(f"Employee orders count: {len(orders)}")
    for o in orders:
        print(f"  code={o.get('collection_code')} created_at={o.get('created_at')} id={o.get('id')}")
    assert len(orders) == 2, f"expected 2 orders, got {len(orders)}"
    codes = [o.get("collection_code") for o in orders]
    assert sorted(codes) == sorted(["CRV-TIMEFIX1", "CRV-TIMEFIX2"]), f"codes: {codes}"
    assert len(set(codes)) == 2, "duplicate collection codes"
    ids = [o.get("id") for o in orders]
    assert len(set(ids)) == 2, f"duplicate order ids: {ids}"
    for o in orders:
        ca = o.get("created_at")
        assert isinstance(ca, str) and ca, f"created_at invalid: {ca}"
        assert ca.endswith("+00:00"), f"created_at not UTC-aware: {ca}"


def test_vendor_orders_no_duplicates():
    token = _login(VEN)
    # Try both /api/orders and /api/vendor/orders
    for path in ["/api/vendor/orders", "/api/orders"]:
        r = requests.get(f"{BASE_URL}{path}", headers={"Authorization": f"Bearer {token}"}, timeout=30)
        if r.status_code == 200:
            orders = r.json()
            if isinstance(orders, dict):
                orders = orders.get("orders", orders.get("data", []))
            print(f"Vendor via {path}: {len(orders)} orders")
            for o in orders:
                print(f"  code={o.get('collection_code')} created_at={o.get('created_at')}")
            assert len(orders) == 2, f"expected 2, got {len(orders)} at {path}"
            codes = [o.get("collection_code") for o in orders]
            assert len(set(codes)) == 2, f"duplicates at {path}: {codes}"
            for o in orders:
                ca = o.get("created_at")
                assert isinstance(ca, str) and ca.endswith("+00:00"), f"created_at not UTC: {ca}"
            return
    pytest.fail("no vendor orders endpoint returned 200")
