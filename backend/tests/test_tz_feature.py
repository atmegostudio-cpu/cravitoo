"""Feature A (Sub-Admin Preview data prerequisites) + Feature B (per-site timezone) backend tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

NY_SITE_ID = "6aa1622f0455f997d5af12cf"


@pytest.fixture(scope="module")
def master_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@cravitoo.com", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def operator_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "tz_operator@cravitoo.com", "password": "Pass1234"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(t): return {"Authorization": f"Bearer {t}"}


class TestSitesTimezone:
    def test_sites_list_returns_timezone_field(self, master_token):
        r = requests.get(f"{BASE_URL}/api/sites", headers=_h(master_token))
        assert r.status_code == 200
        sites = r.json()
        assert isinstance(sites, list) and len(sites) > 0
        # every site should have a timezone key (default Asia/Kolkata)
        missing = [s for s in sites if "timezone" not in s]
        assert not missing, f"Sites without timezone field: {[s.get('id') for s in missing]}"
        ny = [s for s in sites if s.get("id") == NY_SITE_ID]
        assert ny, f"NY site {NY_SITE_ID} not found"
        assert ny[0]["timezone"] == "America/New_York", f"got {ny[0]['timezone']}"

    def test_patch_site_timezone_persists(self, master_token):
        # pick a site that isn't the NY one
        r = requests.get(f"{BASE_URL}/api/sites", headers=_h(master_token))
        target = next(s for s in r.json() if s["id"] != NY_SITE_ID)
        original_tz = target.get("timezone", "Asia/Kolkata")
        try:
            r2 = requests.patch(f"{BASE_URL}/api/sites/{target['id']}",
                                headers=_h(master_token),
                                json={"timezone": "Europe/London"})
            assert r2.status_code in (200, 204), r2.text
            r3 = requests.get(f"{BASE_URL}/api/sites", headers=_h(master_token))
            updated = next(s for s in r3.json() if s["id"] == target["id"])
            assert updated["timezone"] == "Europe/London"
        finally:
            requests.patch(f"{BASE_URL}/api/sites/{target['id']}",
                           headers=_h(master_token),
                           json={"timezone": original_tz})


class TestOrdersSiteTimezone:
    def test_all_outlets_orders_has_site_timezone(self, operator_token):
        r = requests.get(f"{BASE_URL}/api/vendor/all-outlets-orders",
                         headers=_h(operator_token))
        assert r.status_code == 200, r.text
        payload = r.json()
        orders = payload.get("orders") if isinstance(payload, dict) else payload
        assert orders, "no orders returned for tz_operator"
        tzs = {o.get("site_timezone") for o in orders}
        assert "America/New_York" in tzs, f"expected NY tz among {tzs}"
        assert "Asia/Kolkata" in tzs, f"expected IST tz among {tzs}"
        auda01 = [o for o in orders if o.get("collection_code") == "CRV-AUDA01"]
        assert auda01, "CRV-AUDA01 order not found"
        assert auda01[0]["site_timezone"] == "America/New_York"
        audb01 = [o for o in orders if o.get("collection_code") == "CRV-AUDB01"]
        if audb01:
            assert audb01[0]["site_timezone"] == "Asia/Kolkata"

    def test_orders_endpoint_returns_site_timezone(self, operator_token):
        r = requests.get(f"{BASE_URL}/api/orders", headers=_h(operator_token))
        assert r.status_code == 200
        orders = r.json()
        if orders:
            assert any("site_timezone" in o for o in orders), \
                "at least some /api/orders rows should have site_timezone"


class TestSubAdminPreviewData:
    def test_permission_catalog_available(self, master_token):
        r = requests.get(f"{BASE_URL}/api/admin/permission-catalog",
                         headers=_h(master_token))
        assert r.status_code == 200
        cat = r.json()
        # accept list-of-strings or list-of-objects
        assert isinstance(cat, (list, dict)) and cat

    def test_sub_admins_list(self, master_token):
        r = requests.get(f"{BASE_URL}/api/admin/sub-admins", headers=_h(master_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)
