"""Backend regression tests for the 5:30 IST timezone drift bug.

The bug was that /api/vendor/all-outlets-orders and vendor sales report endpoints
returned created_at as timezone-NAIVE ISO strings. Browsers then parsed those UTC
values as local time, causing a 5:30 shift. Fix normalises to '+00:00'.
"""
import os
import re
import requests
import pytest
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
OP_EMAIL = "tz_operator@cravitoo.com"
OP_PASSWORD = "Pass1234"

TZ_SUFFIX_RE = re.compile(r".*(\+00:00|Z)$")


@pytest.fixture(scope="module")
def operator_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": OP_EMAIL, "password": OP_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Operator login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"No token in login response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def operator_client(operator_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {operator_token}",
                      "Content-Type": "application/json"})
    return s


class TestAllOutletsFeedTZ:
    """BUG 1 — All-Outlets Live Orders feed must return tz-aware created_at."""

    def test_all_outlets_orders_created_at_is_tz_aware(self, operator_client):
        r = operator_client.get(f"{BASE_URL}/api/vendor/all-outlets-orders", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "orders" in data
        assert "outlets" in data
        orders = data["orders"]
        assert isinstance(orders, list)
        if not orders:
            pytest.skip("No orders in the operator feed to validate")

        # Every created_at must end with +00:00 (tz-aware)
        naive = [o for o in orders
                 if o.get("created_at") and not TZ_SUFFIX_RE.match(o["created_at"])]
        assert not naive, f"Found {len(naive)} orders with naive created_at: " \
                          f"{[o['created_at'] for o in naive[:3]]}"

        # ready_at / collected_at, if present, also tz-aware
        for o in orders:
            for field in ("ready_at", "collected_at"):
                v = o.get(field)
                if v:
                    assert TZ_SUFFIX_RE.match(v), \
                        f"{field} not tz-aware: {v} (order {o.get('id')})"

    def test_all_outlets_orders_have_outlet_tag_and_multi_outlet(self, operator_client):
        r = operator_client.get(f"{BASE_URL}/api/vendor/all-outlets-orders", timeout=30)
        assert r.status_code == 200
        data = r.json()
        outlets = data["outlets"]
        assert len(outlets) >= 2, f"Operator should have multiple outlets, got {outlets}"
        # every order tagged with outlet name
        for o in data["orders"]:
            assert o.get("outlet"), f"Order missing outlet tag: {o.get('id')}"
            assert o.get("vendor_id") in [x["id"] for x in outlets]


class TestCrossPanelSync:
    """Same order created_at must match across /api/orders (vendor view) and
    /api/vendor/all-outlets-orders (feed). No 5:30 drift."""

    def test_created_at_matches_between_vendor_orders_and_all_outlets(self, operator_client):
        feed = operator_client.get(f"{BASE_URL}/api/vendor/all-outlets-orders", timeout=30)
        assert feed.status_code == 200
        feed_orders = feed.json()["orders"]
        if not feed_orders:
            pytest.skip("No orders to cross-check")

        # Pick the first feed order and switch operator into that outlet
        target = feed_orders[0]
        target_vendor_id = target["vendor_id"]
        target_code = target["collection_code"]
        target_created = target["created_at"]

        sw = operator_client.post(f"{BASE_URL}/api/vendor/switch-outlet",
                                  json={"vendor_id": target_vendor_id}, timeout=30)
        assert sw.status_code in (200, 204), f"switch-outlet failed: {sw.status_code} {sw.text}"

        # Fetch vendor orders and locate the same collection_code
        vo = operator_client.get(f"{BASE_URL}/api/orders", timeout=30)
        assert vo.status_code == 200, vo.text
        payload = vo.json()
        vendor_orders = payload.get("orders", payload) if isinstance(payload, dict) else payload
        match = next((x for x in vendor_orders
                      if x.get("collection_code") == target_code), None)
        assert match, f"Collection code {target_code} not found in /api/orders"

        vo_created = match.get("created_at")
        assert vo_created, "vendor order has no created_at"

        # Both must be tz-aware
        assert TZ_SUFFIX_RE.match(vo_created), f"/api/orders naive: {vo_created}"
        assert TZ_SUFFIX_RE.match(target_created), f"all-outlets naive: {target_created}"

        # And represent the same instant
        from datetime import datetime
        a = datetime.fromisoformat(vo_created.replace("Z", "+00:00"))
        b = datetime.fromisoformat(target_created.replace("Z", "+00:00"))
        drift = abs((a - b).total_seconds())
        assert drift < 2, f"Cross-panel drift {drift}s between vendor and all-outlets " \
                          f"({vo_created} vs {target_created})"


class TestSalesReportTZ:
    """BUG 2 — Paginated sales report + CSV export tz-aware."""

    def test_paginated_sales_report_created_at_tz_aware(self, operator_client):
        # operator is currently switched into some vendor from prior test; if not, this
        # still works because switch-outlet set active_vendor_id. If the operator has never
        # switched, fall back to first assigned outlet via all-outlets feed.
        r = operator_client.get(f"{BASE_URL}/api/vendor/reports/sales-orders?page=1&size=20",
                                timeout=30)
        if r.status_code == 403:
            # Need to switch into an outlet first
            f = operator_client.get(f"{BASE_URL}/api/vendor/all-outlets-orders", timeout=30)
            outlets = f.json().get("outlets", [])
            if outlets:
                operator_client.post(f"{BASE_URL}/api/vendor/switch-outlet",
                                     json={"vendor_id": outlets[0]["id"]}, timeout=30)
            r = operator_client.get(f"{BASE_URL}/api/vendor/reports/sales-orders?page=1&size=20",
                                    timeout=30)
        assert r.status_code == 200, r.text
        rows = r.json().get("rows", [])
        if not rows:
            pytest.skip("No sales rows to validate")
        naive = [row for row in rows
                 if row.get("created_at") and not TZ_SUFFIX_RE.match(row["created_at"])]
        assert not naive, f"Naive created_at in paginated sales: " \
                          f"{[r['created_at'] for r in naive[:3]]}"

    def test_csv_export_created_at_tz_aware(self, operator_client):
        r = operator_client.get(
            f"{BASE_URL}/api/vendor/reports/sales-export?format=csv", timeout=60)
        if r.status_code == 403:
            f = operator_client.get(f"{BASE_URL}/api/vendor/all-outlets-orders", timeout=30)
            outlets = f.json().get("outlets", [])
            if outlets:
                operator_client.post(f"{BASE_URL}/api/vendor/switch-outlet",
                                     json={"vendor_id": outlets[0]["id"]}, timeout=30)
            r = operator_client.get(
                f"{BASE_URL}/api/vendor/reports/sales-export?format=csv", timeout=60)
        assert r.status_code == 200, r.text
        text = r.text
        lines = text.splitlines()
        assert lines, "empty CSV"
        header = lines[0]
        assert "Date & Time (UTC)" in header, f"Unexpected CSV header: {header}"
        if len(lines) > 1:
            import csv as _csv
            reader = _csv.reader(lines)
            _hdr = next(reader)
            data_row = next(reader, None)
            if data_row:
                ts = data_row[0]
                assert TZ_SUFFIX_RE.match(ts), f"CSV timestamp not tz-aware: {ts}"
