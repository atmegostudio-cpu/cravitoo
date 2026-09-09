"""Tests for the Employee Feedback feature (iteration 62).

Covers:
- POST /api/feedback (food & issue), validations, RBAC
- Order-mapping (vendor_id / site_id / company_id / order_code carry-over)
- GET /api/employee/feedback  (employee-only)
- GET /api/feedback           (role-scoped inbox)
- PATCH /api/feedback/{id}/resolve

Seeds its own employee, vendor and paid order directly in Mongo so the test
is self-contained. Data is prefixed TEST_FB_ and cleaned up at teardown.
"""
import os
import uuid
import bcrypt
import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "cravitoo_db")

_client = MongoClient(MONGO_URL)
_db = _client[DB_NAME]

TAG = f"TEST_FB_{uuid.uuid4().hex[:6]}"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
def _hash(pw):
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


@pytest.fixture(scope="module")
def seeded():
    """Create a company, site, vendor user, employee user, and one paid order."""
    company_id = str(ObjectId())
    site_id = str(ObjectId())
    vendor_id = str(ObjectId())

    # Site doc (minimal - feedback only reads user's site_id + order's site_id).
    _db.sites.insert_one({
        "_id": ObjectId(site_id),
        "name": f"{TAG}_Site",
        "company_id": company_id,
        "status": "active",
    })

    # Vendor user
    vendor_email = f"{TAG.lower()}_vendor@example.com"
    vendor_uid = _db.users.insert_one({
        "email": vendor_email,
        "name": f"{TAG}_Vendor",
        "role": "vendor",
        "password_hash": _hash("VendorPass#1"),
        "vendor_id": vendor_id,
        "is_active": True,
    }).inserted_id

    # Vendor record (some endpoints look this up)
    _db.vendors.insert_one({
        "_id": ObjectId(vendor_id),
        "name": f"{TAG}_Vendor",
        "email": vendor_email,
        "status": "approved",
    })

    # Employee user
    emp_email = f"{TAG.lower()}_emp@example.com"
    emp_uid = _db.users.insert_one({
        "email": emp_email,
        "name": f"{TAG}_Employee",
        "role": "employee",
        "password_hash": _hash("EmpPass#1"),
        "site_id": site_id,
        "company_id": company_id,
        "is_active": True,
    }).inserted_id

    # Paid order owned by the employee, from that vendor
    order_id = ObjectId()
    _db.orders.insert_one({
        "_id": order_id,
        "user_id": str(emp_uid),
        "vendor_id": vendor_id,
        "site_id": site_id,
        "company_id": company_id,
        "collection_code": f"{TAG}_ORD1",
        "status": "paid",
        "items": [{"name": "Paneer Wrap", "qty": 1, "price": 100}],
        "total": 100,
    })

    data = {
        "company_id": company_id,
        "site_id": site_id,
        "vendor_id": vendor_id,
        "vendor_email": vendor_email,
        "vendor_password": "VendorPass#1",
        "emp_email": emp_email,
        "emp_password": "EmpPass#1",
        "emp_id": str(emp_uid),
        "order_id": str(order_id),
    }
    yield data

    # ------------- teardown -------------
    _db.feedback.delete_many({"employee_id": str(emp_uid)})
    _db.orders.delete_one({"_id": order_id})
    _db.users.delete_one({"_id": emp_uid})
    _db.users.delete_one({"_id": vendor_uid})
    _db.vendors.delete_one({"_id": ObjectId(vendor_id)})
    _db.sites.delete_one({"_id": ObjectId(site_id)})


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    token = r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def emp_client(seeded):
    return _login(seeded["emp_email"], seeded["emp_password"])


@pytest.fixture(scope="module")
def vendor_client(seeded):
    return _login(seeded["vendor_email"], seeded["vendor_password"])


@pytest.fixture(scope="module")
def master_client():
    return _login("admin@cravitoo.com", "admin123")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
class TestFeedbackSubmit:
    def test_food_feedback_missing_rating_400(self, emp_client):
        r = emp_client.post(f"{BASE_URL}/api/feedback", json={"kind": "food", "comment": "no rating"})
        assert r.status_code == 400, r.text

    def test_food_feedback_success_no_order(self, emp_client):
        r = emp_client.post(f"{BASE_URL}/api/feedback", json={"kind": "food", "rating": 4, "comment": "nice"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("success") is True
        assert "id" in body

    def test_food_feedback_with_order_maps_vendor(self, emp_client, seeded):
        r = emp_client.post(f"{BASE_URL}/api/feedback", json={
            "kind": "food", "rating": 5, "order_id": seeded["order_id"], "comment": "loved it",
            "item_name": "Paneer Wrap",
        })
        assert r.status_code == 200, r.text
        fid = r.json()["id"]
        # verify persistence + mapping directly in DB
        doc = _db.feedback.find_one({"_id": ObjectId(fid)})
        assert doc is not None
        assert doc["vendor_id"] == seeded["vendor_id"]
        assert doc["site_id"] == seeded["site_id"]
        assert doc["company_id"] == seeded["company_id"]
        assert doc["order_code"] == f"{TAG}_ORD1"
        assert doc["rating"] == 5

    def test_food_feedback_bad_rating_out_of_range(self, emp_client):
        r = emp_client.post(f"{BASE_URL}/api/feedback", json={"kind": "food", "rating": 9})
        assert r.status_code == 400

    def test_issue_missing_note_rejected(self, emp_client):
        r = emp_client.post(f"{BASE_URL}/api/feedback", json={"kind": "issue", "category": "service"})
        assert r.status_code == 400, r.text

    def test_issue_invalid_category_rejected(self, emp_client):
        r = emp_client.post(f"{BASE_URL}/api/feedback", json={"kind": "issue", "category": "bogus", "comment": "x"})
        assert r.status_code == 400

    def test_issue_success(self, emp_client):
        r = emp_client.post(f"{BASE_URL}/api/feedback", json={
            "kind": "issue", "category": "hygiene", "comment": "tables were dirty",
        })
        assert r.status_code == 200, r.text
        assert r.json().get("success") is True

    def test_bad_kind_rejected(self, emp_client):
        r = emp_client.post(f"{BASE_URL}/api/feedback", json={"kind": "spam"})
        assert r.status_code == 400


class TestFeedbackRBAC:
    def test_master_cannot_submit(self, master_client):
        r = master_client.post(f"{BASE_URL}/api/feedback", json={"kind": "food", "rating": 3})
        assert r.status_code == 403, r.text

    def test_vendor_cannot_submit(self, vendor_client):
        r = vendor_client.post(f"{BASE_URL}/api/feedback", json={"kind": "food", "rating": 3})
        assert r.status_code == 403

    def test_employee_cannot_list_inbox(self, emp_client):
        r = emp_client.get(f"{BASE_URL}/api/feedback")
        assert r.status_code == 403

    def test_employee_own_feed(self, emp_client):
        r = emp_client.get(f"{BASE_URL}/api/employee/feedback")
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list)
        # We've submitted at least 3 above
        assert len(arr) >= 3
        # All entries should belong to this employee & be serialisable (id, no _id)
        for d in arr:
            assert "id" in d and "_id" not in d

    def test_vendor_cannot_hit_employee_feed(self, vendor_client):
        r = vendor_client.get(f"{BASE_URL}/api/employee/feedback")
        assert r.status_code == 403


class TestFeedbackInbox:
    def test_vendor_sees_only_mapped(self, vendor_client, seeded):
        r = vendor_client.get(f"{BASE_URL}/api/feedback")
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list)
        # at least our order-mapped food feedback
        mine = [d for d in docs if d.get("order_code") == f"{TAG}_ORD1"]
        assert len(mine) >= 1
        # ALL results must be scoped to this vendor
        for d in docs:
            assert d.get("vendor_id") == seeded["vendor_id"], f"leaked feedback: {d}"

    def test_master_sees_all(self, master_client, seeded):
        r = master_client.get(f"{BASE_URL}/api/feedback")
        assert r.status_code == 200
        docs = r.json()
        # should include our tagged item AND items with no vendor (the first food fb)
        codes = [d.get("order_code") for d in docs]
        assert f"{TAG}_ORD1" in codes

    def test_resolve_flow(self, vendor_client, master_client, seeded):
        # Find an OPEN mapped item from vendor inbox
        docs = vendor_client.get(f"{BASE_URL}/api/feedback").json()
        target = next((d for d in docs if d.get("order_code") == f"{TAG}_ORD1" and d.get("status") == "open"), None)
        assert target is not None, "no open mapped feedback to resolve"
        fid = target["id"]
        r = vendor_client.patch(f"{BASE_URL}/api/feedback/{fid}/resolve")
        assert r.status_code == 200
        assert r.json().get("success") is True
        # Verify persisted status
        after = _db.feedback.find_one({"_id": ObjectId(fid)})
        assert after["status"] == "resolved"

    def test_employee_cannot_resolve(self, emp_client, seeded):
        docs = _db.feedback.find({"employee_id": seeded["emp_id"]})
        fid = str(next(docs)["_id"])
        r = emp_client.patch(f"{BASE_URL}/api/feedback/{fid}/resolve")
        assert r.status_code == 403


class TestOrderOwnership:
    def test_cannot_attach_someone_elses_order(self, emp_client):
        # Insert a bogus order owned by another user
        other_order = _db.orders.insert_one({
            "user_id": "someone-else",
            "vendor_id": "x",
            "collection_code": f"{TAG}_OTHER",
            "status": "paid",
        }).inserted_id
        try:
            r = emp_client.post(f"{BASE_URL}/api/feedback", json={
                "kind": "food", "rating": 5, "order_id": str(other_order),
            })
            assert r.status_code == 403, r.text
        finally:
            _db.orders.delete_one({"_id": other_order})
