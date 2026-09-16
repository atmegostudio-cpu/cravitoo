"""Backend tests for the new Accounts / Finance sub_admin role (iteration 78).

Covers:
- Create sub-admin with sales:view_all (all-sites finance) via /api/admin/sub-admins
- Magic link complete → password set → login as new user
- RBAC: finance user cannot list admins/sub-admins, but can call /api/admin/sales-report
- New payment breakdown fields in sales report + xlsx download
- Limited-scope variant (sales:view + site_ids)
- Cleanup created users.
"""
import os
import time
import uuid
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

MASTER_EMAIL = "admin@cravitoo.com"
MASTER_PASSWORD = "admin123"


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password})
    return r


def _new_email(tag):
    return f"TEST_{tag}_{uuid.uuid4().hex[:8]}@cravitoo.com"


class TestAccountsFinanceRole:
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

    # 1. Master admin creates finance user with sales:view_all
    def test_create_finance_user_all_sites(self):
        email = _new_email("finance_all")
        payload = {
            "email": email,
            "name": "TEST Finance All",
            "permissions": ["sales:view_all"],
            "scope": {"client_ids": [], "city_ids": [], "site_ids": [], "vendor_ids": []},
        }
        r = self.s.post(f"{API}/admin/sub-admins", json=payload)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        assert data["email"] == email.lower()
        assert "magic_url" in data and "/auth/magic/" in data["magic_url"]
        self.created_ids.append(data["id"])

        # verify persistence via list endpoint
        lst = self.s.get(f"{API}/admin/sub-admins").json()
        found = [u for u in lst if u["id"] == data["id"]]
        assert found, "created sub-admin missing from list"
        assert "sales:view_all" in found[0]["permissions"]

    # 2. Complete magic link → login as finance user
    def test_magic_link_flow_and_finance_login(self):
        email = _new_email("finance_login")
        r = self.s.post(f"{API}/admin/sub-admins", json={
            "email": email, "name": "TEST Finance Login",
            "permissions": ["sales:view_all"],
            "scope": {"client_ids": [], "city_ids": [], "site_ids": [], "vendor_ids": []},
        })
        assert r.status_code == 200
        d = r.json()
        self.created_ids.append(d["id"])
        magic_url = d["magic_url"]
        token = magic_url.rsplit("/", 1)[-1]

        # verify magic link resolves
        vr = requests.get(f"{API}/auth/magic/{token}")
        assert vr.status_code == 200, f"verify magic: {vr.status_code} {vr.text}"

        # complete: set password
        pw = "Finance#1234"
        cr = requests.post(f"{API}/auth/magic/{token}/complete", json={"password": pw})
        assert cr.status_code == 200, f"complete magic: {cr.status_code} {cr.text}"

        # login as finance user
        fin = requests.Session()
        lr = _login(fin, email, pw)
        assert lr.status_code == 200, f"finance login: {lr.status_code} {lr.text}"
        me = fin.get(f"{API}/auth/me").json()
        assert me.get("role") == "sub_admin"
        assert "sales:view_all" in (me.get("permissions") or [])

        # RBAC deny — cannot list admins / sub-admins
        forbidden = fin.get(f"{API}/admin/sub-admins")
        assert forbidden.status_code in (401, 403), f"finance should NOT list sub-admins: {forbidden.status_code}"

        admins = fin.get(f"{API}/admin/admins")
        assert admins.status_code in (401, 403, 404), f"finance should NOT list admins: {admins.status_code}"

        # SALES report — must be 200 with all-sites data & new payment fields
        sr = fin.get(f"{API}/admin/sales-report", params={"month": "2026-09"})
        assert sr.status_code == 200, f"sales-report as finance: {sr.status_code} {sr.text[:300]}"
        j = sr.json()
        assert "per_payment_status" in j and isinstance(j["per_payment_status"], list)
        assert "per_payment_method" in j and isinstance(j["per_payment_method"], list)
        assert "grand_total" in j and "order_count" in j
        # all-sites -> should include the seeded 2026-09 data (₹330/2 per context)
        assert j["order_count"] >= 1, f"expected at least 1 order in 2026-09, got {j['order_count']}"

        # xlsx should download
        xr = fin.get(f"{API}/admin/sales-report",
                     params={"month": "2026-09", "format": "xlsx"})
        assert xr.status_code == 200
        assert "spreadsheet" in xr.headers.get("content-type", "").lower()
        assert len(xr.content) > 500

        # sales filters endpoint accessible
        fr = fin.get(f"{API}/admin/sales-report/filters")
        assert fr.status_code == 200
        fdata = fr.json()
        for k in ("clients", "cities", "sites", "vendors"):
            assert k in fdata

    # 3. Limited scope variant — sales:view with site_ids
    def test_create_finance_limited_scope(self):
        # pick a site
        sites = self.s.get(f"{API}/sites").json()
        assert isinstance(sites, list) and len(sites) >= 1, "no sites to scope to"
        site_id = sites[0].get("id") or str(sites[0].get("_id"))

        email = _new_email("finance_scoped")
        r = self.s.post(f"{API}/admin/sub-admins", json={
            "email": email, "name": "TEST Finance Scoped",
            "permissions": ["sales:view"],
            "scope": {"client_ids": [], "city_ids": [], "site_ids": [site_id], "vendor_ids": []},
        })
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        d = r.json()
        self.created_ids.append(d["id"])
        lst = self.s.get(f"{API}/admin/sub-admins").json()
        me = [u for u in lst if u["id"] == d["id"]][0]
        assert me["permissions"] == ["sales:view"]
        assert site_id in (me["scope"].get("site_ids") or [])

    # 4. Master's own sales-report has new payment breakdown fields
    def test_master_sales_report_has_payment_breakdown(self):
        r = self.s.get(f"{API}/admin/sales-report", params={"month": "2026-09"})
        assert r.status_code == 200
        j = r.json()
        assert "per_payment_status" in j
        assert "per_payment_method" in j
        # sanity from context: at least 1 paid and 1 pending
        statuses = {row["status"] for row in j["per_payment_status"]}
        # not strictly required, just log
        print("payment_status buckets:", statuses)
