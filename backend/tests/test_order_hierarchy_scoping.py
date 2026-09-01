"""Backend tests for order-to-hierarchy linkage and role-based order scoping (iter 32).

Covers:
- Orders carry site_id and company_id (via seeded AUDIT orders).
- GET /api/orders role scoping: master (all), corporate_admin, site_admin, employee, cross-company isolation.
- Employee vendor list site-scoping regression (emp A -> V1,V2; emp B -> V1 only).
- Menu access guard (200 for mapped vendor, 403 for unmapped) for employee.
- POST /api/admin/integrity/backfill-orders master-only, idempotent, returns expected keys.
"""
import os
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

CREDS = {
    "master":        ("admin@cravitoo.com",              "admin123"),
    "corp_a":        ("audit_corpadmin_a@corpa.com",     "Audit#1234"),
    "site_a":        ("audit_siteadmin_a@corpa.com",     "Audit#1234"),
    "emp_a":         ("audit_emp_a@corpa.com",           "Audit#1234"),
    "emp_b":         ("audit_emp_b@corpb.com",           "Audit#1234"),
    "vendor1":       ("audit_vendor1@corpa.com",         "Audit#1234"),
}

_tokens = {}


def _login(role):
    if role in _tokens:
        return _tokens[role]
    email, pw = CREDS[role]
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login {role} failed: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok, f"no token in login response for {role}: {body}"
    _tokens[role] = tok
    return tok


def _h(role):
    return {"Authorization": f"Bearer {_login(role)}"}


def _get_orders(role):
    r = requests.get(f"{BASE_URL}/api/orders", headers=_h(role), timeout=30)
    assert r.status_code == 200, f"{role}: {r.status_code} {r.text}"
    return r.json()


# --- Order linkage: seeded AUDIT orders carry site_id & company_id ---

def test_master_sees_all_orders_and_audit_orders_have_linkage():
    orders = _get_orders("master")
    assert isinstance(orders, list) and len(orders) >= 2
    audit = [o for o in orders if o.get("collection_code") in ("CRV-AUDA01", "CRV-AUDB01")]
    codes = {o["collection_code"] for o in audit}
    assert {"CRV-AUDA01", "CRV-AUDB01"}.issubset(codes), f"missing seeded audit orders: {codes}"
    for o in audit:
        assert o.get("site_id"), f"order {o['collection_code']} missing site_id: {o}"
        assert o.get("company_id"), f"order {o['collection_code']} missing company_id: {o}"


# --- Role scoping ---

def test_corporate_admin_a_sees_only_corp_a_order():
    orders = _get_orders("corp_a")
    codes = [o.get("collection_code") for o in orders]
    assert len(orders) == 1, f"corp_admin_a expected 1 order, got {len(orders)}: {codes}"
    assert codes[0] == "CRV-AUDA01"
    assert "CRV-AUDB01" not in codes


def test_site_admin_a_sees_only_site_a_order():
    orders = _get_orders("site_a")
    codes = [o.get("collection_code") for o in orders]
    assert len(orders) == 1, f"site_admin_a expected 1 order, got {len(orders)}: {codes}"
    assert codes[0] == "CRV-AUDA01"


def test_employee_a_sees_only_own_order():
    orders = _get_orders("emp_a")
    codes = [o.get("collection_code") for o in orders]
    assert len(orders) == 1, f"emp_a expected 1 order, got {len(orders)}: {codes}"
    assert codes[0] == "CRV-AUDA01"


def test_cross_company_isolation_corp_a_never_sees_corp_b():
    orders = _get_orders("corp_a")
    for o in orders:
        assert o.get("collection_code") != "CRV-AUDB01"


# --- Vendor site-scoping regression for AUDIT employees ---

def _vendor_names(role):
    r = requests.get(f"{BASE_URL}/api/vendors", headers=_h(role), timeout=30)
    assert r.status_code == 200, r.text
    return [v.get("name") or v.get("business_name") for v in r.json()], r.json()


def test_employee_a_sees_audit_vendor1_and_vendor2():
    names, vendors = _vendor_names("emp_a")
    assert "AUDIT_Vendor1" in names, f"emp_a vendors: {names}"
    assert "AUDIT_Vendor2" in names, f"emp_a vendors: {names}"


def test_employee_b_sees_only_audit_vendor1():
    names, vendors = _vendor_names("emp_b")
    assert "AUDIT_Vendor1" in names, f"emp_b vendors: {names}"
    assert "AUDIT_Vendor2" not in names, f"emp_b should NOT see V2, got: {names}"


# --- Menu access guard regression ---

def _vendor_id_by_name(role, name):
    _, vendors = _vendor_names(role)
    for v in vendors:
        if (v.get("name") or v.get("business_name")) == name:
            return v["id"]
    return None


def test_menu_guard_allows_mapped_and_blocks_unmapped_for_emp_b():
    # emp_b's site has ONLY AUDIT_Vendor1 mapped; V2 exists globally (visible to master) but not mapped to SiteB.
    v1 = _vendor_id_by_name("master", "AUDIT_Vendor1")
    v2 = _vendor_id_by_name("master", "AUDIT_Vendor2")
    assert v1 and v2, f"missing audit vendor ids: v1={v1} v2={v2}"

    r_ok = requests.get(f"{BASE_URL}/api/menu/{v1}", headers=_h("emp_b"), timeout=30)
    assert r_ok.status_code == 200, f"emp_b should access V1 menu: {r_ok.status_code} {r_ok.text}"

    r_blocked = requests.get(f"{BASE_URL}/api/menu/{v2}", headers=_h("emp_b"), timeout=30)
    assert r_blocked.status_code == 403, f"emp_b should be 403 on V2 menu, got {r_blocked.status_code} {r_blocked.text}"


# --- Backfill endpoint ---

def test_backfill_orders_master_only_and_idempotent():
    # non-master denied
    r_bad = requests.post(f"{BASE_URL}/api/admin/integrity/backfill-orders", headers=_h("corp_a"), timeout=60)
    assert r_bad.status_code == 403, f"corp_admin should get 403, got {r_bad.status_code} {r_bad.text}"

    r1 = requests.post(f"{BASE_URL}/api/admin/integrity/backfill-orders", headers=_h("master"), timeout=60)
    assert r1.status_code == 200, f"{r1.status_code} {r1.text}"
    body1 = r1.json()
    for key in ("success", "scanned", "fixed_site", "fixed_company", "unresolved"):
        assert key in body1, f"missing key {key} in {body1}"
    assert body1["success"] is True

    # idempotent — second run should fix 0 (or at most same unresolved count)
    r2 = requests.post(f"{BASE_URL}/api/admin/integrity/backfill-orders", headers=_h("master"), timeout=60)
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["fixed_site"] == 0, f"expected idempotent fixed_site=0, got {body2}"
    assert body2["fixed_company"] == 0, f"expected idempotent fixed_company=0, got {body2}"
