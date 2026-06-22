"""Phase 1 — PRODUCTION-SAFE smoke checklist.

Run this against the LIVE production URL (https://app.cravitoo.com) immediately
after the deploy completes.  Strictly non-destructive:

  * No orders created
  * No statuses changed
  * No payments triggered
  * No outbound emails / SMS
  * No real-user records created
  * Read-only Mongo access NOT required (everything done over HTTP)

What it DOES write
------------------
  * 9 rows in `audit_log` collection — one per privileged-role-escalation
    attempt. These are the audit entries the new security control is designed
    to produce. They are tagged with the email pattern `phase1_smoke_*` so the
    operator can identify and (if desired) purge them after the test.

Usage:
    PROD_URL=https://app.cravitoo.com \
    ADMIN_EMAIL=admin@cravitoo.com \
    ADMIN_PASSWORD='***' \
        python phase1_prod_smoke.py
"""

from __future__ import annotations

import os
import sys
import time
import uuid
import requests
from datetime import datetime, timezone

PROD = os.environ.get("PROD_URL", "https://app.cravitoo.com").rstrip("/")
API = f"{PROD}/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")

SMOKE_TAG = f"phase1_smoke_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"

PASS = "\033[92m✓ PASS\033[0m"
FAIL = "\033[91m✗ FAIL\033[0m"
SKIP = "\033[93m⊘ SKIP\033[0m"

results: list[tuple[str, bool, str]] = []


def record(cid: str, ok: bool, detail: str = ""):
    print(f"  {PASS if ok else FAIL}  [{cid}] {detail}")
    results.append((cid, ok, detail))


def H(t):
    return {"Authorization": f"Bearer {t}"}


def main() -> int:
    print(f"\n=== PHASE 1 PRODUCTION SMOKE · target={PROD} · run-id={SMOKE_TAG} ===\n")
    print(f"Started at: {datetime.now(timezone.utc).isoformat()}\n")

    # ──────────────────── (1) Public pages reachable without auth ───────────
    print("(1) Public pages — must remain accessible without auth")
    for path in ("/", "/login", "/register", "/privacy", "/terms"):
        try:
            r = requests.get(f"{PROD}{path}", allow_redirects=False, timeout=20)
            bad_redirect = (
                r.status_code in (301, 302, 303, 307, 308)
                and "/login?expired" in (r.headers.get("location") or "")
            )
            ok = r.status_code == 200 and not bad_redirect
            record(f"public[{path}]", ok, f"HTTP {r.status_code}")
        except Exception as e:
            record(f"public[{path}]", False, f"EXC {e}")

    # ──────────────────── (2) Logout / expired-session handling ──────────────
    print("\n(2) Expired-session handling")
    r = requests.get(f"{API}/auth/me", timeout=15)
    record("auth-me-anonymous", r.status_code == 401, f"HTTP {r.status_code}")
    r = requests.post(f"{API}/auth/refresh", timeout=15)
    record("auth-refresh-anonymous", r.status_code in (401, 403), f"HTTP {r.status_code}")

    # ──────────────────── (3) Employee registration EXISTS and serves a form
    # We do NOT submit — that would create a user. Just check the route loads.
    print("\n(3) Employee registration page reachable (no submit)")
    r = requests.get(f"{PROD}/register", timeout=15)
    record("register-page", r.status_code == 200, f"HTTP {r.status_code}")

    # ──────────────────── (4) Privileged-role self-register MUST be rejected
    # These attempts produce 403 BEFORE any user record is created.
    # They DO write one audit_log row per attempt — those rows are tagged with
    # the SMOKE_TAG email so the operator can identify/purge them later.
    print("\n(4) Privileged-role self-registration is blocked")
    for role in ("vendor", "corporate_admin", "site_admin", "super_admin", "master_admin"):
        em = f"{SMOKE_TAG}+{role}@cravitoo.com"
        r = requests.post(
            f"{API}/auth/register",
            json={"email": em, "password": "ImpossiblePass!9X", "name": "Smoke", "role": role},
            timeout=15,
        )
        record(f"role-blocked[{role}]", r.status_code == 403, f"HTTP {r.status_code}")

    # Spoofing attempts — case / whitespace / null-byte
    for sneaky in ("Master_Admin", " master_admin ", "MASTER_ADMIN", "vendor\u0000"):
        em = f"{SMOKE_TAG}+spoof_{uuid.uuid4().hex[:4]}@cravitoo.com"
        r = requests.post(
            f"{API}/auth/register",
            json={"email": em, "password": "ImpossiblePass!9X", "name": "Smoke", "role": sneaky},
            timeout=15,
        )
        record(f"role-spoof[{sneaky!r}]", r.status_code == 403, f"HTTP {r.status_code}")

    # ──────────────────── (5) Demo gating in PRODUCTION ──────────────────────
    print("\n(5) Demo endpoints must return 404 / disabled in production")
    r = requests.get(f"{API}/admin/demo/enabled", timeout=15)
    try:
        body = r.json()
    except Exception:
        body = {}
    record("demo-enabled-flag-false",
           r.status_code == 200 and body.get("demo_enabled") is False,
           f"HTTP {r.status_code} body={body}")
    record("demo-env-label-production",
           body.get("environment") == "production",
           f"environment={body.get('environment')}")

    # Authenticated demo endpoints — must 404 (or 401 if creds invalid)
    if ADMIN_EMAIL and ADMIN_PASSWORD:
        login = requests.post(f"{API}/auth/login",
                              json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                              timeout=20)
        if login.status_code == 200:
            tok = login.json()["access_token"]
            for ep, m in (("/admin/demo/status", "get"),
                          ("/admin/demo/setup", "post"),
                          ("/admin/demo/teardown", "post")):
                fn = getattr(requests, m)
                r = fn(f"{API}{ep}", headers=H(tok), timeout=15)
                record(f"demo-{m.upper()}[{ep}]",
                       r.status_code == 404, f"HTTP {r.status_code}")

            # ─── (6) /auth/me as authenticated admin works (read-only)
            r = requests.get(f"{API}/auth/me", headers=H(tok), timeout=15)
            record("auth-me-authenticated", r.status_code == 200, f"HTTP {r.status_code}")

            # ─── (7) Existing employee + vendor lists load (read-only)
            r = requests.get(f"{API}/vendors", headers=H(tok), timeout=15)
            ok = r.status_code == 200 and isinstance(r.json(), list)
            record("vendor-list-loads", ok, f"HTTP {r.status_code} · count={len(r.json()) if ok else '?'}")

            # ─── (8) Existing-order data unchanged: read snapshot, no writes
            r = requests.get(f"{API}/orders", headers=H(tok), timeout=15)
            ok = r.status_code in (200, 403)  # 403 if /orders is employee-only at this level
            record("orders-readable", ok, f"HTTP {r.status_code}")
        else:
            record("admin-login", False,
                   f"could not authenticate as admin: HTTP {login.status_code}")
    else:
        print(f"  {SKIP}  [admin-login] ADMIN_EMAIL / ADMIN_PASSWORD not provided — skipping authenticated checks")

    # ──────────────────── (6 bis) Production frontend bundle scan ────────────
    print("\n(6) Production frontend bundle — credentials must be absent")
    # We can do this remotely by fetching index.html and scanning the referenced
    # JS chunks for the demo passwords.
    leak_terms = ("Demo@123", "admin123", "employee123", "vendor123",
                  "finance@cravitoo", "info@cravitoo",
                  "vendor@atmego", "employee@techcorp", "vendor@spicekitchen")
    try:
        idx = requests.get(f"{PROD}/", timeout=20).text
        import re
        js_chunks = re.findall(r'/static/js/[\w.-]+\.js', idx)
        if not js_chunks:
            record("bundle-scan", False, "could not find /static/js/*.js references in /index.html")
        else:
            seen_leaks: set[str] = set()
            for chunk in set(js_chunks):
                try:
                    body = requests.get(f"{PROD}{chunk}", timeout=30).text
                    for term in leak_terms:
                        if term in body:
                            seen_leaks.add(term)
                except Exception as e:
                    print(f"    (warn) {chunk}: {e}")
            record("bundle-scan-no-creds", not seen_leaks,
                   f"chunks={len(set(js_chunks))} leaks={sorted(seen_leaks) or 'none'}")
    except Exception as e:
        record("bundle-scan", False, f"EXC {e}")

    # ──────────────────── Summary ────────────────────────────────────────────
    failed = [r for r in results if not r[1]]
    print("\n" + "=" * 70)
    print(f"Total: {len(results)} · PASS: {len(results) - len(failed)} · FAIL: {len(failed)}")
    print(f"Run-id: {SMOKE_TAG}  (search audit_log for this string to find smoke entries)")
    print(f"Completed at: {datetime.now(timezone.utc).isoformat()}")
    if failed:
        print("\n\033[91mFAILURES:\033[0m")
        for cid, _, det in failed:
            print(f"  [{cid}] {det}")
        return 1
    print("\n🟢 Production smoke: ALL CHECKS PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
