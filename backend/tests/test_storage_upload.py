"""Regression tests for Emergent Object Storage-backed vendor document uploads.

Covers the fix for the "File not found" bug in production where uploaded
onboarding documents were stored on ephemeral local disk (/tmp) and were
lost after every redeploy / pod restart.

Key scenarios:
  1. /api/health still returns 200 (startup + object storage init).
  2. Upload PDF/PNG under /api/onboarding/vendors/{id}/documents/{doc_type}
     returns a `s_`-prefixed URL and stores canonical `cravitoo/onboarding/...`
     path in the DB.
  3. Round-trip: GET the URL immediately -> bytes match, correct MIME.
  4. **Persistence** — restart backend supervisor and re-GET the URL:
     still 200 (this is what regressed in production).
  5. 10 MB size limit rejection.
  6. Disallowed extension (.txt) rejection.
  7. DELETE removes DB entry; the object itself is retained (soft delete).
  8. Malformed s_-token -> 404 (not 500).
  9. Legacy filename fallback -> friendly 404.
 10. Access control — unauthenticated POST -> 401/403.
"""
from __future__ import annotations

import hashlib
import io
import os
import subprocess
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://duplicate-prevention-4.preview.emergentagent.com",
).rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")

# ---------------- helpers -----------------


def _minimal_pdf_bytes() -> bytes:
    """A valid, minimal PDF (~350 bytes). Real enough for Content-Type sniffers."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n"
        b"0000000010 00000 n \n0000000053 00000 n \n0000000102 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n165\n%%EOF\n"
    )


def _minimal_png_bytes() -> bytes:
    # 1x1 transparent PNG
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00"
        b"\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )


# ---------------- fixtures -----------------


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def scratch(admin):
    """Create a scratch City -> Corporate Client -> Site -> Onboarding chain and yield ids.

    Cleans up all created rows on teardown.
    """
    ids = {}

    # 1) City
    r = admin.post(
        f"{BASE_URL}/api/cities",
        json={"name": f"TEST_City_{uuid.uuid4().hex[:6]}", "state": "Karnataka"},
    )
    assert r.status_code in (200, 201), f"create city failed: {r.status_code} {r.text}"
    ids["city_id"] = r.json()["id"]

    # 2) Corporate client
    r = admin.post(
        f"{BASE_URL}/api/master/corporate-clients",
        json={
            "name": f"TEST_Corp_{uuid.uuid4().hex[:6]}",
            "address": "123 Test St",
            "contact_email": f"corp_{uuid.uuid4().hex[:6]}@example.com",
            "contact_phone": "9000000000",
        },
    )
    assert r.status_code in (200, 201), f"create client failed: {r.status_code} {r.text}"
    ids["client_id"] = r.json()["id"]

    # 3) Site (needs city_id, address, city, contact_email, contact_phone)
    r = admin.post(
        f"{BASE_URL}/api/sites",
        json={
            "name": f"TEST_Site_{uuid.uuid4().hex[:6]}",
            "company_id": ids["client_id"],
            "city_id": ids["city_id"],
            "address": "456 Test Rd",
            "city": "Bengaluru",
            "contact_email": f"site_{uuid.uuid4().hex[:6]}@example.com",
            "contact_phone": "9111111111",
        },
    )
    assert r.status_code in (200, 201), f"create site failed: {r.status_code} {r.text}"
    ids["site_id"] = r.json()["id"]

    # 4) Vendor Onboarding
    r = admin.post(
        f"{BASE_URL}/api/onboarding/vendors",
        json={
            "vendor_name": f"TEST__vendor_{uuid.uuid4().hex[:6]}",
            "company_name": "Test Foods Pvt Ltd",
            "contact_person": "Test Person",
            "mobile_number": "9222222222",
            "email": f"vendor_{uuid.uuid4().hex[:6]}@example.com",
            "business_address": "789 Vendor Ln",
            "site_id": ids["site_id"],
        },
    )
    assert r.status_code in (200, 201), f"create onboarding failed: {r.status_code} {r.text}"
    ids["onb_id"] = r.json()["id"]

    yield ids

    # ----------- cleanup -----------
    try:
        admin.delete(f"{BASE_URL}/api/onboarding/vendors/{ids['onb_id']}")
    except Exception:
        pass
    try:
        admin.delete(f"{BASE_URL}/api/sites/{ids['site_id']}")
    except Exception:
        pass
    try:
        admin.delete(
            f"{BASE_URL}/api/master/corporate-clients/{ids['client_id']}",
            params={"cascade": "true"},
        )
    except Exception:
        pass
    try:
        admin.delete(f"{BASE_URL}/api/cities/{ids['city_id']}")
    except Exception:
        pass


# ---------------- tests -----------------


class TestHealthAndStartup:
    def test_health_ok(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=15)
        assert r.status_code == 200


class TestObjectStorageUpload:
    """Round-trip test — the core of the bug fix."""

    def test_pdf_upload_returns_encoded_url(self, admin, scratch):
        onb_id = scratch["onb_id"]
        pdf = _minimal_pdf_bytes()
        r = admin.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/documents/gst_certificate",
            files={"file": ("test.pdf", pdf, "application/pdf")},
        )
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
        data = r.json()
        assert data["doc_type"] == "gst_certificate"
        assert "url" in data and "/api/uploads/s_" in data["url"], (
            f"expected s_-prefixed url, got {data.get('url')!r}"
        )
        assert data.get("filename")

        # verify DB record has canonical cravitoo/onboarding path
        r = admin.get(f"{BASE_URL}/api/onboarding/vendors/{onb_id}")
        assert r.status_code == 200
        docs = r.json()["documents"]
        assert "gst_certificate" in docs
        sp = docs["gst_certificate"]["storage_path"]
        assert sp.startswith(f"cravitoo/onboarding/{onb_id}/gst_certificate_"), (
            f"unexpected storage_path: {sp}"
        )
        assert sp.endswith(".pdf")

        # stash url for round-trip test
        scratch["_gst_url"] = data["url"]
        scratch["_gst_hash"] = hashlib.sha256(pdf).hexdigest()
        scratch["_gst_len"] = len(pdf)

    def test_pdf_download_bytes_roundtrip(self, admin, scratch):
        url = scratch.get("_gst_url")
        assert url, "prior upload test must run first"
        # url can be absolute (with PUBLIC_BACKEND_URL) or /api/uploads/... path
        full = url if url.startswith("http") else f"{BASE_URL}{url}"
        r = admin.get(full)
        assert r.status_code == 200, f"download failed: {r.status_code} {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("application/pdf"), (
            f"unexpected content-type: {r.headers.get('content-type')!r}"
        )
        assert len(r.content) == scratch["_gst_len"]
        assert hashlib.sha256(r.content).hexdigest() == scratch["_gst_hash"]

    def test_persistence_across_backend_restart(self, admin, scratch):
        """THE KEY REGRESSION TEST — /tmp files would 404 after restart."""
        url = scratch.get("_gst_url")
        assert url, "prior upload test must run first"
        # Restart backend supervisor
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=True, timeout=30)
        # Wait for backend to come back up
        full = url if url.startswith("http") else f"{BASE_URL}{url}"
        deadline = time.time() + 45
        last = None
        while time.time() < deadline:
            try:
                h = requests.get(f"{BASE_URL}/api/health", timeout=5)
                if h.status_code == 200:
                    break
            except Exception as e:
                last = e
            time.sleep(1.5)
        else:
            pytest.fail(f"backend did not come back up: {last}")
        # Re-login (cookies may be intact but be safe)
        s = requests.Session()
        s.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        )
        r = s.get(full)
        assert r.status_code == 200, (
            f"POST-RESTART 404 REGRESSION: {r.status_code} {r.text[:200]}"
        )
        assert len(r.content) == scratch["_gst_len"]

    def test_png_upload_and_download(self, admin, scratch):
        onb_id = scratch["onb_id"]
        png = _minimal_png_bytes()
        r = admin.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/documents/pan_card",
            files={"file": ("id.png", png, "image/png")},
        )
        assert r.status_code == 200, f"png upload failed: {r.status_code} {r.text}"
        url = r.json()["url"]
        full = url if url.startswith("http") else f"{BASE_URL}{url}"
        d = admin.get(full)
        assert d.status_code == 200
        assert d.headers.get("content-type", "").startswith("image/png")
        assert d.content == png


class TestValidation:
    def test_too_large_rejected(self, admin, scratch):
        onb_id = scratch["onb_id"]
        big = b"%PDF-1.4\n" + b"0" * (10 * 1024 * 1024 + 100)
        r = admin.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/documents/fssai_license",
            files={"file": ("big.pdf", big, "application/pdf")},
        )
        assert r.status_code == 400
        assert "10 MB" in r.text or "10MB" in r.text

    def test_bad_extension_rejected(self, admin, scratch):
        onb_id = scratch["onb_id"]
        r = admin.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/documents/bank_details",
            files={"file": ("notes.txt", b"hello", "text/plain")},
        )
        assert r.status_code == 400
        assert "PDF" in r.text and "PNG" in r.text

    def test_invalid_s_token_returns_404(self):
        # base64-decodable but not-a-real path is fine; test malformed padding path
        r = requests.get(f"{BASE_URL}/api/uploads/s_INVALIDPADDING!")
        assert r.status_code == 404, f"expected 404 got {r.status_code} {r.text[:120]}"

    def test_legacy_filename_missing_returns_friendly_404(self):
        r = requests.get(f"{BASE_URL}/api/uploads/onb_deadbeef.pdf")
        assert r.status_code == 404
        # friendly message from serve_upload legacy branch
        assert "re-upload" in r.text.lower() or "not found" in r.text.lower()


class TestDeleteSoftDelete:
    def test_delete_removes_db_entry_only(self, admin, scratch):
        onb_id = scratch["onb_id"]
        # Ensure there's a doc — reupload one just to be safe.
        r = admin.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/documents/shop_establishment",
            files={"file": ("a.pdf", _minimal_pdf_bytes(), "application/pdf")},
        )
        assert r.status_code == 200
        url = r.json()["url"]
        full = url if url.startswith("http") else f"{BASE_URL}{url}"

        # Delete DB entry
        d = admin.delete(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/documents/shop_establishment"
        )
        assert d.status_code == 200

        # DB no longer has the doc
        g = admin.get(f"{BASE_URL}/api/onboarding/vendors/{onb_id}")
        assert g.status_code == 200
        assert "shop_establishment" not in g.json()["documents"]

        # Object still exists (soft-delete)
        obj = admin.get(full)
        assert obj.status_code == 200, (
            f"expected object to still be in storage (soft delete), got {obj.status_code}"
        )


class TestAccessControl:
    def test_unauthenticated_upload_denied(self, scratch):
        onb_id = scratch["onb_id"]
        r = requests.post(
            f"{BASE_URL}/api/onboarding/vendors/{onb_id}/documents/gst_certificate",
            files={"file": ("x.pdf", _minimal_pdf_bytes(), "application/pdf")},
        )
        assert r.status_code in (401, 403), (
            f"expected 401/403, got {r.status_code} {r.text[:120]}"
        )
