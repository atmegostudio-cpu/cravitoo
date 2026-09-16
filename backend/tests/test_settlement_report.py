"""Backend tests for the new Settlement Report endpoint (iteration 79).

Covers:
- GET /api/admin/settlement-report as Master Admin (month=2026-09) with exact numbers.
- Per-gateway breakdown (razorpay / offline) with counts & amounts.
- Refunds & cancellations breakdown (paid/unpaid + by_actor).
- xlsx download returns correct content-type and both sheets.
- RBAC: sales:view_all sub_admin can access the endpoint (same all-sites data).
- RBAC: sub_admin without sales perms is denied.
"""
import io
import os
import uuid
import zipfile
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

MASTER_EMAIL = "admin@cravitoo.com"
MASTER_PASSWORD = "admin123"


def _login(session, email, password):
    return session.post(f"{API}/auth/login", json={"email": email, "password": password})


def _new_email(tag):
    return f"TEST_{tag}_{uuid.uuid4().hex[:8]}@cravitoo.com"


class TestSettlementReport:
    created_ids = []

    def setup_method(self, _):
        self.s = requests.Session()
        r = _login(self.s, MASTER_EMAIL, MASTER_PASSWORD)
        assert r.status_code == 200, f"master login failed: {r.status_code} {r.text[:200]}"

    def teardown_method(self, _):
        for uid in list(self.created_ids):
            try:
                self.s.delete(f"{API}/admin/sub-admins/{uid}")
            except Exception:
                pass

    # 1. Master gets settlement report with exact numbers
    def test_master_settlement_report_numbers(self):
        r = self.s.get(f"{API}/admin/settlement-report", params={"month": "2026-09"})
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        j = r.json()

        # top-level totals
        assert j.get("gross_amount") == 660.0, f"gross_amount={j.get('gross_amount')}"
        assert j.get("refunded_amount") == 150.0, f"refunded_amount={j.get('refunded_amount')}"
        assert j.get("net_amount") == 510.0, f"net_amount={j.get('net_amount')}"

        # per_gateway
        per_gw = j.get("per_gateway") or []
        gw_by_key = {row.get("gateway") or row.get("key") or row.get("id"): row for row in per_gw}
        assert "razorpay" in gw_by_key, f"gateways: {list(gw_by_key)}"
        assert "offline" in gw_by_key, f"gateways: {list(gw_by_key)}"
        rz = gw_by_key["razorpay"]
        off = gw_by_key["offline"]
        assert rz.get("label") == "Razorpay (Online)", rz
        assert rz.get("orders") == 2, rz
        assert (rz.get("gross") or rz.get("gross_amount")) == 450.0, rz
        assert (rz.get("refunded") or rz.get("refunded_amount")) == 150.0, rz
        assert (rz.get("net") or rz.get("net_amount")) == 300.0, rz
        assert off.get("label") == "Offline / Cash", off
        assert off.get("orders") == 1, off
        assert (off.get("gross") or off.get("gross_amount")) == 210.0, off
        assert (off.get("refunded") or off.get("refunded_amount") or 0) == 0, off
        assert (off.get("net") or off.get("net_amount")) == 210.0, off

        # refunds
        refunds = j.get("refunds") or {}
        refunded = refunds.get("refunded") or {}
        assert refunded.get("count") == 1
        assert refunded.get("amount") == 150.0

        # cancellations
        cancels = j.get("cancellations") or {}
        assert (cancels.get("total") or {}).get("count") == 2
        assert (cancels.get("total") or {}).get("amount") == 150.0
        assert (cancels.get("paid_cancelled") or {}).get("count") == 1
        assert (cancels.get("paid_cancelled") or {}).get("amount") == 150.0
        assert (cancels.get("unpaid_cancelled") or {}).get("count") == 1
        assert (cancels.get("unpaid_cancelled") or {}).get("amount") == 0

        by_actor = cancels.get("by_actor") or []
        actors = {row.get("by") or row.get("actor") or row.get("key"): row for row in by_actor}
        assert "master_admin" in actors, f"actors: {list(actors)}"
        assert "customer" in actors, f"actors: {list(actors)}"
        assert actors["master_admin"].get("count") == 1
        assert actors["customer"].get("count") == 1

    # 2. xlsx download
    def test_settlement_report_xlsx(self):
        r = self.s.get(f"{API}/admin/settlement-report",
                       params={"month": "2026-09", "format": "xlsx"})
        assert r.status_code == 200
        ct = r.headers.get("content-type", "").lower()
        assert "spreadsheet" in ct, ct
        assert len(r.content) > 500
        # inspect sheets
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        wb = zf.read("xl/workbook.xml").decode("utf-8", errors="ignore")
        assert "Settlement" in wb, "Settlement sheet missing"
        assert "Refunds" in wb and "Cancellations" in wb, f"missing sheet in workbook: {wb[:400]}"

    # 3. Finance user (sales:view_all) can access settlement report with same data
    def test_finance_user_can_access_settlement(self):
        email = _new_email("finance_settle")
        payload = {
            "email": email,
            "name": "TEST Finance Settle",
            "permissions": ["sales:view_all"],
            "scope": {"client_ids": [], "city_ids": [], "site_ids": [], "vendor_ids": []},
        }
        cr = self.s.post(f"{API}/admin/sub-admins", json=payload)
        assert cr.status_code == 200, cr.text
        d = cr.json()
        self.created_ids.append(d["id"])
        token = d["magic_url"].rsplit("/", 1)[-1]

        pw = "Finance#1234"
        assert requests.post(f"{API}/auth/magic/{token}/complete", json={"password": pw}).status_code == 200

        fin = requests.Session()
        assert _login(fin, email, pw).status_code == 200

        r = fin.get(f"{API}/admin/settlement-report", params={"month": "2026-09"})
        assert r.status_code == 200, f"finance settlement: {r.status_code} {r.text[:300]}"
        j = r.json()
        assert j.get("gross_amount") == 660.0
        assert j.get("net_amount") == 510.0
        assert j.get("refunded_amount") == 150.0

        # xlsx too
        xr = fin.get(f"{API}/admin/settlement-report",
                     params={"month": "2026-09", "format": "xlsx"})
        assert xr.status_code == 200
        assert "spreadsheet" in xr.headers.get("content-type", "").lower()

    # 4. Sub_admin without sales perms is denied
    def test_non_sales_sub_admin_denied(self):
        # Use a sub_admin without sales:view / sales:view_all
        email = _new_email("nosales")
        cr = self.s.post(f"{API}/admin/sub-admins", json={
            "email": email, "name": "TEST No Sales",
            "permissions": ["orders:view"],  # any non-sales perm
            "scope": {"client_ids": [], "city_ids": [], "site_ids": [], "vendor_ids": []},
        })
        if cr.status_code != 200:
            # if 'orders:view' is not accepted, skip
            import pytest
            pytest.skip(f"cannot create non-sales sub_admin: {cr.status_code} {cr.text[:200]}")
        d = cr.json()
        self.created_ids.append(d["id"])
        token = d["magic_url"].rsplit("/", 1)[-1]
        pw = "Finance#1234"
        assert requests.post(f"{API}/auth/magic/{token}/complete", json={"password": pw}).status_code == 200

        u = requests.Session()
        assert _login(u, email, pw).status_code == 200
        r = u.get(f"{API}/admin/settlement-report", params={"month": "2026-09"})
        assert r.status_code in (401, 403), f"expected deny, got {r.status_code}"
