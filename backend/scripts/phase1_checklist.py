"""Phase 1 — full pre-deploy checklist runner.

Executes every check the operator asked for in the approval message and prints
each result individually (PASS / FAIL).  Run against the preview environment.
Does NOT touch production.

Exit code: 0 if every check passes, 1 otherwise.
"""

from __future__ import annotations

import os
import sys
import time
import uuid
import json
import asyncio
import requests
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from motor.motor_asyncio import AsyncIOMotorClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
# Frontend pages are served from the *same* ingress host (the platform proxy
# routes /api to backend, everything else to the React app).
FRONTEND_BASE = BASE
MONGO = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DBN = os.environ.get("DB_NAME", "cravitoo_db")

PASS = "\033[92m✓ PASS\033[0m"
FAIL = "\033[91m✗ FAIL\033[0m"
SKIP = "\033[93m⊘ SKIP\033[0m"
results: list[tuple[str, str, str]] = []   # (id, verdict, detail)


def record(check_id: str, ok: bool, detail: str = ""):
    verdict = PASS if ok else FAIL
    results.append((check_id, verdict, detail))
    print(f"  {verdict}  [{check_id}] {detail}")


def login(email: str, password: str) -> str | None:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        return None
    return r.json().get("access_token")


def H(t):
    return {"Authorization": f"Bearer {t}"}


def main() -> int:
    print(f"\n=== Phase 1 Pre-Deploy Checklist · target={BASE} ===\n")

    master_token = login("admin@cravitoo.com", "admin123")
    if not master_token:
        print("Could not log in as master admin — aborting checklist")
        return 1

    # ──────────────────────────── A. Public-route access ─────────────────────
    print("\nA. Public pages must remain accessible without auth")
    for path in ("/", "/login", "/register", "/privacy", "/terms"):
        r = requests.get(f"{FRONTEND_BASE}{path}", allow_redirects=False, timeout=15)
        # Any 2xx or 3xx that isn't a redirect to /login is OK
        is_redirect_to_login = (
            r.status_code in (301, 302, 303, 307, 308)
            and "/login?expired" in r.headers.get("location", "")
        )
        record(
            f"A.public-page-accessible[{path}]",
            r.status_code == 200 and not is_redirect_to_login,
            f"HTTP {r.status_code}",
        )

    # ──────────────────── B. Expired sessions only redirect protected paths ──
    print("\nB. Expired-session behaviour")
    # Anonymous request to /auth/me must return 401 (no redirect, no 500)
    r = requests.get(f"{API}/auth/me", timeout=10)
    record("B.auth-me-anonymous", r.status_code == 401, f"HTTP {r.status_code}")
    # Anonymous request to /auth/refresh must NOT 500
    r = requests.post(f"{API}/auth/refresh", timeout=10)
    record("B.auth-refresh-anonymous", r.status_code in (401, 403), f"HTTP {r.status_code}")

    # ──────────────────────────── C. Employee registration still works ───────
    print("\nC. Employee public-registration path")
    email = f"check_emp_{uuid.uuid4().hex[:8]}@cravitoo.com"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": "Strong!Pass123", "name": "Check Employee", "role": "employee"},
        timeout=15,
    )
    ok = r.status_code in (200, 201)
    record("C.employee-self-register", ok, f"HTTP {r.status_code} · email={email}")

    # ──────────────────────────── D. Privilege escalation blocked ────────────
    print("\nD. Privileged-role self-register MUST be rejected")
    for role in ("vendor", "corporate_admin", "site_admin", "super_admin", "master_admin"):
        em = f"check_{role}_{uuid.uuid4().hex[:8]}@cravitoo.com"
        r = requests.post(
            f"{API}/auth/register",
            json={"email": em, "password": "Strong!Pass123", "name": "X", "role": role},
            timeout=15,
        )
        record(f"D.role-escalation-block[{role}]", r.status_code == 403, f"HTTP {r.status_code}")

    # Defence in depth — non-trivial spoofing attempts
    for sneaky in ("Master_Admin", " master_admin ", "MASTER_ADMIN", "vendor\u0000"):
        em = f"sneaky_{uuid.uuid4().hex[:8]}@cravitoo.com"
        r = requests.post(
            f"{API}/auth/register",
            json={"email": em, "password": "Strong!Pass123", "name": "X", "role": sneaky},
            timeout=15,
        )
        record(f"D.role-spoof-block[{sneaky!r}]", r.status_code == 403, f"HTTP {r.status_code}")

    # ──────────────────────────── E. Demo endpoint gating ────────────────────
    print("\nE. Demo endpoints under different CRAVITOO_ENV values")
    # Current env is preview — both 200
    r = requests.get(f"{API}/admin/demo/enabled", timeout=10)
    record("E.preview.demo-enabled-probe", r.status_code == 200 and r.json()["demo_enabled"] is True,
           f"HTTP {r.status_code} body={r.text[:80]}")
    r = requests.get(f"{API}/admin/demo/status", headers=H(master_token), timeout=10)
    record("E.preview.demo-status-200", r.status_code == 200, f"HTTP {r.status_code}")
    leak = "Demo@123" in r.text or '"password"' in r.text
    record("E.preview.no-password-leak", not leak, f"leak={leak}")

    # Now flip the env to production via subprocess
    import subprocess
    def _flip(value: str):
        subprocess.run(["sed", "-i", f's/CRAVITOO_ENV="[^"]*"/CRAVITOO_ENV="{value}"/', "/app/backend/.env"], check=True)
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=True, capture_output=True)
        time.sleep(5)

    try:
        _flip("production")
        r = requests.get(f"{API}/admin/demo/enabled", timeout=10)
        record("E.production.demo-enabled-flag-false",
               r.status_code == 200 and r.json()["demo_enabled"] is False, f"body={r.text[:80]}")
        mt = login("admin@cravitoo.com", "admin123")
        for endpoint, method in (("/admin/demo/status", "get"), ("/admin/demo/setup", "post"), ("/admin/demo/teardown", "post")):
            fn = getattr(requests, method)
            r = fn(f"{API}{endpoint}", headers=H(mt), timeout=10)
            record(f"E.production.demo-{method.upper()}[{endpoint}]", r.status_code == 404, f"HTTP {r.status_code}")

        # Invalid env — must fail-secure to production
        _flip("banana")
        r = requests.get(f"{API}/admin/demo/enabled", timeout=10)
        record("E.invalid.fail-secure",
               r.status_code == 200 and r.json()["demo_enabled"] is False, f"body={r.text[:80]}")

        # Empty env — also fail-secure
        _flip("")
        r = requests.get(f"{API}/admin/demo/enabled", timeout=10)
        record("E.missing.fail-secure",
               r.status_code == 200 and r.json()["demo_enabled"] is False, f"body={r.text[:80]}")
    finally:
        _flip("preview")
        # re-login under the restored env
        master_token = login("admin@cravitoo.com", "admin123")

    # ──────────────────────────── F. Order lifecycle exhaustive matrix ───────
    print("\nF. Order lifecycle — every valid + invalid transition")
    # Need: any vendor user we can log in as for vendor-role checks.
    # Driving via master_admin (covers ADMIN_TRANSITIONS).  Vendor & employee
    # transitions are tested in tests/test_phase1_critical_fixes.py.
    async def _seed_order(status, age_hours=0):
        client = AsyncIOMotorClient(MONGO)
        db = client[DBN]
        emp = await db.users.find_one({"role": "employee"})
        vendor = await db.vendors.find_one({})
        if not emp or not vendor:
            client.close()
            return None
        created = datetime.now(timezone.utc) - timedelta(hours=age_hours)
        res = await db.orders.insert_one({
            "user_id": str(emp["_id"]),
            "vendor_id": str(vendor["_id"]),
            "items": [],
            "total_amount": 100.0,
            "status": status,
            "payment_status": "paid",
            "delivery_type": "pickup",
            "created_at": created,
        })
        client.close()
        return str(res.inserted_id)

    def seed(status, age=0):
        return asyncio.new_event_loop().run_until_complete(_seed_order(status, age))

    # Valid full-chain
    oid = seed("pending")
    for nxt in ("confirmed", "preparing", "ready", "completed"):
        r = requests.patch(f"{API}/orders/{oid}", headers=H(master_token), params={"status": nxt}, timeout=15)
        record(f"F.valid-transition[{nxt}]", r.status_code == 200, f"HTTP {r.status_code} body={r.text[:80]}")

    # Now order is completed (terminal) — any further mutation must 409
    for nxt in ("preparing", "ready", "cancelled"):
        r = requests.patch(f"{API}/orders/{oid}", headers=H(master_token), params={"status": nxt}, timeout=15)
        record(f"F.terminal-immutable[{nxt}]", r.status_code == 409, f"HTTP {r.status_code}")

    # Invalid jumps
    bad_cases = [
        ("pending", "preparing"),    # skipping confirmed
        ("pending", "ready"),
        ("pending", "completed"),
        ("confirmed", "ready"),      # skipping preparing
        ("confirmed", "completed"),
        ("preparing", "completed"),  # skipping ready
        ("preparing", "no_show"),    # vendor cannot mark no-show before ready
        ("ready", "preparing"),      # cannot go backwards
        ("ready", "confirmed"),
    ]
    for start, target in bad_cases:
        oid = seed(start)
        r = requests.patch(f"{API}/orders/{oid}", headers=H(master_token), params={"status": target}, timeout=15)
        record(f"F.invalid-jump[{start}->{target}]", r.status_code in (400, 409), f"HTTP {r.status_code}")

    # Idempotent / duplicate
    oid = seed("confirmed")
    r1 = requests.patch(f"{API}/orders/{oid}", headers=H(master_token), params={"status": "preparing"}, timeout=15)
    r2 = requests.patch(f"{API}/orders/{oid}", headers=H(master_token), params={"status": "preparing"}, timeout=15)
    record("F.duplicate-second-call-409", r1.status_code == 200 and r2.status_code == 409,
           f"first={r1.status_code} second={r2.status_code}")

    # Stale order (>48h, non-terminal) — read-only
    oid = seed("pending", age=50)
    r = requests.patch(f"{API}/orders/{oid}", headers=H(master_token), params={"status": "confirmed"}, timeout=15)
    record("F.stale-order-read-only", r.status_code == 409, f"HTTP {r.status_code}")

    # Active order at boundary (40h, still in window) — must accept
    oid = seed("pending", age=40)
    r = requests.patch(f"{API}/orders/{oid}", headers=H(master_token), params={"status": "confirmed"}, timeout=15)
    record("F.active-40h-still-mutable", r.status_code == 200, f"HTTP {r.status_code}")

    # Concurrent duplicate updates: only one must succeed
    oid = seed("pending")
    with ThreadPoolExecutor(max_workers=10) as pool:
        futs = [pool.submit(requests.patch, f"{API}/orders/{oid}", headers=H(master_token),
                             params={"status": "confirmed"}, timeout=15) for _ in range(10)]
        codes = [f.result().status_code for f in as_completed(futs)]
    successes = sum(c == 200 for c in codes)
    record("F.concurrent-single-winner", successes == 1, f"{successes}/10 succeeded · all codes={sorted(codes)}")

    # ──────────────────────────── G. order_status_history audit ─────────────
    print("\nG. order_status_history collection")
    async def _check_history():
        client = AsyncIOMotorClient(MONGO)
        db = client[DBN]
        rows = await db.order_status_history.find().sort("created_at", -1).limit(10).to_list(10)
        idx = await db.order_status_history.index_information()
        cnt = await db.order_status_history.count_documents({})
        client.close()
        return rows, idx, cnt

    rows, idx, total = asyncio.new_event_loop().run_until_complete(_check_history())
    record("G.history.has-rows", total > 0, f"total={total}")
    record("G.history.has-actor-role", all("actor_role" in r for r in rows), f"sample={[r.get('actor_role') for r in rows[:5]]}")
    sensitive_keys = ("password", "password_hash", "phone", "razorpay_signature", "card", "cvv")
    leak_keys = []
    for r in rows:
        flat = json.dumps(r, default=str).lower()
        for k in sensitive_keys:
            if k in flat:
                leak_keys.append(k)
    record("G.history.no-sensitive-data", not leak_keys, f"found={leak_keys}")
    record("G.history.has-order-id-index", any("order_id" in k for k in idx.keys()), f"indexes={list(idx.keys())}")

    # ──────────────────────────── Summary ────────────────────────────────────
    print("\n" + "=" * 70)
    failed = [r for r in results if r[1] != PASS]
    print(f"Total: {len(results)}   PASS: {len(results) - len(failed)}   FAIL: {len(failed)}")
    if failed:
        print("\nFailures:")
        for cid, _, detail in failed:
            print(f"  [{cid}] {detail}")
        return 1
    print("\n🟢 All checklist items passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
