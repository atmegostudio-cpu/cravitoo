"""Backend tests for Sales Report cascading multi-select filters + Excel export
(iteration 55 review). Covers filters endpoint, city/client/site/vendor filters,
multi-client selection, and 4-sheet xlsx export."""
import io
import os
import pytest
import requests
import zipfile

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "admin@cravitoo.com", "password": "admin123"}
EMP = {"email": "timefix_emp@cravitoo.com", "password": "Test#1234"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"Login {creds['email']}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin_session():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def emp_session():
    return _login(EMP)


@pytest.fixture(scope="module")
def filters(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/admin/sales-report/filters", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _find(items, name_substr):
    for it in items:
        if name_substr.lower() in (it.get("name") or "").lower():
            return it
    return None


class TestFiltersEndpoint:
    def test_filters_shape(self, filters):
        for k in ("clients", "cities", "sites", "vendors"):
            assert k in filters, f"missing {k}"
            assert isinstance(filters[k], list)

    def test_demo_hierarchy_present(self, filters):
        assert _find(filters["clients"], "DEMO Acme"), "DEMO Acme Corp missing"
        assert _find(filters["clients"], "DEMO Globex"), "DEMO Globex Ltd missing"
        assert _find(filters["cities"], "DEMO Bengaluru"), "DEMO Bengaluru missing"
        assert _find(filters["cities"], "DEMO Mumbai"), "DEMO Mumbai missing"
        # at least one DEMO vendor
        demo_vendors = [v for v in filters["vendors"] if "DEMO" in (v.get("name") or "")]
        assert len(demo_vendors) >= 3, f"expected >=3 DEMO vendors, got {len(demo_vendors)}"

    def test_sites_tagged_with_company_and_city(self, filters):
        demo_sites = [s for s in filters["sites"] if "DEMO" in (s.get("name") or "") or "Acme" in (s.get("name") or "") or "Globex" in (s.get("name") or "")]
        assert demo_sites, "no DEMO sites found"
        for s in demo_sites:
            assert "company_id" in s and s["company_id"], f"site {s['name']} missing company_id"
            assert "city_id" in s and s["city_id"], f"site {s['name']} missing city_id"

    def test_vendors_have_site_ids(self, filters):
        for v in filters["vendors"]:
            assert isinstance(v.get("site_ids"), list) and v["site_ids"], f"vendor {v['name']} missing site_ids"


class TestSalesTotals:
    def _get(self, session, **params):
        r = session.get(f"{BASE_URL}/api/admin/sales-report", params=params, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def test_month_all_data(self, admin_session):
        j = self._get(admin_session, month="2026-06")
        assert j["order_count"] == 14, f"expected 14 orders, got {j['order_count']}"
        assert abs(j["grand_total"] - 3975.00) < 0.01, f"expected 3975.00, got {j['grand_total']}"
        # summaries populated
        assert j["city_summary"] and j["client_summary"] and j["site_summary"] and j["vendor_summary"]

    def test_filter_by_client_acme(self, admin_session, filters):
        acme = _find(filters["clients"], "DEMO Acme")
        j = self._get(admin_session, month="2026-06", client_ids=acme["id"])
        assert j["order_count"] == 8, f"expected 8, got {j['order_count']}"
        assert abs(j["grand_total"] - 2390.00) < 0.01, f"expected 2390.00, got {j['grand_total']}"
        site_names = {s["site"] for s in j["site_summary"]}
        # Only Acme sites should appear
        assert all("Acme" in n or "acme" in n.lower() for n in site_names), f"non-acme sites: {site_names}"

    def test_filter_by_city_bengaluru(self, admin_session, filters):
        blr = _find(filters["cities"], "DEMO Bengaluru")
        j = self._get(admin_session, month="2026-06", city_ids=blr["id"])
        assert j["order_count"] == 9, f"expected 9, got {j['order_count']}"
        assert abs(j["grand_total"] - 2505.00) < 0.01, f"expected 2505.00, got {j['grand_total']}"
        cities = {c["city"] for c in j["city_summary"]}
        assert cities == {"DEMO Bengaluru"} or all("Bengaluru" in c for c in cities), f"unexpected cities: {cities}"

    def test_combined_client_acme_city_mumbai(self, admin_session, filters):
        acme = _find(filters["clients"], "DEMO Acme")
        mum = _find(filters["cities"], "DEMO Mumbai")
        j = self._get(admin_session, month="2026-06", client_ids=acme["id"], city_ids=mum["id"])
        assert j["order_count"] == 3, f"expected 3, got {j['order_count']}"
        assert abs(j["grand_total"] - 1170.00) < 0.01, f"expected 1170.00, got {j['grand_total']}"

    def test_multi_client_acme_globex(self, admin_session, filters):
        acme = _find(filters["clients"], "DEMO Acme")
        glob = _find(filters["clients"], "DEMO Globex")
        j = self._get(admin_session, month="2026-06", client_ids=f"{acme['id']},{glob['id']}")
        assert j["order_count"] == 12, f"expected 12, got {j['order_count']}"
        assert abs(j["grand_total"] - 3675.00) < 0.01, f"expected 3675.00, got {j['grand_total']}"

    def test_vendor_filter_spice_hub(self, admin_session, filters):
        spice = _find(filters["vendors"], "DEMO Spice Hub")
        assert spice, "DEMO Spice Hub vendor not found"
        j = self._get(admin_session, month="2026-06", vendor_ids=spice["id"])
        assert j["order_count"] == 6, f"expected 6, got {j['order_count']}"
        assert abs(j["grand_total"] - 1930.00) < 0.01, f"expected 1930.00, got {j['grand_total']}"


class TestExcelDownload:
    def test_xlsx_four_sheets_with_filters(self, admin_session, filters):
        acme = _find(filters["clients"], "DEMO Acme")
        r = admin_session.get(
            f"{BASE_URL}/api/admin/sales-report",
            params={"month": "2026-06", "client_ids": acme["id"], "format": "xlsx"},
            timeout=30,
        )
        assert r.status_code == 200
        assert r.content[:2] == b"PK"
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            names = z.namelist()
        # Openpyxl stores sheet content at xl/worksheets/sheet{n}.xml — verify 4 sheets
        sheet_files = [n for n in names if n.startswith("xl/worksheets/sheet")]
        assert len(sheet_files) == 4, f"expected 4 sheets, got {len(sheet_files)}: {sheet_files}"
        # workbook.xml contains sheet titles
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            wb_xml = z.read("xl/workbook.xml").decode()
        for title in ("Orders", "City Totals", "Site Totals", "Vendor Totals"):
            assert title in wb_xml, f"sheet {title} missing"


class TestRBAC:
    def test_employee_403_report(self, emp_session):
        r = emp_session.get(f"{BASE_URL}/api/admin/sales-report", timeout=30)
        assert r.status_code == 403

    def test_employee_403_filters(self, emp_session):
        r = emp_session.get(f"{BASE_URL}/api/admin/sales-report/filters", timeout=30)
        assert r.status_code == 403
