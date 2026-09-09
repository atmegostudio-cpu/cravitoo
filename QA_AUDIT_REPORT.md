# Cravitoo — End-to-End QA Audit Report
_Date: Jun 2026 · Environment: **Preview** (`feedback-analytics-20.preview.emergentagent.com`) · DB: preview (separate from live/deployed)._

> **Live-data safety:** No live/production data was touched. All checks ran against the **preview** DB. A clean `AUDIT_*` hierarchy + `DEMO_*` sales data were re-seeded (idempotent seed scripts) purely to give the audit real records to exercise.

---

## A. Methodology
1. **Read-only DB integrity scan** (`scripts/integrity_audit.py`) across Clients → Cities → Sites → Cafeterias → Vendors → Mappings → Menus → Employees → Orders.
2. **Code review** of critical paths: auth/magic-link/forgot-password, order materialization + Razorpay duplicate-order guard, RBAC scoping in `get_orders`, feedback analytics.
3. **Live API smoke tests (curl)** for auth, RBAC scoping (positive + negative), sales report, filters, customer types.
4. **Functional/UI E2E** delegated to the testing agent (section F).

---

## B. Configuration snapshot
| Item | Value |
|---|---|
| PAYMENT_MODE | `RAZORPAY` (online) |
| RAZORPAY_MOCK_MODE | `false` → **live gateway** (real payment cannot be completed in preview) |
| Resend email | health OK (`noreply@cravitoo.com`, send-only key) |
| Services | backend / frontend / mongodb all RUNNING |
| CORS | from `CORS_ORIGINS` env |

---

## C. QA Findings Table (Backend / DB / API — verified by me)

| # | Feature | Test scenario | Result | Issue | Severity | Root cause | Recommended fix | Retest |
|---|---|---|---|---|---|---|---|---|
| C1 | Auth — master login | `POST /auth/login` admin@cravitoo.com | ✅ PASS | — | — | — | — | — |
| C2 | Auth — bad password | wrong password | ✅ PASS (401) | — | — | — | — | — |
| C3 | Auth — unauth access | `GET /orders` no cookie | ✅ PASS (401) | — | — | — | — | — |
| C4 | RBAC — employee vendor visibility | empA sees [V1,V2], empB sees [V1] only | ✅ PASS | — | — | site-scoped mapping filter correct | — | — |
| C5 | RBAC — order isolation | corpA & siteA see only CRV-AUDA01 (never CRV-AUDB01) | ✅ PASS | — | — | company/site scoping correct | — | — |
| C6 | RBAC — vendor orders | vendor1 (mapped to SiteA+SiteB) sees both its orders | ✅ PASS | — | — | scoping by vendor_id (correct) | — | — |
| C7 | RBAC — employee → admin report | empA `GET /admin/sales-report/filters` | ✅ PASS (403) | — | — | — | — | — |
| C8 | RBAC — employee → feedback inbox | empA `GET /feedback` | ✅ PASS (403) | — | — | — | — | — |
| C9 | Sales report | master `month=2026-06` → grand_total ₹3975 / 14 orders / 4 sites / 5 vendors | ✅ PASS | — | — | — | — | — |
| C10 | Sales report filters cascade | clients=4, cities=3, sites=6, vendors=6, customer_types=6 | ✅ PASS | — | — | — | — | — |
| C11 | Sales report — invalid month | `month=badmonth` | ✅ PASS (400, not 500) | — | — | `_parse_range` hardened earlier | — | — |
| C12 | Forgot password | unknown email returns uniform 200 (no enumeration) | ✅ PASS | — | — | anti-enumeration by design | — | — |
| C13 | Magic-link / forgot-password for vendors | code review: any active login user (incl. un-onboarded vendor) can self-serve reset link | ✅ PASS | Handoff "P2 resend magic link" is effectively already covered | Low | flow reuses `forgot-password` + `purpose=password_reset` | none needed; optionally add "resend onboarding" wording | — |
| C14 | Customer types | 5 seeded types returned | ✅ PASS | — | — | auto-seed | — | — |
| C15 | Order dup-guard (code) | atomic `find_one_and_update` sentinel in `_finalize_payment_intent` | ✅ PASS (code) | — | — | verified sentinel logic present | run race script (F) | — |

### Data-hygiene findings (preview test artifacts — **NOT live**, low severity)
| # | Finding | Severity | Root cause | Recommended fix |
|---|---|---|---|---|
| D1 | ~30 orphaned **vendor login users** (`test_*@example.com`, `rawv@test.com`) whose `vendor_id` points to deleted vendors | Low | Vendor hard-delete cascades vendor/mappings/menus/orders but earlier test flows left login users; delete path exists now | Run a one-time cleanup of vendor users with dangling `vendor_id`; confirm `DELETE /vendors/{id}` also removes the login user (it does per code L2384+) |
| D2 | `Demo Cafeteria Site` has NO `city_id` / `company_id` | Low | Legacy site created before the create-site guardrail | Assign client+city via the Sites "Assign client & city" UI, or delete if unused |
| D3 | 2 `DEMO_*` companies have NO `city_id` | Low | Seed demo data | cosmetic; demo only |
| D4 | `timefix_emp@cravitoo.com` missing `company_id`; 2 timefix orders missing site_id/company_id | Low | Seed predates onboarding auto-link | Run `backfill-employee-sites` + `backfill-orders`; or ignore (test seed) |
| D5 | 1 orphaned `vendor_site_mappings` row (vendor + site both missing) | Low | Leftover from a deleted test vendor | Run `POST /admin/vendor-site-mappings/sanitize` |

> None of D1–D5 affect the live/deployed database — they are preview test residue. They are listed for completeness and can be cleaned with existing repair endpoints.

---

## D. Payment gateway note
- Preview runs **live Razorpay** (`RAZORPAY_MOCK_MODE=false`), so a real card/UPI success **cannot** be exercised here. What IS verifiable: checkout-intent creation, forged-signature rejection (`hmac.compare_digest`), and the **duplicate-order race guard** via `scripts/test_duplicate_order_race.py` (deterministic). Full success→order→notification is covered by prior iteration_41 + will be re-run in section F where possible.

---

## F. Frontend / UI E2E Findings (testing agent, iteration_63)

**Result: ~97% pass, ZERO functional/critical/high bugs.** All role dashboards, navigation, forms, cart, feedback, sales report, forgot-password, and mobile (390×844, no horizontal overflow) verified.

| # | Feature | Test scenario | Result | Issue | Severity | Root cause | Fix | Retest |
|---|---|---|---|---|---|---|---|---|
| F1 | Master nav (12 routes) | render each master page | ✅ PASS | none | — | — | — | — |
| F2 | Sales Report UI | Month=2026-06 → ₹3975/14 orders; Site/Vendor/City/Client tables; cascading + customer-type filters open; Excel downloads (200, 7480 bytes .xlsx) | ✅ PASS | none | — | — | — | — |
| F3 | Employee A | dashboard/menu/cart/orders (CRV-AUDA01 ₹210, local time 1:42pm, itemised) | ✅ PASS | none (prev toFixed crash regression-clean) | — | — | — | — |
| F4 | Employee feedback | 5★ food + comment + order chip submit; Other-issue (Delay) + note submit | ✅ PASS | none | — | — | — | — |
| F5 | Cross-tenant isolation | empB sees only V1 + only CRV-AUDB01 | ✅ PASS | none | — | — | — | — |
| F6 | Vendor | dashboard glance (₹210/2 orders/top item), Orders (both codes, employee name, items, Counter 1 badge), Manual Order, Feedback inbox analytics | ✅ PASS | none | — | — | — | — |
| F7 | Corporate admin | dashboard per-site shows only SiteA (RBAC) | ✅ PASS | none | — | — | — | — |
| F8 | Forgot password | known + unknown email → identical uniform message | ✅ PASS | none | — | — | — | — |
| F9 | Mobile 390×844 | menu, feedback, vendor orders, vendor inbox, sales report | ✅ PASS (no overflow, drawer opens) | none | — | — | — | — |
| F10 | Duplicate-order guard | `test_duplicate_order_race.py` → exactly ONE order, created_at UTC-aware | ✅ PASS | none | — | — | — | — |

### False alarms investigated & cleared (reported as "missing testids" but verified present + conditionally rendered)
- **`menu-item-rating-{id}`** — present (`Menu.js:596`); only renders when a matching dish rating exists. Curl confirms `/feedback/menu-ratings` returns `AUDIT_Paneer avg 5` and the menu has that item → widget renders. The QA snapshot was taken before the rating existed. **Not a bug.**
- **`feedback-top-issues`** — present (`FeedbackInbox.js:114`); only renders when `by_category` is non-empty. The employee's issue feedback had **no order attached** → `vendor_id=null` → correctly out of the vendor's scope (`by_category:[]`), so the card is hidden for that vendor (it surfaces for site/corporate/master admins). **Correct by design.**
- **`sales-clear-filters`** — present (`SalesReport.js:289`); only renders when at least one filter is active (`anyFilter`). **Not a bug.**
- **Employee feedback "silent" validation** — `Feedback.js:47-53` already fires `toast.error` ("Tap a face to rate your meal" / "Pick what went wrong" / "Add a short note"). The transient sonner toast was likely missed in the snapshot. **Validation exists.**

### Genuine minor issues
| # | Issue | Severity | Root cause | Fix | Status |
|---|---|---|---|---|---|
| F11 | Trend label read "Last 1 days" (grammar) | Low | no pluralization on `trend.length` | pluralized: `Last N day(s)` in `FeedbackInbox.js` | ✅ FIXED |
| F12 | "Sales by Client" card looks sparse for scoped corp/site admins | Cosmetic | scoped user sees only their own client | optional: hide card for corp/site roles | Documented (not changed — not broken) |
| F13 | Sales Report defaults to today's date-range (few orders) | Cosmetic UX | default mode = date-range | optional: default to current Month | Documented (not changed) |

---

## G. Conclusion
- **No Critical / High / Medium functional bugs found** anywhere across auth, RBAC, multi-tenant isolation, orders, payments (duplicate-order guard), sales reports + Excel, feedback, or mobile.
- **1 Low grammar bug fixed** (feedback trend label).
- **5 Low data-hygiene items (D1–D5)** are **preview-only test residue** and do **not** affect live; each has an existing repair endpoint.
- **Payment limitation:** a real Razorpay success cannot be completed in preview (live mode, no real card); intent-creation, forged-signature rejection, and the concurrency dup-guard all pass.
- **Live data untouched** throughout.

### Recommended (optional) production hygiene runbook (after deploy, as master admin)
1. `POST /api/admin/vendor-site-mappings/sanitize` — clear stale mappings.
2. `POST /api/admin/integrity/backfill-employee-sites` + `POST /api/admin/integrity/backfill-orders` — stamp any legacy null links.
3. Clean orphaned test vendor-login users if any exist on live (they were preview-only here).
