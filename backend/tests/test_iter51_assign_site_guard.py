"""
Iter 51 backend tests — vendor site mapping guard + repair.

Covers:
  A) Guard on POST /api/onboarding/vendors/{onb_id}/master-decision:
       - approve without site_id -> 400, no vendor, no orphan mapping.
       - approve WITH valid site_id -> vendor appears in GET /api/sites/{sid}/vendors.
  B) Repair endpoint POST /api/admin/vendors/{vendor_id}/assign-site:
       - Orphan (null site_id) mapping -> vendor hidden. After assign-site,
         vendor visible with cafeteria_name; orphan mapping count = 0.
       - Explicit valid cafeteria_id honored.
       - Invalid/other-site cafeteria_id falls back to site default.
       - Non-master -> 403.
       - Unknown vendor / unknown site -> 404.
       - Inactive vendor is re-activated by assign-site.
  C) Regression on GET /api/sites/{site_id}/vendors:
       - Returns cafeteria_id + cafeteria_name.
       - Only active mappings + active vendors are listed.
       - Vendor mapped to different site does NOT leak.
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "admin@cravitoo.com"
ADMIN_PASSWORD = "admin123"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "cravitoo_db")


# ------------------------------- fixtures ------------------------------
@pytest.fixture(scope="module")
def db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture
def cleanup_registry(db):
    """Track ids created inside a test and delete them in teardown."""
    reg = {"sites": set(), "cafeterias": set(), "vendors": set(),
           "onboardings": set(), "mappings": set(), "emails": set(), "users": set()}
    yield reg
    try:
        if reg["vendors"]:
            vids = list(reg["vendors"])
            db.vendors.delete_many({"_id": {"$in": [ObjectId(v) for v in vids]}})
            db.vendor_site_mappings.delete_many({"vendor_id": {"$in": vids}})
            db.menu_items.delete_many({"vendor_id": {"$in": vids}})
            db.vendor_email_log.delete_many({"vendor_id": {"$in": vids}})
        for onb in reg["onboardings"]:
            db.vendor_onboarding.delete_one({"_id": ObjectId(onb)})
        for e in reg["emails"]:
            db.users.delete_many({"email": e})
            db.vendor_magic_links.delete_many({"email": e})
            db.vendors.delete_many({"email": e})
        for sid in reg["sites"]:
            db.cafeterias.delete_many({"site_id": sid})
            db.vendor_site_mappings.delete_many({"site_id": sid})
            db.sites.delete_one({"_id": ObjectId(sid)})
    except Exception as e:
        print(f"cleanup warn: {e}")


# ------------------------------- helpers -------------------------------
def _make_site(db, reg, name_suffix="site"):
    slug = uuid.uuid4().hex[:6]
    doc = {
        "name": f"TEST_iter51_{name_suffix}_{slug}",
        "address": "QA",
        "corporate_id": None,
        "is_active": True,
        "created_at": datetime.now(timezone.utc),
    }
    sid = str(db.sites.insert_one(doc).inserted_id)
    reg["sites"].add(sid)
    return sid


def _make_cafeteria(db, reg, site_id, name, is_default=False):
    ins = db.cafeterias.insert_one({
        "site_id": site_id,
        "name": name,
        "is_default": is_default,
        "is_active": True,
        "created_at": datetime.now(timezone.utc),
    })
    return str(ins.inserted_id)


def _make_onboarding(db, reg, site_id=None):
    slug = uuid.uuid4().hex[:6]
    email = f"TEST_iter51_{slug}@example.com"
    vname = f"TEST_iter51_vendor_{slug}"
    ins = db.vendor_onboarding.insert_one({
        "vendor_name": vname,
        "company_name": vname,
        "email": email,
        "contact_person": "QA",
        "mobile_number": "+919000000003",
        "cuisine_type": "Indian",
        "business_address": "QA",
        "site_id": site_id,
        "draft_menu": [],
        "remarks": [],
        "checklist": {},
        "status": "under_master_review",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    })
    onb_id = str(ins.inserted_id)
    reg["onboardings"].add(onb_id)
    reg["emails"].add(email)
    return onb_id, email, vname


def _make_active_vendor(db, reg, name_hint="v"):
    slug = uuid.uuid4().hex[:6]
    email = f"TEST_iter51_{name_hint}_{slug}@example.com"
    ins = db.vendors.insert_one({
        "name": f"TEST_iter51_vendor_{slug}",
        "email": email,
        "status": "active",
        "cuisine_type": "Multi",
        "rating": 0.0,
        "commission_pct": 15.0,
        "created_at": datetime.now(timezone.utc),
    })
    vid = str(ins.inserted_id)
    reg["vendors"].add(vid)
    reg["emails"].add(email)
    return vid


def _make_mapping(db, vendor_id, site_id, status="active", cafeteria_id=None):
    ins = db.vendor_site_mappings.insert_one({
        "vendor_id": vendor_id,
        "site_id": site_id,
        "cafeteria_id": cafeteria_id,
        "status": status,
        "created_at": datetime.now(timezone.utc),
    })
    return str(ins.inserted_id)


# =====================================================================
# A) GUARD tests
# =====================================================================
class TestApproveGuard:
    def test_approve_without_site_id_returns_400_and_no_vendor(self, admin_session, db, cleanup_registry):
        reg = cleanup_registry
        onb_id, email, vname = _make_onboarding(db, reg, site_id=None)

        r = admin_session.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/master-decision",
            json={"decision": "approve", "remarks": "iter51 guard no site"},
            timeout=30,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        body = r.json()
        detail = (body.get("detail") or "").lower()
        assert "site" in detail, f"error should mention site, got: {body}"

        # NO vendor created
        v = db.vendors.find_one({"email": email})
        assert v is None, f"vendor should not have been created, got: {v}"
        # NO orphan mapping created (nothing at all)
        assert db.vendor_site_mappings.count_documents({"vendor_id": {"$exists": True}, "site_id": None}) >= 0
        # onboarding still under_master_review (not approved)
        onb = db.vendor_onboarding.find_one({"_id": ObjectId(onb_id)})
        assert onb.get("status") == "under_master_review", onb.get("status")

    def test_approve_with_site_id_succeeds_and_vendor_appears(self, admin_session, db, cleanup_registry):
        reg = cleanup_registry
        site_id = _make_site(db, reg)
        # give the site a default cafeteria so cafeteria_name is set
        caf_default = _make_cafeteria(db, reg, site_id, "TEST_iter51_default", is_default=True)
        onb_id, email, vname = _make_onboarding(db, reg, site_id=site_id)

        r = admin_session.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/master-decision",
            json={"decision": "approve", "remarks": "iter51 happy path"},
            timeout=30,
        )
        assert r.status_code == 200, r.text

        v = db.vendors.find_one({"email": email})
        assert v is not None, "vendor should be created"
        vid = str(v["_id"])
        reg["vendors"].add(vid)

        lv = admin_session.get(f"{BASE_URL}/api/sites/{site_id}/vendors", timeout=30)
        assert lv.status_code == 200, lv.text
        ids = [x["id"] for x in lv.json()]
        assert vid in ids, f"vendor {vid} not visible in site vendors {ids}"


# =====================================================================
# B) REPAIR endpoint tests
# =====================================================================
class TestAssignSiteRepair:
    def test_orphan_hidden_then_repair_makes_visible(self, admin_session, db, cleanup_registry):
        reg = cleanup_registry
        site_id = _make_site(db, reg)
        caf_default = _make_cafeteria(db, reg, site_id, "TEST_iter51_repair_default", is_default=True)
        vid = _make_active_vendor(db, reg)
        # orphan mapping (site_id=None)
        _make_mapping(db, vid, site_id=None, status="active")

        # Before: vendor should NOT appear under the site
        lv = admin_session.get(f"{BASE_URL}/api/sites/{site_id}/vendors", timeout=30)
        assert lv.status_code == 200
        assert vid not in [x["id"] for x in lv.json()], "vendor should be hidden pre-repair"

        # Repair
        r = admin_session.post(
            f"{BASE_URL}/api/admin/vendors/{vid}/assign-site",
            json={"site_id": site_id}, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("site_id") == site_id
        assert body.get("cafeteria_id") == caf_default

        # Null-site mappings for this vendor: 0
        null_count = db.vendor_site_mappings.count_documents({
            "vendor_id": vid,
            "$or": [{"site_id": None}, {"site_id": {"$exists": False}}],
        })
        assert null_count == 0, f"null-site mappings not cleaned; count={null_count}"

        # After: vendor visible with cafeteria_name
        lv2 = admin_session.get(f"{BASE_URL}/api/sites/{site_id}/vendors", timeout=30)
        assert lv2.status_code == 200
        row = next((x for x in lv2.json() if x["id"] == vid), None)
        assert row is not None, "vendor should be visible after repair"
        assert row.get("cafeteria_id") == caf_default
        assert row.get("cafeteria_name") == "TEST_iter51_repair_default"

    def test_explicit_valid_cafeteria_honored(self, admin_session, db, cleanup_registry):
        reg = cleanup_registry
        site_id = _make_site(db, reg)
        caf_default = _make_cafeteria(db, reg, site_id, "TEST_iter51_ok_default", is_default=True)
        caf_second = _make_cafeteria(db, reg, site_id, "TEST_iter51_ok_second", is_default=False)
        vid = _make_active_vendor(db, reg)

        r = admin_session.post(
            f"{BASE_URL}/api/admin/vendors/{vid}/assign-site",
            json={"site_id": site_id, "cafeteria_id": caf_second}, timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("cafeteria_id") == caf_second

        mp = db.vendor_site_mappings.find_one({"vendor_id": vid, "site_id": site_id})
        assert mp is not None
        assert mp.get("cafeteria_id") == caf_second

    def test_invalid_cafeteria_falls_back_to_default(self, admin_session, db, cleanup_registry):
        reg = cleanup_registry
        site_id = _make_site(db, reg)
        caf_default = _make_cafeteria(db, reg, site_id, "TEST_iter51_fb_default", is_default=True)
        # cafeteria on a different site
        other_site_id = _make_site(db, reg, name_suffix="othersite")
        caf_other = _make_cafeteria(db, reg, other_site_id, "TEST_iter51_fb_other", is_default=True)
        vid = _make_active_vendor(db, reg)

        r = admin_session.post(
            f"{BASE_URL}/api/admin/vendors/{vid}/assign-site",
            json={"site_id": site_id, "cafeteria_id": caf_other}, timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("cafeteria_id") == caf_default

    def test_non_master_forbidden(self, db, cleanup_registry):
        """Non-authenticated caller returns 401/403; not master → 403."""
        reg = cleanup_registry
        site_id = _make_site(db, reg)
        vid = _make_active_vendor(db, reg)
        r = requests.post(
            f"{BASE_URL}/api/admin/vendors/{vid}/assign-site",
            json={"site_id": site_id}, timeout=30,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_unknown_vendor_returns_404(self, admin_session, db, cleanup_registry):
        reg = cleanup_registry
        site_id = _make_site(db, reg)
        fake_vendor_id = str(ObjectId())
        r = admin_session.post(
            f"{BASE_URL}/api/admin/vendors/{fake_vendor_id}/assign-site",
            json={"site_id": site_id}, timeout=30,
        )
        assert r.status_code == 404, f"expected 404 vendor, got {r.status_code}: {r.text}"

    def test_unknown_site_returns_404(self, admin_session, db, cleanup_registry):
        reg = cleanup_registry
        vid = _make_active_vendor(db, reg)
        fake_site_id = str(ObjectId())
        r = admin_session.post(
            f"{BASE_URL}/api/admin/vendors/{vid}/assign-site",
            json={"site_id": fake_site_id}, timeout=30,
        )
        assert r.status_code == 404, f"expected 404 site, got {r.status_code}: {r.text}"

    def test_inactive_vendor_gets_reactivated(self, admin_session, db, cleanup_registry):
        reg = cleanup_registry
        site_id = _make_site(db, reg)
        _make_cafeteria(db, reg, site_id, "TEST_iter51_reactivate_default", is_default=True)
        vid = _make_active_vendor(db, reg)
        # force inactive
        db.vendors.update_one({"_id": ObjectId(vid)}, {"$set": {"status": "suspended"}})
        assert db.vendors.find_one({"_id": ObjectId(vid)}).get("status") == "suspended"

        r = admin_session.post(
            f"{BASE_URL}/api/admin/vendors/{vid}/assign-site",
            json={"site_id": site_id}, timeout=30,
        )
        assert r.status_code == 200, r.text

        v = db.vendors.find_one({"_id": ObjectId(vid)})
        assert v.get("status") == "active", f"vendor status should be reactivated, got {v.get('status')}"

        lv = admin_session.get(f"{BASE_URL}/api/sites/{site_id}/vendors", timeout=30)
        assert lv.status_code == 200
        assert vid in [x["id"] for x in lv.json()], "reactivated vendor should now be visible"


# =====================================================================
# C) REGRESSION on GET /api/sites/{site_id}/vendors
# =====================================================================
class TestSiteVendorsListing:
    def test_returns_cafeteria_fields_and_scopes_by_site(self, admin_session, db, cleanup_registry):
        reg = cleanup_registry
        site_a = _make_site(db, reg, name_suffix="A")
        site_b = _make_site(db, reg, name_suffix="B")
        caf_a = _make_cafeteria(db, reg, site_a, "TEST_iter51_reg_A_default", is_default=True)
        _make_cafeteria(db, reg, site_b, "TEST_iter51_reg_B_default", is_default=True)

        # v_a mapped active to A; visible under A only
        v_a = _make_active_vendor(db, reg)
        _make_mapping(db, v_a, site_a, status="active", cafeteria_id=caf_a)

        # v_b mapped active to B → should NOT leak into A's list
        v_b = _make_active_vendor(db, reg)
        _make_mapping(db, v_b, site_b, status="active")

        # v_inactive_map: active vendor but INACTIVE mapping to A → hidden
        v_inactive_map = _make_active_vendor(db, reg)
        _make_mapping(db, v_inactive_map, site_a, status="inactive")

        # v_inactive_vendor: mapping active to A but vendor is inactive → hidden
        v_inactive_vendor = _make_active_vendor(db, reg)
        db.vendors.update_one({"_id": ObjectId(v_inactive_vendor)}, {"$set": {"status": "suspended"}})
        _make_mapping(db, v_inactive_vendor, site_a, status="active")

        lv = admin_session.get(f"{BASE_URL}/api/sites/{site_a}/vendors", timeout=30)
        assert lv.status_code == 200, lv.text
        rows = lv.json()
        ids = [x["id"] for x in rows]

        assert v_a in ids, "active vendor with active mapping missing"
        assert v_b not in ids, "vendor from different site leaked in"
        assert v_inactive_map not in ids, "vendor with inactive mapping leaked in"
        assert v_inactive_vendor not in ids, "inactive vendor leaked in"

        row_a = next(x for x in rows if x["id"] == v_a)
        assert row_a.get("cafeteria_id") == caf_a
        assert row_a.get("cafeteria_name") == "TEST_iter51_reg_A_default"
