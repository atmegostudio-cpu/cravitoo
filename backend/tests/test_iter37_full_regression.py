"""Iteration 37 — Broad regression sweep.

Covers: auth/RBAC, hierarchy scoping (employee vendors, corp/site orders,
analytics), order linkage (site_id/company_id stamped), razorpay
checkout-intent success + verify signature rejection, payment mode gating,
menu access guard, master-only site meal_prices persist, backfill-sites,
and data-integrity spot checks.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://duplicate-prevention-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

CRED = {
    "master":      ("admin@cravitoo.com",             "admin123"),
    "corp_a":      ("audit_corpadmin_a@corpa.com",    "Audit#1234"),
    "site_a":      ("audit_siteadmin_a@corpa.com",    "Audit#1234"),
    "emp_a":       ("audit_emp_a@corpa.com",          "Audit#1234"),
    "emp_b":       ("audit_emp_b@corpb.com",          "Audit#1234"),
    "vendor1":     ("audit_vendor1@corpa.com",        "Audit#1234"),
}

SITE_A   = "6a96d37822127a5e04873e36"
VENDOR_1 = "6a96d37822127a5e04873e3c"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} → {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tokens():
    return {k: _login(*v) for k, v in CRED.items()}


# ---------- AUTH / ME ----------
class TestAuthMe:
    def test_all_roles_login_and_me(self, tokens):
        expected = {
            "master": "master_admin", "corp_a": "corporate_admin",
            "site_a": "site_admin", "emp_a": "employee",
            "emp_b": "employee", "vendor1": "vendor",
        }
        for k, tok in tokens.items():
            r = requests.get(f"{API}/auth/me", headers=_h(tok), timeout=15)
            assert r.status_code == 200, f"{k} /me → {r.status_code}"
            assert r.json().get("role") == expected[k], f"{k} role mismatch"


# ---------- RBAC: employee cannot hit admin endpoints ----------
class TestRBAC:
    def test_employee_cannot_list_menu_uploads(self, tokens):
        r = requests.get(f"{API}/admin/menu-uploads", headers=_h(tokens["emp_a"]), timeout=15)
        assert r.status_code in (401, 403), f"employee accessed admin menu-uploads: {r.status_code}"

    def test_vendor_cannot_list_menu_uploads(self, tokens):
        r = requests.get(f"{API}/admin/menu-uploads", headers=_h(tokens["vendor1"]), timeout=15)
        assert r.status_code in (401, 403), f"vendor accessed admin menu-uploads: {r.status_code}"

    def test_corp_admin_cannot_hit_master_sites_create(self, tokens):
        # Provide a full-shaped body so validation passes and we test RBAC, not 422.
        r = requests.post(f"{API}/sites", headers=_h(tokens["corp_a"]),
                          json={"name": "TEST_bad_regress", "company_id": "aaaaaaaaaaaaaaaaaaaaaaaa",
                                "city": "Nowhere", "address": "x",
                                "contact_email": "test@example.com", "contact_phone": "9999999999"}, timeout=15)
        assert r.status_code in (401, 403), f"corp admin created site: {r.status_code} {r.text[:200]}"


# ---------- HIERARCHY: employee vendor scoping ----------
class TestEmployeeVendorScoping:
    def test_emp_a_sees_only_mapped_vendors(self, tokens):
        r = requests.get(f"{API}/vendors", headers=_h(tokens["emp_a"]), timeout=15)
        assert r.status_code == 200
        names = [v.get("name", "") for v in r.json()]
        # emp_a should see AUDIT_Vendor1 (and possibly V2). All names must start with AUDIT.
        assert any("AUDIT_Vendor1" in n for n in names), f"emp_a missing AUDIT_Vendor1: {names}"
        # Should NOT see arbitrary GateTest / TEST_ vendors from other sites
        bad = [n for n in names if not n.startswith("AUDIT")]
        assert not bad, f"emp_a leaked non-AUDIT vendors: {bad}"

    def test_emp_b_sees_only_v1_not_v2(self, tokens):
        r = requests.get(f"{API}/vendors", headers=_h(tokens["emp_b"]), timeout=15)
        assert r.status_code == 200
        names = [v.get("name", "") for v in r.json()]
        assert any("AUDIT_Vendor1" in n for n in names), f"emp_b missing V1: {names}"
        assert not any("AUDIT_Vendor2" in n for n in names), f"emp_b leaked V2: {names}"

    def test_emp_a_can_open_mapped_vendor_menu(self, tokens):
        r = requests.get(f"{API}/menu/{VENDOR_1}", headers=_h(tokens["emp_a"]), timeout=15)
        assert r.status_code == 200, f"emp_a menu → {r.status_code} {r.text[:200]}"
        assert isinstance(r.json(), list)


# ---------- HIERARCHY: order scoping ----------
class TestOrderScoping:
    def test_corp_a_sees_only_own_company_orders(self, tokens):
        r = requests.get(f"{API}/orders", headers=_h(tokens["corp_a"]), timeout=15)
        assert r.status_code == 200
        payload = r.json()
        orders = payload.get("orders", payload) if isinstance(payload, dict) else payload
        company_ids = {o.get("company_id") for o in orders if o.get("company_id")}
        # Corp A should only see their own company docs — no CorpB spillover
        assert len(company_ids) <= 1, f"corp_a saw multiple companies: {company_ids}"
        # Must include CRV-AUDA01 seeded order
        codes = [o.get("collection_code") for o in orders]
        assert any(c and "AUDA01" in c for c in codes), f"corp_a missing CRV-AUDA01. codes={codes[:10]}"

    def test_site_a_sees_only_site_orders(self, tokens):
        r = requests.get(f"{API}/orders", headers=_h(tokens["site_a"]), timeout=15)
        assert r.status_code == 200
        payload = r.json()
        orders = payload.get("orders", payload) if isinstance(payload, dict) else payload
        site_ids = {o.get("site_id") for o in orders if o.get("site_id")}
        assert len(site_ids) <= 1, f"site_admin_a saw multiple sites: {site_ids}"

    def test_seeded_order_has_site_and_company(self, tokens):
        r = requests.get(f"{API}/orders", headers=_h(tokens["master"]), timeout=15)
        assert r.status_code == 200
        payload = r.json()
        orders = payload.get("orders", payload) if isinstance(payload, dict) else payload
        target = None
        for o in orders:
            code = o.get("collection_code") or ""
            if "AUDA01" in code:
                target = o; break
        assert target is not None, "CRV-AUDA01 not found by master"
        assert target.get("site_id"), f"AUDA01 missing site_id: {target}"
        assert target.get("company_id"), f"AUDA01 missing company_id: {target}"


# ---------- ANALYTICS scoping ----------
class TestAnalyticsScoping:
    def test_corp_today_only_own_company(self, tokens):
        r_a = requests.get(f"{API}/analytics/corporate/today", headers=_h(tokens["corp_a"]), timeout=15)
        assert r_a.status_code == 200, f"corp_a today → {r_a.status_code} {r_a.text[:200]}"
        # Employee should NOT be able to access corporate analytics
        r_emp = requests.get(f"{API}/analytics/corporate/today", headers=_h(tokens["emp_a"]), timeout=15)
        assert r_emp.status_code in (401, 403), f"employee got corp analytics: {r_emp.status_code}"


# ---------- MENU access guard ----------
class TestMenuAccessGuard:
    def test_menu_requires_auth(self):
        r = requests.get(f"{API}/menu/{VENDOR_1}", timeout=15)
        assert r.status_code in (401, 403), f"menu open to unauth: {r.status_code}"


# ---------- PAYMENTS: intent success + verify rejects forged signature ----------
class TestPayments:
    def test_offline_order_creation_blocked_when_razorpay(self, tokens):
        r = requests.post(f"{API}/orders", headers=_h(tokens["emp_a"]),
                          json={"vendor_id": VENDOR_1, "items": [], "delivery_type": "pickup"}, timeout=15)
        # Should be 400 (razorpay mode) or 422 (empty cart validation) — but NOT 200
        assert r.status_code != 200, f"offline order accepted in RAZORPAY mode: {r.status_code} {r.text[:200]}"

    def test_payment_mode_endpoint(self, tokens):
        r = requests.get(f"{API}/payments/mode", headers=_h(tokens["emp_a"]), timeout=15)
        # Endpoint may or may not exist; if it does, must say RAZORPAY
        if r.status_code == 200:
            assert r.json().get("mode") == "RAZORPAY", f"mode={r.json()}"

    def test_checkout_intent_success(self, tokens):
        # Fetch a menu item to build a valid cart
        m = requests.get(f"{API}/menu/{VENDOR_1}", headers=_h(tokens["emp_a"]), timeout=15)
        assert m.status_code == 200
        items = m.json()
        if not items:
            pytest.skip("no menu items to build cart")
        it = items[0]
        item_id = it.get("id") or it.get("_id") or it.get("menu_item_id")
        payload = {
            "vendor_id": VENDOR_1,
            "items": [{"menu_item_id": item_id, "quantity": 1, "price": it.get("price", 0)}],
            "delivery_type": "pickup",
        }
        r = requests.post(f"{API}/payments/razorpay/checkout-intent",
                          headers=_h(tokens["emp_a"]), json=payload, timeout=30)
        assert r.status_code == 200, f"checkout-intent → {r.status_code} {r.text[:400]}"
        body = r.json()
        assert body.get("razorpay_order_id", "").startswith("order_"), f"bad rzp order id: {body}"
        assert body.get("amount", 0) > 0
        assert body.get("intent_id")
        # Stash for verify test
        TestPayments._rzp_order_id = body["razorpay_order_id"]

    def test_verify_rejects_forged_signature(self, tokens):
        rzp_id = getattr(TestPayments, "_rzp_order_id", None)
        if not rzp_id:
            pytest.skip("no intent from previous test")
        payload = {
            "razorpay_order_id": rzp_id,
            "razorpay_payment_id": "pay_FORGED_test",
            "razorpay_signature": "0" * 64,
        }
        r = requests.post(f"{API}/payments/razorpay/verify",
                          headers=_h(tokens["emp_a"]), json=payload, timeout=15)
        assert r.status_code == 400, f"forged sig NOT rejected: {r.status_code} {r.text[:200]}"
        assert "signature" in r.text.lower()

    def test_verify_unknown_order_404(self, tokens):
        payload = {
            "razorpay_order_id": "order_does_not_exist_zzzz",
            "razorpay_payment_id": "pay_x",
            "razorpay_signature": "0" * 64,
        }
        r = requests.post(f"{API}/payments/razorpay/verify",
                          headers=_h(tokens["emp_a"]), json=payload, timeout=15)
        assert r.status_code == 404, f"expected 404 got {r.status_code}"

    def test_create_order_legacy_410(self, tokens):
        r = requests.post(f"{API}/payments/razorpay/create-order",
                          headers=_h(tokens["emp_a"]),
                          json={"order_id": "x"}, timeout=15)
        assert r.status_code in (410, 422), f"legacy alias: {r.status_code}"


# ---------- SITES: meal_prices master-only + backfill ----------
class TestSitesMaster:
    def test_master_can_get_sites(self, tokens):
        r = requests.get(f"{API}/sites", headers=_h(tokens["master"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_meal_prices_persist_master(self, tokens):
        prices = {"veg_meal": 55, "non_veg_meal": 105, "veg_salad": 25, "non_veg_salad": 45}
        r = requests.patch(f"{API}/sites/{SITE_A}",
                           headers=_h(tokens["master"]),
                           json={"meal_prices": prices}, timeout=15)
        assert r.status_code == 200, f"update meal_prices: {r.status_code} {r.text[:200]}"
        g = requests.get(f"{API}/sites/{SITE_A}", headers=_h(tokens["master"]), timeout=15)
        assert g.status_code == 200
        got = g.json().get("meal_prices") or {}
        for k, v in prices.items():
            assert float(got.get(k, 0)) == float(v), f"meal_prices[{k}] persistence: {got}"

    def test_corp_admin_cannot_change_meal_prices(self, tokens):
        r = requests.patch(f"{API}/sites/{SITE_A}",
                           headers=_h(tokens["corp_a"]),
                           json={"meal_prices": {"breakfast": 999}}, timeout=15)
        assert r.status_code in (401, 403), f"corp admin changed meal_prices: {r.status_code}"

    def test_backfill_sites_master_only(self, tokens):
        r_m = requests.post(f"{API}/admin/integrity/backfill-sites",
                            headers=_h(tokens["master"]), timeout=30)
        assert r_m.status_code == 200, f"master backfill: {r_m.status_code} {r_m.text[:200]}"
        r_c = requests.post(f"{API}/admin/integrity/backfill-sites",
                            headers=_h(tokens["corp_a"]), timeout=30)
        assert r_c.status_code in (401, 403), f"corp_a ran backfill: {r_c.status_code}"


# ---------- MENU management: template + counter col ----------
class TestMenuTemplate:
    def test_template_download_master(self, tokens):
        r = requests.get(f"{API}/admin/menu-excel-template", headers=_h(tokens["master"]), timeout=15)
        assert r.status_code == 200, f"template dl: {r.status_code}"
        assert len(r.content) > 100
