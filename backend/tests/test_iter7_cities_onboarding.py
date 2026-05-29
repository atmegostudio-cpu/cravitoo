"""
Iteration 7 tests: Cities CRUD, City Admin role, Vendor Onboarding workflow.
Covers ~30 cases from review_request.
"""
import os
import io
import uuid
import time
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "https://corporate-feast.preview.emergentagent.com"
API = f"{BASE_URL}/api"

MASTER = {"email": "admin@cravitoo.com", "password": "admin123"}
SITE_ADMIN = {"email": "siteadmin@techcorp.com", "password": "site123"}
EMPLOYEE = {"email": "employee@techcorp.com", "password": "employee123"}

NONCE = uuid.uuid4().hex[:6]


def login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login {creds['email']} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# -------- session-scoped helpers --------
@pytest.fixture(scope="session")
def master_tok():
    return login(MASTER)


@pytest.fixture(scope="session")
def site_admin_tok():
    return login(SITE_ADMIN)


@pytest.fixture(scope="session")
def employee_tok():
    return login(EMPLOYEE)


@pytest.fixture(scope="session")
def site_admin_me(site_admin_tok):
    r = requests.get(f"{API}/auth/me", headers=H(site_admin_tok), timeout=20)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="session")
def site_id(site_admin_me):
    sid = site_admin_me.get("site_id")
    assert sid, "site_admin has no site_id"
    return sid


# Tiny but valid PDF for upload tests
TINY_PDF = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n"
    b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n"
    b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%EOF\n"
)


# ============== CITIES ==============
class TestCities:
    city_id = None
    city2_id = None

    def test_01_create_city_master(self, master_tok):
        name = f"TESTCITY_{NONCE}_Mumbai"
        r = requests.post(f"{API}/cities", json={"name": name, "state": "Maharashtra"},
                          headers=H(master_tok), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "id" in data and data["name"] == name and data["state"] == "Maharashtra"
        TestCities.city_id = data["id"]

    def test_02_create_city_forbidden_for_non_master(self, site_admin_tok):
        r = requests.post(f"{API}/cities", json={"name": f"TESTCITY_{NONCE}_X", "state": "Q"},
                          headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 403

    def test_03_list_cities_master_sees_all_with_counts(self, master_tok):
        r = requests.get(f"{API}/cities", headers=H(master_tok), timeout=20)
        assert r.status_code == 200
        cities = r.json()
        assert isinstance(cities, list) and len(cities) >= 1
        for c in cities:
            assert "site_count" in c and "vendor_count" in c
            assert isinstance(c["site_count"], int)

    def test_04_list_cities_employee_sees_only_active(self, employee_tok):
        r = requests.get(f"{API}/cities", headers=H(employee_tok), timeout=20)
        assert r.status_code == 200
        cities = r.json()
        assert all(c.get("status") == "active" for c in cities)

    def test_05_get_city_single(self, master_tok):
        assert TestCities.city_id
        r = requests.get(f"{API}/cities/{TestCities.city_id}", headers=H(master_tok), timeout=20)
        assert r.status_code == 200
        assert r.json()["id"] == TestCities.city_id

    def test_06_patch_city_master(self, master_tok):
        new_state = "Maharashtra-Updated"
        r = requests.patch(f"{API}/cities/{TestCities.city_id}", json={"state": new_state},
                           headers=H(master_tok), timeout=20)
        assert r.status_code == 200
        # verify
        r2 = requests.get(f"{API}/cities/{TestCities.city_id}", headers=H(master_tok), timeout=20)
        assert r2.json()["state"] == new_state

    def test_07_patch_city_forbidden_for_site_admin(self, site_admin_tok):
        r = requests.patch(f"{API}/cities/{TestCities.city_id}", json={"state": "X"},
                           headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 403


# ============== CITY ADMIN ==============
class TestCityAdmin:
    city_admin_email = f"TEST_cityadmin_{NONCE}@cravitoo.com"
    city_admin_pwd = "city12345"
    city_admin_id = None
    city_admin_tok = None
    city_id_for_admin = None

    def test_08_create_city_admin_master(self, master_tok):
        assert TestCities.city_id, "city must be created first"
        TestCityAdmin.city_id_for_admin = TestCities.city_id
        r = requests.post(f"{API}/admin/city-admins",
                          json={"email": self.city_admin_email, "password": self.city_admin_pwd,
                                "name": "TEST CityAdmin", "city_id": TestCities.city_id},
                          headers=H(master_tok), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["role"] == "city_admin" and data["city_id"] == TestCities.city_id
        TestCityAdmin.city_admin_id = data["id"]

    def test_09_create_city_admin_email_collision(self, master_tok):
        r = requests.post(f"{API}/admin/city-admins",
                          json={"email": self.city_admin_email, "password": "x12345",
                                "name": "Dup", "city_id": TestCities.city_id},
                          headers=H(master_tok), timeout=20)
        assert r.status_code == 400

    def test_10_create_city_admin_invalid_city(self, master_tok):
        bogus_id = "507f1f77bcf86cd799439011"
        r = requests.post(f"{API}/admin/city-admins",
                          json={"email": f"TEST_bogus_{NONCE}@x.com", "password": "p12345",
                                "name": "Bogus", "city_id": bogus_id},
                          headers=H(master_tok), timeout=20)
        assert r.status_code == 404

    def test_11_create_city_admin_forbidden_for_non_master(self, site_admin_tok):
        r = requests.post(f"{API}/admin/city-admins",
                          json={"email": f"TEST_x_{NONCE}@x.com", "password": "p12345",
                                "name": "X", "city_id": TestCities.city_id},
                          headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 403

    def test_12_city_admin_login_and_me(self):
        tok = login({"email": self.city_admin_email, "password": self.city_admin_pwd})
        TestCityAdmin.city_admin_tok = tok
        r = requests.get(f"{API}/auth/me", headers=H(tok), timeout=20)
        assert r.status_code == 200
        me = r.json()
        assert me["role"] == "city_admin"
        assert me["city_id"] == TestCityAdmin.city_id_for_admin

    def test_13_get_city_forbidden_for_other_city_admin(self, master_tok):
        # create a 2nd city + 2nd city_admin and verify cross-access denied
        r = requests.post(f"{API}/cities", json={"name": f"TESTCITY_{NONCE}_Delhi", "state": "Delhi"},
                          headers=H(master_tok), timeout=20)
        assert r.status_code == 200
        TestCities.city2_id = r.json()["id"]
        # city_admin tries to fetch city2
        r2 = requests.get(f"{API}/cities/{TestCities.city2_id}",
                          headers=H(TestCityAdmin.city_admin_tok), timeout=20)
        assert r2.status_code == 403


# ============== ONBOARDING ==============
class TestOnboarding:
    onb_id = None
    onb_id_for_master = None
    vendor_id_created = None

    def test_14_site_admin_creates_onboarding(self, site_admin_tok, site_id):
        payload = {
            "vendor_name": f"TEST_Vendor_{NONCE}",
            "company_name": "TEST Foods Ltd",
            "contact_person": "Tester",
            "mobile_number": "9999988888",
            "email": f"TEST_vendor_{NONCE}@x.com",
            "business_address": "Test Addr",
            "cuisine_type": "Multi-cuisine",
            "site_id": site_id,
        }
        r = requests.post(f"{API}/onboarding/vendors", json=payload,
                          headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "draft" and data["checklist_pct"] == 0
        TestOnboarding.onb_id = data["id"]

    def test_15_site_admin_other_site_forbidden(self, site_admin_tok):
        # Random ObjectId not matching site_admin's own site
        fake_site = "507f1f77bcf86cd799439099"
        r = requests.post(f"{API}/onboarding/vendors",
                          json={"vendor_name": "X", "company_name": "X", "contact_person": "X",
                                "mobile_number": "9", "email": f"TEST_xx_{NONCE}@x.com",
                                "business_address": "X", "site_id": fake_site},
                          headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 403

    def test_16_employee_cannot_onboard(self, employee_tok, site_id):
        r = requests.post(f"{API}/onboarding/vendors",
                          json={"vendor_name": "X", "company_name": "X", "contact_person": "X",
                                "mobile_number": "9", "email": f"TEST_emp_{NONCE}@x.com",
                                "business_address": "X", "site_id": site_id},
                          headers=H(employee_tok), timeout=20)
        assert r.status_code == 403

    def test_17_master_can_onboard(self, master_tok, site_id):
        r = requests.post(f"{API}/onboarding/vendors",
                          json={"vendor_name": f"TEST_MasterOnb_{NONCE}", "company_name": "M",
                                "contact_person": "M", "mobile_number": "9", "email": f"TEST_m_{NONCE}@x.com",
                                "business_address": "M", "site_id": site_id},
                          headers=H(master_tok), timeout=20)
        assert r.status_code == 200
        TestOnboarding.onb_id_for_master = r.json()["id"]

    def test_18_list_site_admin_sees_only_own(self, site_admin_tok, site_id):
        r = requests.get(f"{API}/onboarding/vendors", headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 200
        for o in r.json():
            assert o["site_id"] == site_id

    def test_19_list_filter_by_status(self, master_tok):
        r = requests.get(f"{API}/onboarding/vendors?status=draft",
                         headers=H(master_tok), timeout=20)
        assert r.status_code == 200
        assert all(o["status"] == "draft" for o in r.json())

    def test_20_get_detail(self, site_admin_tok):
        r = requests.get(f"{API}/onboarding/vendors/{TestOnboarding.onb_id}",
                         headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "checklist" in d and "documents" in d

    def test_21_patch_basic_info(self, site_admin_tok):
        r = requests.patch(f"{API}/onboarding/vendors/{TestOnboarding.onb_id}",
                           json={"contact_person": "Updated Person"},
                           headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 200
        r2 = requests.get(f"{API}/onboarding/vendors/{TestOnboarding.onb_id}",
                          headers=H(site_admin_tok), timeout=20)
        assert r2.json()["contact_person"] == "Updated Person"

    def test_22_checklist_pct_recalc(self, site_admin_tok):
        # toggle 3 items → 30%
        r = requests.patch(f"{API}/onboarding/vendors/{TestOnboarding.onb_id}/checklist",
                           json={"gst_verified": True, "pan_verified": True, "fssai_verified": True},
                           headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 200
        assert r.json()["checklist_pct"] == 30

    def test_23_upload_doc_flips_status(self, site_admin_tok):
        files = {"file": ("gst.pdf", io.BytesIO(TINY_PDF), "application/pdf")}
        r = requests.post(
            f"{API}/onboarding/vendors/{TestOnboarding.onb_id}/documents/gst_certificate",
            headers=H(site_admin_tok), files=files, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["doc_type"] == "gst_certificate"
        # verify status auto-flipped + doc persists
        r2 = requests.get(f"{API}/onboarding/vendors/{TestOnboarding.onb_id}",
                          headers=H(site_admin_tok), timeout=20)
        d = r2.json()
        assert d["status"] == "documents_pending"
        assert "gst_certificate" in d["documents"]

    def test_24_upload_invalid_doc_type(self, site_admin_tok):
        files = {"file": ("x.pdf", io.BytesIO(TINY_PDF), "application/pdf")}
        r = requests.post(
            f"{API}/onboarding/vendors/{TestOnboarding.onb_id}/documents/bogus_type",
            headers=H(site_admin_tok), files=files, timeout=20)
        assert r.status_code == 400

    def test_25_upload_invalid_extension(self, site_admin_tok):
        files = {"file": ("evil.txt", io.BytesIO(b"hello"), "text/plain")}
        r = requests.post(
            f"{API}/onboarding/vendors/{TestOnboarding.onb_id}/documents/pan_card",
            headers=H(site_admin_tok), files=files, timeout=20)
        assert r.status_code == 400

    def test_26_delete_doc(self, site_admin_tok):
        # upload then delete
        files = {"file": ("pan.pdf", io.BytesIO(TINY_PDF), "application/pdf")}
        r = requests.post(
            f"{API}/onboarding/vendors/{TestOnboarding.onb_id}/documents/pan_card",
            headers=H(site_admin_tok), files=files, timeout=20)
        assert r.status_code == 200
        rd = requests.delete(
            f"{API}/onboarding/vendors/{TestOnboarding.onb_id}/documents/pan_card",
            headers=H(site_admin_tok), timeout=20)
        assert rd.status_code == 200
        # verify removed
        rg = requests.get(f"{API}/onboarding/vendors/{TestOnboarding.onb_id}",
                          headers=H(site_admin_tok), timeout=20)
        assert "pan_card" not in rg.json()["documents"]

    def test_27_site_review_approve_below_80_fails(self, site_admin_tok):
        # currently 30%
        r = requests.post(f"{API}/onboarding/vendors/{TestOnboarding.onb_id}/site-review",
                          json={"decision": "approve"},
                          headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 400

    def test_28_site_review_request_changes(self, site_admin_tok):
        # use the master-created onboarding so we don't disrupt main flow
        r = requests.post(
            f"{API}/onboarding/vendors/{TestOnboarding.onb_id_for_master}/site-review",
            json={"decision": "request_changes", "remarks": "Need more info"},
            headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 200
        assert r.json()["status"] == "changes_requested"

    def test_29_site_review_reject(self, master_tok, site_id):
        # Create a fresh onboarding to reject
        r = requests.post(f"{API}/onboarding/vendors",
                          json={"vendor_name": f"TEST_ToReject_{NONCE}", "company_name": "R",
                                "contact_person": "R", "mobile_number": "9",
                                "email": f"TEST_rej_{NONCE}@x.com", "business_address": "R",
                                "site_id": site_id},
                          headers=H(master_tok), timeout=20)
        assert r.status_code == 200
        rej_id = r.json()["id"]
        r2 = requests.post(f"{API}/onboarding/vendors/{rej_id}/site-review",
                           json={"decision": "reject", "remarks": "fail"},
                           headers=H(master_tok), timeout=20)
        assert r2.status_code == 200
        assert r2.json()["status"] == "rejected"

    def test_30_master_decision_wrong_status(self, master_tok):
        # onb_id is currently documents_pending → not under_master_review
        r = requests.post(f"{API}/onboarding/vendors/{TestOnboarding.onb_id}/master-decision",
                          json={"decision": "approve"},
                          headers=H(master_tok), timeout=20)
        assert r.status_code == 400

    def test_31_full_happy_path_e2e(self, master_tok, site_admin_tok, site_id):
        """Full E2E: checklist 80% → site approve → master approve → vendor exists & mapped."""
        onb = TestOnboarding.onb_id
        # complete 8 of 10 checklist items (=80%)
        r = requests.patch(f"{API}/onboarding/vendors/{onb}/checklist",
                           json={"gst_verified": True, "pan_verified": True, "fssai_verified": True,
                                 "bank_verified": True, "menu_uploaded": True,
                                 "pricing_verified": True, "documents_uploaded": True,
                                 "site_visit_completed": True},
                           headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 200
        assert r.json()["checklist_pct"] == 80

        # site approve → under_master_review
        r = requests.post(f"{API}/onboarding/vendors/{onb}/site-review",
                          json={"decision": "approve", "remarks": "ok"},
                          headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 200
        assert r.json()["status"] == "under_master_review"

        # master approve
        r = requests.post(f"{API}/onboarding/vendors/{onb}/master-decision",
                          json={"decision": "approve", "remarks": "lgtm"},
                          headers=H(master_tok), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "active"
        vid = body.get("vendor_id")
        assert vid, "vendor_id should be returned"
        TestOnboarding.vendor_id_created = vid

        # vendor record exists in /api/vendors
        rv = requests.get(f"{API}/vendors", headers=H(master_tok), timeout=20)
        assert rv.status_code == 200
        assert any(v.get("id") == vid for v in rv.json()), "new vendor must appear in /api/vendors"

        # commission_pct == 15
        rdetail = requests.get(f"{API}/vendors/{vid}", headers=H(master_tok), timeout=20)
        assert rdetail.status_code == 200
        assert float(rdetail.json().get("commission_pct", 0)) == 15.0

    def test_32_vendor_mapped_to_site(self, master_tok, site_id):
        # site_vendor_mapping should make vendor appear under /sites/{site_id}/vendors
        vid = TestOnboarding.vendor_id_created
        assert vid, "needs vendor from previous test"
        r = requests.get(f"{API}/sites/{site_id}/vendors", headers=H(master_tok), timeout=20)
        assert r.status_code == 200, r.text
        ids = [v.get("id") for v in r.json()]
        assert vid in ids, (
            f"BUG: vendor {vid} not found in /api/sites/{site_id}/vendors. "
            f"Got ids={ids}. Likely the master-decision endpoint writes to the wrong "
            f"collection (site_vendor_mappings) while the listing reads from vendor_site_mappings."
        )

    def test_33_audit_trail_contains_actions(self, master_tok):
        r = requests.get(f"{API}/onboarding/vendors/{TestOnboarding.onb_id}/audit-trail",
                         headers=H(master_tok), timeout=20)
        assert r.status_code == 200
        actions = {entry["action"] for entry in r.json()["audit_trail"]}
        # We expect at least these
        expected = {"created", "checklist_updated", "uploaded_doc", "site_approve", "master_approve"}
        missing = expected - actions
        assert not missing, f"Missing audit actions: {missing}; got: {actions}"

    def test_34_dashboard_stats(self, master_tok):
        r = requests.get(f"{API}/onboarding/dashboard", headers=H(master_tok), timeout=20)
        assert r.status_code == 200
        d = r.json()
        for k in ("total", "by_status", "pending_approvals", "approved",
                  "rejected", "avg_checklist_pct"):
            assert k in d, f"Missing key {k} in dashboard"
        assert d["total"] >= 1

    def test_35_cannot_edit_after_active(self, site_admin_tok):
        # onb_id is now active → PATCH must be blocked
        r = requests.patch(f"{API}/onboarding/vendors/{TestOnboarding.onb_id}",
                           json={"contact_person": "Should Fail"},
                           headers=H(site_admin_tok), timeout=20)
        assert r.status_code == 400


# ============== City-Admin onboarding cross-city access ==============
class TestCityAdminOnboarding:
    def test_36_city_admin_outside_city_forbidden(self, site_id):
        """The city_admin we made is for TESTCITY_Mumbai. Tech Corp site is in Bangalore.
        So attempting to onboard for site_id (Bangalore) should be 403."""
        tok = TestCityAdmin.city_admin_tok
        if not tok:
            pytest.skip("city_admin not created")
        r = requests.post(f"{API}/onboarding/vendors",
                          json={"vendor_name": "X", "company_name": "X", "contact_person": "X",
                                "mobile_number": "9", "email": f"TEST_ca_{NONCE}@x.com",
                                "business_address": "X", "site_id": site_id},
                          headers=H(tok), timeout=20)
        assert r.status_code == 403


# ============== Cleanup at end of session ==============
@pytest.fixture(scope="session", autouse=True)
def _cleanup(master_tok):
    yield
    try:
        from pymongo import MongoClient
        client = MongoClient(os.environ["MONGO_URL"])
        dbname = os.environ.get("DB_NAME", "test_database")
        d = client[dbname]
        # Remove TEST_ onboardings + matching audit logs + created vendors + cities + city_admin
        onb_ids = [str(o["_id"]) for o in d.vendor_onboarding.find(
            {"vendor_name": {"$regex": f"^TEST_.*{NONCE}"}}
        )]
        if onb_ids:
            d.vendor_onboarding.delete_many({"vendor_name": {"$regex": f"^TEST_.*{NONCE}"}})
            d.audit_log.delete_many({"entity_id": {"$in": onb_ids}})
        d.vendors.delete_many({"name": {"$regex": f"^TEST_.*{NONCE}"}})
        d.cities.delete_many({"name": {"$regex": f"^TESTCITY_{NONCE}"}})
        d.users.delete_many({"email": {"$regex": f"^TEST_cityadmin_{NONCE}"}})
        # also drop site-vendor mappings created
        from bson import ObjectId  # noqa
        d.vendor_site_mappings.delete_many({"site_id": {"$regex": ".*"}, "vendor_id": ""})  # noop guard
        client.close()
    except Exception as e:
        print(f"[cleanup] non-fatal: {e}")
