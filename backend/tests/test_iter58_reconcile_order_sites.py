"""iter58 – reconcile-order-sites endpoint regression.

Tests POST /api/admin/integrity/reconcile-order-sites.

Scenario setup (all TEST_ prefixed, cleaned in test_zz_cleanup):
  - Two clients (ClientA / ClientB), two cities (CityA / CityB), two sites
    (SiteA linked to ClientA+CityA, SiteB to ClientB+CityB) — created via API.
  - Vendor V (single-mapped to SiteA)   — 2 orders wrongly stamped site=SiteB,
                                          1 order already correct at SiteA.
  - Vendor W (multi-mapped to A and B)  — 1 order at SiteB must remain.
  - Vendor U (no active mapping)        — 1 order at SiteB must remain.
  Vendors/mappings/orders inserted directly via Mongo.
Also verifies:
  - RBAC: employee and vendor users get 403.
  - Idempotency: 2nd run reconciles 0.
  - Regression: sales-report/filters returns 200; site_summary totals equal
    the sum of vendor_summary per site (post-reconcile).
"""
import os
import uuid
import time
import asyncio
import pytest
import requests
from datetime import datetime, timezone
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

import sys
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
from server import hash_password  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

UID = uuid.uuid4().hex[:6]
CLIENT_A_NAME = f"TEST_ClientA_{UID}"
CLIENT_B_NAME = f"TEST_ClientB_{UID}"
CITY_A_NAME = f"TEST_CityA_{UID}"
CITY_B_NAME = f"TEST_CityB_{UID}"
SITE_A_NAME = f"TEST_SiteA_{UID}"
SITE_B_NAME = f"TEST_SiteB_{UID}"
VENDOR_V_NAME = f"TEST_VendorV_{UID}"
VENDOR_W_NAME = f"TEST_VendorW_{UID}"
VENDOR_U_NAME = f"TEST_VendorU_{UID}"
EMP_EMAIL = f"iter58_emp_{UID}@example.com"
VEN_EMAIL = f"iter58_ven_{UID}@example.com"

state = {}  # holds created ids across tests


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login",
               json={"email": "admin@cravitoo.com", "password": "admin123"})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def db():
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# 01 – seed clients/cities/sites via API
# ---------------------------------------------------------------------------
def test_01_seed_clients_cities_sites(admin_session):
    # Clients
    for key, name in [("clientA", CLIENT_A_NAME), ("clientB", CLIENT_B_NAME)]:
        r = admin_session.post(f"{API}/master/corporate-clients", json={
            "name": name,
            "address": "123 Test St",
            "contact_email": f"{key}_{UID}@example.com",
            "contact_phone": "9999999999",
        })
        assert r.status_code in (200, 201), f"client create failed: {r.status_code} {r.text}"
        state[key] = r.json()["id"]

    # Cities
    for key, name in [("cityA", CITY_A_NAME), ("cityB", CITY_B_NAME)]:
        r = admin_session.post(f"{API}/cities", json={
            "name": name, "state": "TestState",
        })
        assert r.status_code in (200, 201), f"city create failed: {r.status_code} {r.text}"
        state[key] = r.json()["id"]

    # Sites
    for key, name, comp, city in [
        ("siteA", SITE_A_NAME, "clientA", "cityA"),
        ("siteB", SITE_B_NAME, "clientB", "cityB"),
    ]:
        r = admin_session.post(f"{API}/sites", json={
            "name": name,
            "company_id": state[comp],
            "city_id": state[city],
            "address": "1 Cafeteria Rd",
            "city": name.split("_")[1],
            "contact_email": f"{key}_{UID}@example.com",
            "contact_phone": "8888888888",
        })
        assert r.status_code in (200, 201), f"site create failed: {r.status_code} {r.text}"
        state[key] = r.json()["id"]

    assert state["siteA"] and state["siteB"] and state["siteA"] != state["siteB"]


# ---------------------------------------------------------------------------
# 02 – seed vendors, vendor_site_mappings and orders directly in Mongo
# ---------------------------------------------------------------------------
def test_02_seed_vendors_mappings_orders(db):
    async def _do():
        now = datetime.now(timezone.utc)

        # Vendors
        vV = await db.vendors.insert_one({
            "name": VENDOR_V_NAME, "status": "active", "created_at": now,
            "cuisine_type": "Test", "description": "single-mapped vendor",
        })
        vW = await db.vendors.insert_one({
            "name": VENDOR_W_NAME, "status": "active", "created_at": now,
            "cuisine_type": "Test", "description": "multi-mapped vendor",
        })
        vU = await db.vendors.insert_one({
            "name": VENDOR_U_NAME, "status": "active", "created_at": now,
            "cuisine_type": "Test", "description": "unmapped vendor",
        })
        state["vendorV"] = str(vV.inserted_id)
        state["vendorW"] = str(vW.inserted_id)
        state["vendorU"] = str(vU.inserted_id)

        # Mappings
        await db.vendor_site_mappings.insert_many([
            {"vendor_id": state["vendorV"], "site_id": state["siteA"],
             "status": "active", "created_at": now},
            {"vendor_id": state["vendorW"], "site_id": state["siteA"],
             "status": "active", "created_at": now},
            {"vendor_id": state["vendorW"], "site_id": state["siteB"],
             "status": "active", "created_at": now},
        ])

        # Orders
        def mk_order(vendor_id, site_id, amount, code):
            return {
                "vendor_id": vendor_id,
                "site_id": site_id,
                "company_id": None,   # deliberately stale; endpoint must repopulate
                "city_id": None,
                "employee_email": "iter58@example.com",
                "employee_name": "Iter58 Emp",
                "items": [{"name": "Idli", "quantity": 1, "price": amount}],
                "total_amount": amount,
                "status": "delivered",
                "payment_status": "paid",
                "payment_method": "razorpay",
                "created_at": now,
                "order_code": f"CRV-ITER58-{code}",
            }

        orders = [
            # V: 2 wrong (SiteB), 1 correct (SiteA)
            mk_order(state["vendorV"], state["siteB"], 100.0, f"V1-{UID}"),
            mk_order(state["vendorV"], state["siteB"], 250.0, f"V2-{UID}"),
            mk_order(state["vendorV"], state["siteA"], 400.0, f"V3-{UID}"),
            # W: 1 at SiteB (must remain – multi-mapped)
            mk_order(state["vendorW"], state["siteB"], 500.0, f"W1-{UID}"),
            # U: 1 at SiteB (must remain – no active mapping)
            mk_order(state["vendorU"], state["siteB"], 600.0, f"U1-{UID}"),
        ]
        res = await db.orders.insert_many(orders)
        state["order_ids"] = [str(x) for x in res.inserted_ids]
        (state["oV_wrong1"], state["oV_wrong2"], state["oV_correct"],
         state["oW"], state["oU"]) = state["order_ids"]
    _run(_do())
    assert state.get("vendorV") and len(state["order_ids"]) == 5


# ---------------------------------------------------------------------------
# 03 – call reconcile endpoint (first run)
# ---------------------------------------------------------------------------
def test_03_reconcile_first_run(admin_session):
    r = admin_session.post(f"{API}/admin/integrity/reconcile-order-sites")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("success") is True
    # We only assert about OUR seeded orders; the endpoint scans all orders,
    # so `scanned` and `skipped` reflect the whole DB. We check reconciled >= 2
    # and that OUR two wrong V orders are now at SiteA.
    assert body["reconciled"] >= 2, body
    assert "skipped_ambiguous_or_unmapped" in body
    state["first_run"] = body


def test_04_vendorV_wrong_orders_moved_to_siteA(db):
    async def _do():
        for oid in (state["oV_wrong1"], state["oV_wrong2"]):
            o = await db.orders.find_one({"_id": ObjectId(oid)})
            assert o["site_id"] == state["siteA"], f"order {oid} still at wrong site: {o.get('site_id')}"
            assert o["company_id"] == state["clientA"], o
            assert o["city_id"] == state["cityA"], o
    _run(_do())


def test_05_vendorV_already_correct_order_unchanged(db):
    async def _do():
        o = await db.orders.find_one({"_id": ObjectId(state["oV_correct"])})
        assert o["site_id"] == state["siteA"]
        # company/city may have been backfilled since it matched target site
        # (endpoint updates when meta present); acceptable.
    _run(_do())


def test_06_vendorW_multi_mapped_order_untouched(db):
    async def _do():
        o = await db.orders.find_one({"_id": ObjectId(state["oW"])})
        assert o["site_id"] == state["siteB"], \
            f"multi-mapped vendor's order was moved! now at {o.get('site_id')}"
        # company_id/city_id must remain untouched (None as seeded)
        assert o.get("company_id") in (None, "",), o
    _run(_do())


def test_07_vendorU_unmapped_order_untouched(db):
    async def _do():
        o = await db.orders.find_one({"_id": ObjectId(state["oU"])})
        assert o["site_id"] == state["siteB"]
        assert o.get("company_id") in (None, "",), o
    _run(_do())


# ---------------------------------------------------------------------------
# 08 – idempotency: 2nd run for OUR data should not touch our orders again
# ---------------------------------------------------------------------------
def test_08_idempotent_second_run(admin_session, db):
    # snapshot our order site_ids
    async def _snap():
        snap = {}
        for oid in state["order_ids"]:
            o = await db.orders.find_one({"_id": ObjectId(oid)})
            snap[oid] = (o.get("site_id"), o.get("company_id"), o.get("city_id"))
        return snap
    before = _run(_snap())

    r = admin_session.post(f"{API}/admin/integrity/reconcile-order-sites")
    assert r.status_code == 200, r.text
    after = _run(_snap())
    assert before == after, f"idempotency violated: before={before} after={after}"


# ---------------------------------------------------------------------------
# 09 – RBAC: employee and vendor users get 403
# ---------------------------------------------------------------------------
def test_09_rbac_employee_and_vendor_forbidden(db):
    # Create ephemeral employee + vendor users directly in mongo
    async def _mk_users():
        now = datetime.now(timezone.utc)
        emp_hash = hash_password("Emp#12345")
        ven_hash = hash_password("Ven#12345")
        emp = await db.users.insert_one({
            "email": EMP_EMAIL, "name": "Iter58 Emp",
            "password_hash": emp_hash, "role": "employee",
            "site_id": state["siteA"], "company_id": state["clientA"],
            "city_id": state["cityA"], "status": "active",
            "created_at": now,
        })
        ven = await db.users.insert_one({
            "email": VEN_EMAIL, "name": "Iter58 Vendor",
            "password_hash": ven_hash, "role": "vendor",
            "vendor_id": state["vendorV"], "status": "active",
            "created_at": now,
        })
        state["emp_user_id"] = str(emp.inserted_id)
        state["ven_user_id"] = str(ven.inserted_id)
    _run(_mk_users())

    for email, pw, label in [
        (EMP_EMAIL, "Emp#12345", "employee"),
        (VEN_EMAIL, "Ven#12345", "vendor"),
    ]:
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
        assert r.status_code == 200, f"{label} login failed: {r.status_code} {r.text}"
        tok = r.json()["access_token"]
        s.headers.update({"Authorization": f"Bearer {tok}"})
        rr = s.post(f"{API}/admin/integrity/reconcile-order-sites")
        assert rr.status_code == 403, \
            f"{label} should get 403, got {rr.status_code}: {rr.text}"


# ---------------------------------------------------------------------------
# 10 – regression: sales-report filters + summary totals invariant
# ---------------------------------------------------------------------------
def test_10_sales_report_filters_ok(admin_session):
    r = admin_session.get(f"{API}/admin/sales-report/filters")
    assert r.status_code == 200, r.text


def test_11_site_totals_equal_sum_of_vendor_totals(admin_session):
    r = admin_session.get(f"{API}/admin/sales-report")
    assert r.status_code == 200, r.text
    data = r.json()
    site_summary = data.get("site_summary") or []
    vendor_summary = data.get("vendor_summary") or []
    # sum vendor totals per site name and compare to site_summary
    vend_by_site = {}
    for v in vendor_summary:
        vend_by_site[v["site"]] = round(vend_by_site.get(v["site"], 0.0) + v["total"], 2)
    for s in site_summary:
        expected = round(vend_by_site.get(s["site"], 0.0), 2)
        # allow tiny fp drift
        assert abs(expected - round(s["total"], 2)) < 0.01, \
            f"site {s['site']}: site_summary total={s['total']} vs sum(vendor_summary)={expected}"


# ---------------------------------------------------------------------------
# zz – cleanup
# ---------------------------------------------------------------------------
def test_zz_cleanup(admin_session, db):
    async def _do():
        # orders
        if state.get("order_ids"):
            await db.orders.delete_many({"_id": {"$in": [ObjectId(x) for x in state["order_ids"]]}})
        # vendor mappings + vendors
        for vk in ("vendorV", "vendorW", "vendorU"):
            if state.get(vk):
                await db.vendor_site_mappings.delete_many({"vendor_id": state[vk]})
                await db.vendors.delete_one({"_id": ObjectId(state[vk])})
        # ephemeral users
        for uk in ("emp_user_id", "ven_user_id"):
            if state.get(uk):
                await db.users.delete_one({"_id": ObjectId(state[uk])})
    _run(_do())

    # Delete sites (via API) — use cascade at client level for full sweep
    for k in ("siteA", "siteB"):
        if state.get(k):
            admin_session.delete(f"{API}/sites/{state[k]}")
    for k in ("clientA", "clientB"):
        if state.get(k):
            admin_session.delete(f"{API}/master/corporate-clients/{state[k]}",
                                 params={"cascade": "true"})
    for k in ("cityA", "cityB"):
        if state.get(k):
            admin_session.delete(f"{API}/cities/{state[k]}")
