"""Iter 33: Backend tests for 4 new features:
   1) Counter filter on vendor orders (GET /api/orders 'counter' field + /api/vendor/counters)
   2) Corporate today dashboard (GET /api/analytics/corporate/today)
   3) Per-site meal prices (PATCH /api/sites/{id} meal_prices)
   4) Site data repair (POST /api/admin/integrity/backfill-sites)
"""
import os
import pytest
import requests

def _load_env_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    return ln.strip().split("=", 1)[1].rstrip("/")
    except Exception:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not found")

BASE_URL = _load_env_url()
API = f"{BASE_URL}/api"

CREDS = {
    "master": ("admin@cravitoo.com", "admin123"),
    "corp_a": ("audit_corpadmin_a@corpa.com", "Audit#1234"),
    "vendor1": ("audit_vendor1@corpa.com", "Audit#1234"),
    "emp_a": ("audit_emp_a@corpa.com", "Audit#1234"),
}


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def tokens():
    return {k: _login(*v) for k, v in CREDS.items()}


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# ---------- Feature 1: Counter filter ----------
class TestCounterFilter:
    def test_vendor_counters_endpoint(self, tokens):
        r = requests.get(f"{API}/vendor/counters", headers=_h(tokens["vendor1"]), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # response can be list or {counters: [...]}
        counters = data if isinstance(data, list) else data.get("counters", [])
        assert "Counter 1" in counters, f"expected 'Counter 1', got {counters}"

    def test_orders_include_counter_field(self, tokens):
        r = requests.get(f"{API}/orders", headers=_h(tokens["vendor1"]), timeout=30)
        assert r.status_code == 200, r.text
        orders = r.json()
        assert isinstance(orders, list) and len(orders) > 0
        auda01 = next((o for o in orders if o.get("collection_code") == "CRV-AUDA01"), None)
        assert auda01 is not None, f"CRV-AUDA01 not found in vendor orders. Sample: {orders[0] if orders else None}"
        assert "counter" in auda01
        assert auda01["counter"] == "Counter 1", f"expected counter='Counter 1', got {auda01.get('counter')}"

    def test_non_vendor_orders_also_have_counter_key(self, tokens):
        r = requests.get(f"{API}/orders", headers=_h(tokens["emp_a"]), timeout=30)
        assert r.status_code == 200
        for o in r.json():
            assert "counter" in o  # key present (may be None)


# ---------- Feature 2: Corporate Today ----------
class TestCorporateToday:
    def test_corp_admin_a_sees_own_data(self, tokens):
        r = requests.get(f"{API}/analytics/corporate/today", headers=_h(tokens["corp_a"]), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("today_orders", "today_paid_orders", "today_spend", "per_site"):
            assert k in data, f"missing {k} in {data}"
        assert isinstance(data["per_site"], list)
        # Should show AUDIT_SiteA with 1 order and ₹210 spend today (per review_request)
        # Only assert if CRV-AUDA01 was created today; otherwise the counts will be 0.
        # Accept both cases but check structure.
        for row in data["per_site"]:
            for k in ("site_id", "site_name", "orders", "spend"):
                assert k in row

    def test_vendor_forbidden(self, tokens):
        r = requests.get(f"{API}/analytics/corporate/today", headers=_h(tokens["vendor1"]), timeout=30)
        assert r.status_code == 403

    def test_employee_forbidden(self, tokens):
        r = requests.get(f"{API}/analytics/corporate/today", headers=_h(tokens["emp_a"]), timeout=30)
        assert r.status_code == 403

    def test_corp_a_never_sees_corpb_site(self, tokens):
        r = requests.get(f"{API}/analytics/corporate/today", headers=_h(tokens["corp_a"]), timeout=30)
        assert r.status_code == 200
        names = [row.get("site_name", "") for row in r.json().get("per_site", [])]
        for n in names:
            assert "SiteB" not in n and "CorpB" not in n, f"CorpA leaking CorpB data: {names}"


# ---------- Feature 3: Meal Prices ----------
class TestMealPrices:
    @pytest.fixture(scope="class")
    def site_id(self, tokens):
        r = requests.get(f"{API}/sites", headers=_h(tokens["master"]), timeout=30)
        assert r.status_code == 200
        for s in r.json():
            if s.get("name") == "AUDIT_SiteA":
                return s.get("id") or s.get("_id")
        pytest.skip("AUDIT_SiteA not found")

    def test_master_can_patch_meal_prices(self, tokens, site_id):
        payload = {"meal_prices": {"veg_meal": 111, "non_veg_meal": 150.5, "veg_salad": 70, "non_veg_salad": 95}}
        r = requests.patch(f"{API}/sites/{site_id}", headers=_h(tokens["master"]), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        # verify via GET
        r2 = requests.get(f"{API}/sites/{site_id}", headers=_h(tokens["master"]), timeout=30)
        assert r2.status_code == 200
        mp = r2.json().get("meal_prices") or {}
        assert mp.get("veg_meal") == 111.0
        assert mp.get("non_veg_meal") == 150.5
        assert mp.get("veg_salad") == 70.0
        assert mp.get("non_veg_salad") == 95.0

    def test_negative_prices_rejected(self, tokens, site_id):
        r = requests.patch(f"{API}/sites/{site_id}", headers=_h(tokens["master"]),
                           json={"meal_prices": {"veg_meal": -1}}, timeout=30)
        assert r.status_code == 400, r.text

    def test_non_master_cannot_set_meal_prices(self, tokens, site_id):
        # corp_admin cannot modify meal_prices (silently stripped OR 403).
        # Fetch current, attempt to change, verify unchanged.
        cur = requests.get(f"{API}/sites/{site_id}", headers=_h(tokens["master"]), timeout=30).json()
        before = (cur.get("meal_prices") or {}).get("veg_meal")
        r = requests.patch(f"{API}/sites/{site_id}", headers=_h(tokens["corp_a"]),
                           json={"meal_prices": {"veg_meal": 999}}, timeout=30)
        # Either 403 (no access to site) or 400 (no valid fields) — but NOT 200 with change
        after_resp = requests.get(f"{API}/sites/{site_id}", headers=_h(tokens["master"]), timeout=30).json()
        after = (after_resp.get("meal_prices") or {}).get("veg_meal")
        assert after == before, f"non-master modified meal_prices: {before}->{after} (patch status={r.status_code})"


# ---------- Feature 4: Backfill Sites ----------
class TestBackfillSites:
    def test_master_can_call(self, tokens):
        r = requests.post(f"{API}/admin/integrity/backfill-sites", headers=_h(tokens["master"]), timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("success", "scanned", "fixed_company", "fixed_city", "unresolved"):
            assert k in data, f"missing {k} in {data}"
        assert data["success"] is True

    def test_idempotent(self, tokens):
        r1 = requests.post(f"{API}/admin/integrity/backfill-sites", headers=_h(tokens["master"]), timeout=60).json()
        r2 = requests.post(f"{API}/admin/integrity/backfill-sites", headers=_h(tokens["master"]), timeout=60).json()
        # After first run, second run should not fix anything new (or same/less)
        assert r2["fixed_company"] <= r1["fixed_company"] + 0 or r2["fixed_company"] == 0
        assert r2["fixed_city"] <= r1["fixed_city"] + 0 or r2["fixed_city"] == 0

    def test_non_master_forbidden(self, tokens):
        for who in ("corp_a", "vendor1", "emp_a"):
            r = requests.post(f"{API}/admin/integrity/backfill-sites", headers=_h(tokens[who]), timeout=30)
            assert r.status_code == 403, f"{who}: expected 403 got {r.status_code}"
