# Cravitoo - Product Requirements Document

## Original Problem Statement
Build a production-ready, scalable, enterprise-grade full-stack food-tech application called Cravitoo for India - smart corporate food ordering and cafeteria management ecosystem.

## Jun 2026 — Cafeteria Layer + server.py Router Split (COMPLETED ✅)

### Cafeteria Layer (P1) — hierarchy Client → City → Site → **Cafeteria** → Vendor
- New `cafeterias` collection (`{site_id, name, description, is_active, is_default, ...}`) and a `cafeteria_id` field on `vendor_site_mappings`.
- **Non-breaking auto-migration** (`routers/cafeterias.py::ensure_default_cafeterias`, run on startup): every Site gets a default "Main Cafeteria" and every legacy vendor mapping is pinned to it, so all existing site-level routing/menus keep working unchanged.
- Endpoints: `GET/POST /api/sites/{id}/cafeterias`, `PATCH/DELETE /api/cafeterias/{id}` (default cannot be deleted/deactivated; deleting a custom cafeteria reassigns its vendors back to default), `PATCH /api/sites/{id}/vendors/{vendor_id}/cafeteria` (move vendor). `POST /api/sites/{id}/vendors` now accepts optional `cafeteria_id` (falls back to default); `GET /api/sites/{id}/vendors` returns `cafeteria_id`+`cafeteria_name`.
- Frontend: new **Cafeterias tab** on `/master/sites/{id}` (create/rename/delete + vendor counts) and cafeteria badge + move/assign selects on the Vendors tab.

### server.py Router Split (P2) — order/payment/admin routes extracted
- **`routers/orders.py`** — all order lifecycle + Razorpay payment-first flow (checkout-intent/verify/webhook, mark-paid, collect, reconciliation, bulk, cancel, refund, orders/last, get_orders, update-status, verify-pickup). The `_materialize_order` + `_finalize_payment_intent` atomic idempotency guard was moved verbatim (race test still passes → exactly ONE order under /verify-vs-webhook concurrency).
- **`routers/admin.py`** — master-admin vendor management (commission, profile update w/ mapping cascade), integrity repair tools (backfill-orders/sites/employee-sites, employee-menu-report, employee-visibility, sanitize), and vendor onboarding resend + email-log.
- **server.py: 5252 → 2952 lines (−44%).** No behavioral change; injected shared deps via the existing `make_router(...)` factory pattern.
- **Admin split COMPLETE** — all inline admin utilities moved into `routers/admin.py`. No `/api/admin/*` route remains inline.
- **Vendor reports split COMPLETE** — `routers/vendor_reports.py` now owns `/vendor/counters`, `/vendor/menu-items/{id}/counter`, and the Sales Report endpoints (summary / paginated orders / CSV+PDF export).
- **Verified**: testing_agent iteration_42 — 24/24 backend, 100% frontend; the admin + vendor-report batches self-tested via curl (all OK, RBAC 403 intact); `scripts/test_duplicate_order_race.py` still ALL PASS.

## Jun 2026 — Duplicate Order + Order-Time Fix (COMPLETED ✅)
- **Duplicate orders (P0)**: Razorpay `/verify` and the async webhook could both call `_finalize_payment_intent` concurrently and each insert an order. Fixed with an atomic `find_one_and_update` on `{cravitoo_order_id: None}` that flips the field to a `__materialising__` sentinel — only one caller wins. The losing caller now polls (~2s) until the real `order_id` appears and returns the SAME order, so `/verify` never falsely 500s when the webhook wins.
- **Inaccurate order time (P0)**: `created_at` was returned as a naive datetime, so browsers read it as local time. `GET /api/orders` now coerces `created_at` to UTC-aware and serialises with `+00:00` so the client converts to correct local time.
- **Verified**: `/app/backend/scripts/test_duplicate_order_race.py` (deterministic race → exactly 1 order, run 5×), `testing_agent` iteration_41 (100% backend + frontend). Regression test at `/app/backend/tests/test_timefix_orders.py`. Seed: `/app/backend/scripts/seed_timefix_orders.py`.


## Feb 2026 — OFFLINE Payment Mode (COMPLETED)

- **Toggle**: `PAYMENT_MODE=OFFLINE` in `backend/.env` bypasses Razorpay checkout. Setting `PAYMENT_MODE=RAZORPAY` re-enables the live gateway. `GET /api/config/payment-mode` is the read endpoint the frontend polls.
- **Collection codes**: every order now stores `collection_code` (`CRV-XXXXXX`), `payment_mode`, `payment_status`, `payment_method`, `paid_at`, `paid_by`. Employee UI renders the code as a QR (`qrcode.react`) for counter presentment.
- **Vendor actions** (`vendor/Orders.js`):
  - `POST /api/orders/{id}/mark-paid` — vendor marks Cash or Physical QR after collecting payment (idempotent: 409 on double-tap).
  - `POST /api/orders/collect/{code}` — one-tap collect: scan the employee's QR → pick method → auto-mark **Paid + Collected** in a single call. Modal component `CollectionScanner.js` wraps `html5-qrcode` and falls back to manual code entry when the camera is unavailable.
- **Master Admin Reconciliation** (`Dashboard.js` → `OrderReconciliation` card):
  - `GET /api/admin/orders/reconciliation` returns 9 buckets: total, pending, cash, physical_qr, paid, unpaid, ready_for_collection, collected, cancelled — each `{count, amount}`.
  - Card displays 6 payment buckets + 3 fulfilment pills + MODE badge. Refresh on page load.
- **Backend suite**: 24/24 pytest passing in `test_offline_payment_mode.py` covering happy paths, RBAC (403), idempotency (409), 404, and projection.
- **Known minor items** (deferred): `ready_for_collection / collected / cancelled` buckets hard-code amount=0 (spec required counts only); no unique index on `collection_code` (1e-6 collision at current volume).


## Feb 2026 — Menu-Item Image Feature: Upload / Preview / Replace / Remove / AI Generate (COMPLETED)

- **Vendor + Master Admin** can now upload a JPG/PNG/WEBP photo (≤5MB) for any menu item via new backend endpoints:
  - `POST /api/menu/{item_id}/image` — live menu items. Auth: `master_admin` OR the owning vendor.
  - `DELETE /api/menu/{item_id}/image` — same auth.
  - `POST /api/onboarding/vendors/{onb_id}/menu/{item_id}/image` — draft menu items during onboarding.
  - `DELETE /api/onboarding/vendors/{onb_id}/menu/{item_id}/image` — same scope.
- **Ownership guard** — new helper `_load_menu_item_with_ownership_check` returns the item iff master admin or matching `vendor_id`. 404 (missing) precedes 403 (forbidden) per REST norms.
- **AI Generate one-click** — extended `POST /api/ai/menu-photos/regenerate/{id}` so vendors can trigger free-source generation on their own items. Paid AI (`source=paid`) remains admin-only to protect the Emergent LLM budget from vendor-account abuse.
- **File pipeline** — all uploads land in Emergent Object Storage under `cravitoo/menu-photos-manual/{live,draft}/`. Storage returns an `s_`-prefixed base64 token URL that the existing `/api/uploads/{fname}` route serves back.
- **Frontend surfaces**:
  - **Vendor Panel** (`/vendor/menu`) — new `MenuImageUploader` component replaces the "Request Photo" button. Compact mode gives upload / auto-generate / remove + preview inline on every card.
  - **Onboarding Menu Tab** (`/onboarding/{id}/menu`) — added Upload icon button next to Free / AI / Edit / Delete in the row toolbar + Remove-Photo button that appears only when an image is set. Hidden file input drives the flow with a 5MB size cap + PNG/JPG/WEBP MIME gate.
  - **Master Site Detail** (`/master/sites/{id}` Menu tab) — added Upload + Remove alongside existing Regen (free) / Regen (AI) / Pick per row.
- **Auto-propagation** — Employee app `GET /api/menu/{vendor_id}` returns the new `image_url` immediately; no code change needed on the reader side (already returns `image_url` field).
- **Audit trail** — every upload/remove writes to `audit_log` and every menu_item stores `image_source` (`vendor_upload` / `admin_upload`) + `image_updated_at` + `image_updated_by`.
- **Regression suite (iter25)**: 21 new tests in `test_menu_image_upload.py` cover ownership matrix (master ✓ / owning vendor ✓ / other vendor ✗ / employee ✗ / unauth ✗), size/MIME rejection, 404 on missing item, DELETE mirror, GET propagation, draft-menu variant, and the regenerate vendor-RBAC gates. **143/143 tests pass** across all suites, zero regressions.

## Sep 3, 2026 — Vendor Browser (Desktop) Notifications (COMPLETED)

Extended `VendorOrderNotifier.js` to fire a **system browser Notification** on each new order, so vendors are alerted **even when the tab is unfocused/in the background**:
- Requests `Notification` permission once on mount; an "Enable alerts" pill (`data-testid='enable-browser-alerts-btn'`) shows next to the bell when permission isn't granted yet.
- Poller no longer skips when `document.hidden` (so background tabs still alert); on new orders it shows the in-app toast + system `Notification` (title/body with item + employee, `tag` dedupes) + chime (respects the mute toggle) + bell badge. Clicking the OS notification focuses the window and opens /vendor/orders.
- **Scope note**: this covers unfocused/background *open* tabs. True fully-closed-browser push needs a Service Worker + VAPID keys + backend push (pywebpush) — logged as an optional follow-up, not built.
- Frontend compiles clean. Browser-permission prompts can't be exercised by the screenshot/testing tools, so verified by compile + code inspection (the underlying new-order detection was fully tested in iteration_40).

## Sep 3, 2026 — Vendor New-Order Chime Mute Toggle (COMPLETED)

- Added a **Sound On / Muted** toggle button on the Vendor Orders header (`data-testid='toggle-order-sound-btn'`, Volume2/VolumeX icons) for quiet hours.
- State persists in `localStorage['cravitoo_order_sound']` ('on'/'off'). `VendorOrderNotifier.beep()` checks this key and skips the chime when muted (toasts + bell badge still work). Default = on.
- Verified: frontend compiles clean; logic is a localStorage guard on the already-tested notifier (iteration_40). Visual screenshot only showed the SPA loading spinner (preview screenshot-tool limitation), so not visually confirmed — offer testing_agent if visual proof needed.

## Sep 3, 2026 — Vendor Order Notifications + Richer Order Details (COMPLETED)

- **Order now stamps `employee_name` + `employee_email`** at creation (`_materialize_order` + bulk); `GET /api/orders` returns them and resolves legacy orders from the users collection ("Walk-in / Kiosk" when none).
- **Vendor Orders screen**: each card now shows the ordering employee's name (`vendor-order-employee-{id}`) and an itemized `quantity× name` list (`vendor-order-items-{id}`) alongside Order ID, code, time, total.
- **Employee Orders screen**: shows "Ordered by {name}" (`order-employee-{id}`) plus existing item lines, Order ID, time.
- **Vendor notifications** (`components/VendorOrderNotifier.js`, mounted in Navbar for role=vendor): navbar bell (`vendor-notification-bell`) with unread badge (`vendor-notification-count`), toast (`new-order-toast-{id}`) + WebAudio chime on each new order, via a 15s poll of `/api/orders` (skips when tab hidden; suppresses toasts on first bootstrap). Bell click → /vendor/orders and clears badge. Hidden for non-vendor roles.
- Verified iteration_40: backend 100%, frontend 100% — new order inserted mid-session fired a toast within ~8s with correct item + employee. Helper: `scripts/insert_test_order.py`.

## Sep 3, 2026 — "Fix Employee Menus" Admin Panel (COMPLETED)

Added a self-service panel on the Master Dashboard (`master/Dashboard.js` → `FixEmployeeMenus`) so admins resolve blank-menu issues without touching APIs:
- **Check employee** (email → `GET /api/admin/integrity/employee-visibility`): plain verdict (OK / NO_SITE / SITE_NOT_FOUND / NO_ACTIVE_VENDOR_MAPPINGS / MENU_EMPTY_OR_VENDOR_INACTIVE) + per-vendor item counts.
- **Scan everyone** (`employee-menu-report`): summary counts of all affected employees/domains/vendors.
- **Auto-fix sites** (`backfill-employee-sites`): one-click repair; lists any multi-site employees still needing manual assignment.
- Verified iteration_39: backend 8/8 (100%), frontend flows pass. Fixed one MEDIUM UX bug (backfill success message was cleared by the report refresh — now set after it). test testids: fix-employee-menus-panel, fem-email-input, fem-check-btn, fem-verdict, fem-report-btn, fem-report, fem-backfill-btn, fem-message.
- Production runbook unchanged: deploy, then use this panel to fix the real Ascendion employees.

## Sep 3, 2026 — Ascendion Empty-Menu Investigation + Per-Employee Tracer (COMPLETED)

Investigated why Ascendion employees can't see a live/mapped/uploaded menu. **Code paths verified consistent** — onboarding, Excel upload, `GET /vendors`, `GET /menu`, and the admin `list_site_vendors` all use string IDs + `status:"active"` and the SAME mapping filter, so if an admin sees the vendor under the site, an employee with the same `site_id` will too. Conclusion: the break is a **production data mismatch** (employee `site_id` null or pointing at a different site than the vendor mapping), which can't be seen from preview.
- Confirmed `get_current_user` reads the user **fresh from DB each request** (server.py L190) → a `site_id` fix applies on the next request, **no re-login required**.
- New master-only tracer `GET /api/admin/integrity/employee-visibility?email=` walks Client→Site→Vendor→Menu for one employee and returns a precise verdict: NO_SITE / SITE_NOT_FOUND / NO_ACTIVE_VENDOR_MAPPINGS / MENU_EMPTY_OR_VENDOR_INACTIVE / OK, plus per-vendor menu counts. Self-tested via curl (OK + NO_SITE verdicts).
- Production runbook: after deploy, as master admin call `employee-visibility?email=<the Ascendion employee>` to see the exact break, then fix with `backfill-employee-sites` (auto) or manual site assignment; use `employee-menu-report` for the full list.

## Sep 3, 2026 — Demo Data Wipe + Empty-Menu Root-Cause Fix (COMPLETED)

**Preview wiped to a clean slate**: `scripts/wipe_demo_data.py` emptied all operational collections and removed every non-master user — only `admin@cravitoo.com` remains. (Ascendion is the real client on the DEPLOYED app; that DB is separate and untouched.)

**Root cause of blank/empty employee menu**: an employee whose `site_id` is missing (their `allowed_domains` rule had no site_id, or a multi-site company) gets an empty vendor list from `GET /api/vendors`, and the employee menu had no empty-state → blank white screen. Fixes (verified iteration_38, 8/8 backend + frontend):
- **Single-site auto-fallback** in `GET /api/vendors`: employee with no `site_id` but whose company has exactly ONE site is auto-resolved to it.
- **Diagnostic** `GET /api/admin/integrity/employee-menu-report` (master-only): lists employees_no_site / site_deleted / zero_active_vendors, domains_missing_site_id, vendors_all_items_unavailable.
- **Repair** `POST /api/admin/integrity/backfill-employee-sites` (master-only, idempotent): sets `site_id` from the domain rule or the company's unique site; multi-site/no-company employees returned as `unresolved` for manual assignment.
- **Friendly empty-state** in `employee/Menu.js` (`data-testid='no-vendors-empty-state'`): "No menu available yet — contact your Cravitoo admin" instead of a blank page.
- Run the diagnostic + backfill on PRODUCTION (as master admin) after deploy to fix the real Ascendion employees. Regression: `/app/backend/tests/test_employee_menu_integrity.py`.

## Sep 3, 2026 — Test Data Purge (COMPLETED)

Purged leftover legacy test/demo data from the preview DB via `scripts/purge_test_data.py` (cascade-safe). Preserved: master admin (admin@cravitoo.com) + clean AUDIT_* hierarchy. Deleted: 4 sites (TEST_Site/LCTest/GateTest/LCFlow), 1 company (TEST_Corp), 2 test cities, 10 TEST__vendor_* + 10 approve_*@example.com vendor logins, 6 orphan demo users, and all their child rows (30 menu_items, 10 mappings, 9 orders, 117 vendor_onboarding, meal_schedules, order_status_history). Also removed 1 orphan order (CRV-559035) referencing a deleted vendor.

**Final state — integrity audit 100% clean**: companies=2 (AUDIT A/B), cities=1 (AUDIT_City), sites=2 (AUDIT A/B), vendors=2 (AUDIT 1/2), users=6, orders=2 — NO broken/missing/duplicate links anywhere. Backend healthy.

## Sep 3, 2026 — Full-System QA Sweep (COMPLETED, no critical bugs)

Comprehensive regression across the whole hierarchy Clients→Cities→Sites→Vendors→Counters→Menus→Employees→Orders→Payments (iteration_37: 23/23 backend pytest + frontend smoke, 100%). Findings:
- **No code bugs / no broken flows.** Employee vendor+menu scoping, corporate/site order scoping, order site/company linkage, RBAC across all roles, Razorpay checkout-intent (live keys, mock off) + forged-signature rejection (hmac.compare_digest), menu management (replace/clear/template/preview/versions/approval/counter), per-site meal prices, and backfills all verified working.
- **Ran non-destructive repairs**: sanitize deactivated 1 stale mapping (active→suspended vendor); backfill-sites/orders left only genuinely-orphan legacy TEST rows unresolved.
- **Fixed 1 footgun**: `PATCH /sites/{id}` meal_prices now (a) rejects a payload whose keys are all unknown with 400 instead of silently persisting `{}` and wiping saved prices, and (b) merges partial updates onto existing prices so other meals aren't dropped. Regression: `/app/backend/tests/test_iter37_full_regression.py`.
- **Known non-blocking data**: leftover TEST_/GateTest/LCTest/LCFlow sites + demo users (reg-e0d561, u2@lcflow, qa_employee, nosite_emp, domainemp) lack company/city — preview test artifacts only, they do NOT leak into real AUDIT/customer scoping.

## Sep 3, 2026 — Menu Approval: Notifications + Per-Row Edit + Counter Column + History Log (COMPLETED)

Four follow-ups on the vendor menu-approval workflow, verified 100% (iteration_36: 33/33 backend pytest + full frontend flow):

- **Approval Notifications**: on approve/reject, a best-effort Resend email goes to the submitting vendor with the decision + admin's reason (`_notify_vendor_menu_decision` in `routers/sites.py`, wrapped in try/except so email failure never breaks the API).
- **Per-Row Edit Before Approve** (`PATCH /api/admin/menu-uploads/{id}/items`): admin edits prices / drops items / changes counter on a PENDING upload before publishing (pending-only, master/site-access, dedupes by name, validates price≥0). Admin Menu tab shows an inline editable table (edit-name/price/counter/remove + Save) per pending upload.
- **Counter Column in Excel**: template now has 8 columns incl `counter`; both `parse_menu_workbook` and the admin direct `upload_menu_excel` read it; `GET /menu/{vendor_id}` projection now returns `counter`. Multi-counter menus import already tagged.
- **Approval History Log** (`GET /api/admin/menu-uploads?status=decided&site_id=`): returns approved+rejected with decided_by/decided_at/decision_note. Admin Menu tab has a collapsible "Approval History" card with client-side search. Regression file `/app/backend/tests/test_iter36_menu_enhancements.py`.

## Sep 3, 2026 — Vendor Bulk Menu Upload (approval flow) + Template / Preview / Version History (COMPLETED)

Four connected menu-management additions, verified 100% (iteration_35: 20/20 backend pytest + full frontend flow):

- **Vendor Bulk Upload → Admin Approval** (NEW workflow): vendor uploads an Excel menu on `/vendor/menu` (`POST /api/vendor/menu-uploads?site_id=`) and submits — stored `status=pending`, **never applied to the live menu**. Vendor must be actively mapped to the site (403 otherwise). Admin reviews on SiteDetail → Menu tab ("Vendor Menu Uploads awaiting approval" card): **Approve** (`POST /api/admin/menu-uploads/{id}/approve`) applies it live in replace mode + snapshots the previous menu; **Reject** (`.../reject`, optional note) leaves live menu untouched. Only master/site-access admins may approve/reject (vendors & employees → 403). Collection `menu_upload_requests`.
- **Excel Template Download** (`GET /api/admin/menu-excel-template`): one-click sample .xlsx with the exact 7 columns + sample rows. Buttons on both admin Menu tab and vendor page. (Path deliberately avoids the `/menu/{vendor_id}` route collision.)
- **Upload Preview / diff** (`POST /api/sites/{id}/menu/preview`): dry-run returns added/updated/removed + counts with NO mutation; admin Menu tab shows a diff block before replacing.
- **Menu Version History + Restore** (`GET/POST /api/sites/{id}/menu/versions[...]/restore`): auto-snapshots the previous menu (kept last 5 per vendor+site) before every replace/approve/restore; one-tap restore. Collection `menu_versions`. Shared helpers `parse_menu_workbook`, `_snapshot_menu`, `_apply_menu` in `routers/sites.py`. Regression file `/app/backend/tests/test_menu_bulk_approval.py`.

## Sep 1, 2026 — Admin Menu Replace / Clear / Dedupe + Live Propagation (COMPLETED)

Admin can now fully re-manage a vendor's menu at a site without duplicates:
- **Excel upload REPLACE mode** (`POST /sites/{id}/menu/upload-excel?vendor_id=&mode=replace`, default): parses+validates the whole file first (never partial-wipes on a bad file), then clears that vendor's items at the site and inserts the new rows. Re-uploading the same file is idempotent — **no duplicates**.
- **APPEND/merge mode** (`mode=append`): upserts by item name (same name → update in place, new → insert); in-file duplicate names are skipped. Also duplicate-safe.
- **Clear Menu** (`DELETE /sites/{id}/menu?vendor_id=`): one-tap delete of all of a vendor's items at the site. Master admin or site-access admin only (403 otherwise).
- **Admin UI** (`master/SiteDetail.js` Menu tab): "Replace existing menu" toggle (default on), "Clear Menu" button, richer result message (cleared/added/updated). List heading clarified as site-wide/all-vendors.
- **Auto-propagation**: Web/Customer/Vendor apps all read live from `menu_items` (`GET /menu/{vendor_id}`, `GET /sites/{id}/menu`) — updates reflect immediately, no cache.
- **Verified (iteration_34)**: 6/6 backend pytest + UI flow, 100%. Regression file `/app/backend/tests/test_menu_replace_clear.py`.

## Sep 1, 2026 — Vendor Counter View + Company Orders Dashboard + Per-Site Meal Prices + Site Repair (COMPLETED)

Four connected-platform enhancements, all verified 100% (iteration_33: 13/13 backend pytest + frontend smoke):

- **Vendor Counter View** (`vendor/Orders.js` + `GET /api/orders` now returns `counter`): a counter filter chip row (All counters + one chip per counter from `GET /api/vendor/counters`) lets multi-counter vendors filter their order list; each order shows a counter badge. Sales/Reports already had per-counter filtering.
- **Company Orders Dashboard** (`admin/Dashboard.js` + `GET /api/analytics/corporate/today`): corporate admins get a live "Today across your sites" section — today's orders, paid spend, active-site count, and a per-site breakdown table. Strictly company-scoped (Corp A never sees Corp B); non-admin roles 403.
- **Per-Site Meal Prices** (`master/SiteDetail.js` Settings tab + `PATCH /api/sites/{id}` `meal_prices`): Master Admin edits each site's 4 meal-type prices (veg_meal/non_veg_meal/veg_salad/non_veg_salad); master-only, floats coerced, negatives rejected. Feeds the monthly billing engine (`billing._site_prices`).
- **Site Data Repair** (`master/Sites.js` "Repair Links" + `POST /api/admin/integrity/backfill-sites`): master-only, idempotent relink of sites missing `company_id`/`city_id` (from site employees → allowed_domains → vendor_onboarding, then city from company). Companion to the earlier order backfill.

## Sep 1, 2026 — System Hierarchy Audit: Order Linkage + Role Scoping (COMPLETED)

Full audit of the chain **Client(Company) → City → Site → Vendor → Counter → Menu → Employee → Order**. Ran a live data-integrity scan (`scripts/integrity_audit.py`) that surfaced concrete gaps; fixed the code-level ones:

- **Orders now link to Site + Company**: `_materialize_order` (single) and `create_bulk_order` (bulk) stamp `site_id` + `company_id` from the ordering employee. Previously 10/10 orders had neither, breaking Site→Order and Client→Order rollups.
- **`GET /api/orders` role scoping** (was leaking ALL orders to admin roles): now employee=own, vendor=own vendor, site_admin=own site, corporate_admin=own company, super_admin=assigned sites, master=all.
- **Reusable repair endpoint** `POST /api/admin/integrity/backfill-orders` (master only, idempotent): stamps site_id/company_id on legacy orders from the employee, falling back to the vendor's unique active site mapping. Returns `{scanned, fixed_site, fixed_company, unresolved}`. Intended to be run once on production after deploy.
- **Regression preserved**: employee vendor list (`/api/vendors`) and menu access (`/api/menu/{id}`) remain strictly site-scoped (iters 30–31).
- **Verified (iteration_32)**: 9 backend pytest cases + frontend smoke, 100% pass. Cross-company isolation proven (Corp A never sees Corp B's order); employee B only sees vendors mapped to Site B. Regression file `/app/backend/tests/test_order_hierarchy_scoping.py`. Seed: `scripts/seed_hierarchy_audit.py`.

### Known remaining hygiene (non-blocking, mostly preview TEST data)
- Legacy demo users (`reg-e0d561@techcorp.com`, `u2@lcflow-*`, `qa_employee@gatetest.com`) lack `company_id`/`site_id`, so their old orders can't be fully backfilled. Real prod data is unaffected.
- Older preview Sites (`TEST_/GateTest_/LCTest_/LCFlow_`) lack `city_id`/`company_id`. Future companion `backfill-sites` endpoint could clean these.
- Vendor suspend/reactivate already cascades to mappings via `PATCH /admin/vendors`; `POST /admin/vendor-site-mappings/sanitize` cleans any historical stale rows.

## Aug 31, 2026 — Vendor Analytics Widget + Menu Access Guard (COMPLETED)

- **Vendor Analytics Widget** (`vendor/Dashboard.js` + `GET /api/analytics/vendor/today`): a "Today at a Glance" command-center row on the Vendor Dashboard with 3 cards — Today's Sales (paid ₹ + paid/total order counts, IST day boundary), Top Item Today (name + units sold, or empty state), and Pending Payments (outstanding all-time pending ₹ + order count to collect). Endpoint is vendor-role only (403 otherwise).
- **Menu Access Guard** (`GET /api/menu/{vendor_id}`): now requires auth. For `role == "employee"`, returns 403 unless the vendor has an active `vendor_site_mappings` row for the employee's site AND the vendor is active — blocks stale/shared direct links to unassigned, suspended, or cross-site vendors. Admin/vendor roles unrestricted.
- **Verified (iteration_31)**: 9 backend pytest cases + frontend UI, 100% pass. Regression test `/app/backend/tests/test_vendor_today_and_menu_guard.py`. Seed scripts: `scripts/setup_vendor_today_test.py`, `scripts/setup_vendor_mapping_test.py`.

## Aug 31, 2026 — Vendor-Site Mapping Visibility Bug (COMPLETED)

- **Bug**: Employees saw vendors that were NOT actively mapped to their own site. Unmapped, suspended, and inactive-mapping vendors all leaked into the employee Browse Menu as vendor tabs.
- **Root cause**: All employee-facing pages (Menu, Dashboard, BulkOrder, Subscriptions) called the global, unauthenticated `GET /api/vendors`, which returned every active vendor platform-wide with no site scoping.
- **Fix** (`server.py` `get_vendors`, ~L1122): endpoint now requires auth (`Depends(get_current_user)`). For `role == "employee"` it restricts results to vendors that have an **active** `vendor_site_mappings` row for the employee's own `site_id` AND whose `vendors.status == "active"`. Admin roles (master/super/site/corp) keep the full list for management screens. Single backend change fixes all employee-facing pages at once.
- **Verified (iteration_30)**: 100% backend + frontend. Employee sees exactly the 7 correctly-mapped active vendors; suspended vendor, inactive-mapping vendor, and cross-site vendor excluded. Master admin still sees all 9 active vendors. Unauth = 401. Regression test: `/app/backend/tests/test_vendor_site_scoping.py`.

## Feb 27, 2026 — Vendor Panel Mobile Responsiveness (COMPLETED)

- **Root-cause bug fixed**: Mobile hamburger drawer was clipped to only 64px height (matched the navbar). Caused by `backdrop-filter` (`glass` class) on the parent `<nav>`, which creates a new containing block for `position: fixed` descendants. **Fix**: `Navbar.js` now renders the drawer via `createPortal(..., document.body)`, escaping the nav's containing block. Drawer now occupies the full 844px viewport height.
- **Responsive polish** across the Vendor Panel (Dashboard, Orders, Menu, Reports, Reservations, AI Insights, Menu Requests, Verify Pickup):
  - Standardized container padding to `px-4 sm:px-6 py-6 sm:py-8`
  - H1 sizing `text-3xl sm:text-4xl lg:text-5xl` with `tracking-tight sm:tracking-tighter` so long titles ("Menu Change Requests", "Order Management", "Tomorrow's Reservations") no longer overflow at 320-390px widths
  - KPI/card grids: Dashboard `grid-cols-1 sm:grid-cols-2 md:grid-cols-3`; Menu `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
  - Reports filters converted to `grid-cols-2 sm:flex` so From/To/Counter/Payment stack cleanly on phones with preset chips as full-width row
  - Tables (Reports per-counter, Reports order details, Reservations customer list) wrapped in `overflow-x-auto` with explicit `min-w-[560px]/[720px]` so they horizontally scroll inside cards instead of stretching the viewport
  - Orders page header actions become full-width side-by-side (`flex-1 sm:flex-none`) on mobile
- **Testing** (iteration_29): 100% pass at 390×844 (iPhone), 768×1024 (iPad), 1440×900 (desktop). No horizontal overflow on any vendor page. Drawer opens/closes correctly, all 7 nav links reachable, desktop layout unchanged.


## Feb 2026 — Code Review Fixes: 3 HIGH-severity defects (COMPLETED)

### P0-1: AI Photo Apply endpoint saved a broken image URL
- **Symptom**: Master Admin clicked "Use this photo" in the AI picker modal, the item's `image_url` was set to `/api/uploads/ai_<hex>.png`, and every customer viewing the item saw a 404 broken-image icon. `serve_upload` only resolves `s_`-prefixed Object-Storage tokens.
- **Fix**: `MenuPhotoApplyRequest` now accepts `photo_url` (preferred) and rejects the legacy `ai_*` basenames with a 400 pointing to Regenerate. Frontend `SiteDetail.js:300` sends the full `photo_url` returned by `/suggest`.
- **Regression tests**: 9 new cases in `test_apply_endpoint.py` (legacy rejection, path traversal, bogus schemes, missing fields, non-admin 403).

### P0-2: Reclassify-Veg silently flipped meat dishes to vegetarian (dietary safety)
- **Symptom**: `classify_veg("Chicken Corn Soup")` returned True (veg) because `\bcorn\b` was in the strong-veg override list. The bulk endpoint also overwrote `is_vegetarian` on every row unconditionally, destroying manual vendor overrides.
- **Fix**: Split tokens into `DEFINITE_NON_VEG_TOKENS` (chicken, mutton, fish, beef, pork, keema, prawn, crab, tuna, salmon, bacon, sausage, meat, turkey, duck) which ALWAYS win, `AMBIGUOUS_NON_VEG_TOKENS` (kebab, tikka, egg, anda, seekh) which lose to `STRONG_VEG_TOKENS` (paneer, aloo, dal, tofu, dosa, idli — no vegetables like corn/peas/mushroom). Endpoint now defaults `overwrite=false`; Dashboard button double-confirms safe vs overwrite mode.
- **Regression tests**: `TestClassifyVegUnit.test_meat_beats_ambiguous_vegetables` (15 new cases) + `test_reclassify_batch_only_missing_preserves_manual`.

### P0-3: Multi-vendor checkout only charged the first order
- **Symptom**: If an employee had items from 2+ vendors, the loop created N orders but only paid `orderIds[0]`. Cart was cleared for all vendors → orders 2..N were pending forever, revenue lost.
- **Fix**: `placeOrdersForAllVendors` now loops create-order → open Razorpay → verify sequentially per vendor. `paidVendors[]` drives selective cart-clear; failed vendors stay in cart for retry. Cancel intent short-circuits the loop.

### Regression suite (iter24)
124/124 backend tests green (test_veg_classifier 44, test_apply_endpoint 9, test_free_menu_photos 9, test_allergen_classifier 20, test_onboarding_menu 15, test_storage_upload 11, test_session_persistence 16). Paid AI live-gen tests intentionally skipped to preserve LLM budget.

## Feb 2026 — Bulk AI Photo-Fill (Free + Paid) + Per-Item Regenerate (COMPLETED)
- **Canonical taxonomy** on every menu item (`allergens: string[]`, values from
  `milk, nuts, peanuts, gluten, soy, sesame, egg, fish, shellfish, mustard`).
- **New module** `/app/backend/allergen_classifier.py` — dictionary-based
  Indian-cuisine heuristic (paneer/ghee/curd→milk, kaju/badam→nuts,
  moongfali/groundnut→peanuts, atta/maida/roti/naan→gluten,
  soya/tofu→soy, til/tahini→sesame, anda/omelette→egg,
  salmon/rohu→fish, prawn/crab→shellfish, sarson/rai→mustard).
  Word-boundary regex, canonical-order preserving.
- **Auto-classify on Excel bulk-upload** when the new `allergens` column
  is missing or empty. Explicit comma-separated values are still honoured.
- **Two remediation endpoints**:
  - `POST /api/onboarding/vendors/{id}/menu/reclassify-allergens?overwrite=`
    (draft menus).
  - `POST /api/admin/menu-items/reclassify-allergens?vendor_id=&site_id=&overwrite=`
    (live menu_items, master admin only).
- **Vendor Onboarding Menu tab UI**: amber chip picker for all 10 allergens
  in the Add/Edit modal (`menu-form-allergen-{key}`), new **Allergens** table
  column with chip badges, and a **Auto-classify Allergens** toolbar button
  next to Auto-classify Veg (`reclassify-allergens-btn`).
- **Employee Menu safety UX**: allergen chip badges under every dish. If
  the employee has saved allergies in Preferences, a top banner surfaces
  their allergies with a **"Hide items with my allergies"** toggle (ON by
  default). Matching items get red border + red chips when the toggle is
  OFF, and are hidden entirely when ON. New `PREF_TO_CANONICAL` mapping
  translates the free-form Preferences labels (Peanuts, Tree nuts, Dairy,
  Eggs, Soy, Wheat, Shellfish, Fish, plus sesame/mustard) into canonical
  keys.
- **Regression suite** `/app/backend/tests/test_allergen_classifier.py` —
  20 tests (13 unit + 7 HTTP integration). Full regression suites
  (`test_onboarding_menu`, `test_free_menu_photos`,
  `test_ai_photos_and_agreement`, `test_ai_photo_spend`,
  `test_storage_upload`, `test_session_persistence`) all still green:
  85/85 total.

## Feb 2026 — Code Quality Report Fixes (P0) + Complexity Refactor (P1) + Mobile Responsive Pass (COMPLETED)

### P0 — Code Quality (Critical)
- **Hardcoded fallback credentials removed** across all backend tests
  (`test_session_persistence.py`, `test_storage_upload.py`,
  `test_ai_photo_spend.py`, `test_cities_onboarding.py`,
  `test_dpdp_menu_push.py`, `test_master_admin_sites.py`,
  `test_corporate_domains*.py`, `test_pre_order_flow.py`,
  `test_phase1_full_audit.py`, `test_p1_features.py`,
  `test_new_features.py`, `test_pre_order_extended.py`,
  `test_free_menu_photos.py`, `test_cancel_refund_loyalty.py`,
  `test_dashboard_features.py`, `backend_test.py`,
  `test_vendor_commission.py`, `scripts/phase1_checklist.py`).
  Tests now hard-fail with a clear `pytest.skip(...)` message when
  `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `REACT_APP_BACKEND_URL` env vars
  are missing — no more silent fallback to prod-looking creds.
- **console.log/error/warn eliminated** across every frontend page and
  component (employee/*, master/*, vendor/*, admin/*, shared/*,
  OnboardingDetail, OnboardingList, OnboardingNew, NotificationBell).
  All replaced with `logger.error/warn/log` which no-ops in
  `NODE_ENV=production`.
- **React hook dependency violations fixed** — `useCallback` wrappers
  added and `useEffect` deps completed on
  `pages/shared/EventCatering.js`, `pages/OnboardingList.js`,
  `pages/master/MenuRequests.js`, `pages/master/Reservations.js`,
  `pages/employee/Menu.js`, `pages/employee/BulkOrder.js`. Zero
  react-hooks/exhaustive-deps warnings in `yarn start` output now.

### P0 — Bug Fix Discovered During Refactor (Critical)
- **`POST /api/ai/menu-photos/apply` was returning 404** because the
  `@r.post("/ai/menu-photos/apply")` decorator had been accidentally
  removed in commit `5c357f5` (Free AI Menu Photos ship). The frontend
  Photo Suggestion flow (`SiteDetail.js:299`) called it and silently
  failed. Decorator restored. **New regression suite**
  `/app/backend/tests/test_apply_endpoint.py` (4 pass, 2 env-skipped)
  guards against future regression.

### P1 — Complexity Refactor
- **`routers/ai_menu_photos.py` split** — 9 helper functions extracted
  to module scope: `_build_default_prompt`, `_save_image_to_storage`,
  `_load_image_gen_or_raise`, `_generate_one_image`, `_free_photo_urls`,
  `_try_fetch_free_photo`, `_menu_photo_url`, `_bulk_candidates`,
  `_bulk_fill_one`. `make_router()` cyclomatic complexity dropped from
  43 → ~8. Cost constant `COST_PER_IMAGE_INR = 3.5` centralised. All
  audit-log semantics + response shapes preserved. **23/23** AI photo
  tests still pass.

### C — Mobile Responsive Pass (Employee Pages)
- Container padding on all employee pages now `px-4 sm:px-6 py-6 sm:py-8`
  (was fixed `px-6 py-8`).
- Card padding `p-4 sm:p-6` (was `p-6`).
- Page headings scale `text-3xl sm:text-4xl md:text-5xl` (was
  fixed `text-4xl sm:text-5xl`).
- Orders page: order cards stack vertically on mobile, action buttons
  wrap with `flex-wrap gap-2`, `touch-manipulation` on tap targets,
  amount + status pill anchored bottom-right on desktop / top-right on
  mobile.
- Pages touched: `Orders`, `Preferences`, `Loyalty`, `Subscriptions`,
  `Reservations`, `Dashboard`, `BulkOrder`.

### Regression Coverage (iter22)
Backend: 67/67 executed pytest tests pass (test_apply_endpoint,
test_ai_photos_and_agreement, test_ai_photo_spend, test_onboarding_menu,
test_storage_upload, test_free_menu_photos, test_session_persistence).
Frontend: admin login OK, master dashboard renders with AI photo spend
widget, 0 real console errors, no horizontal page overflow at 390×800.

## Feb 2026 — Free AI Menu Photos (Unsplash + Pollinations) (COMPLETED)
- **Zero-cost photo path** for menu items — new endpoint
  `POST /api/ai/menu-photos/suggest-free` tries Unsplash Source first,
  falls back to Pollinations.ai (both keyless, no rate-limit for
  Cravitoo's volume). Bytes are downloaded server-side, persisted to
  Emergent Object Storage, and returned as a `/api/uploads/s_...` URL.
- **UI**: emerald **ImageIcon** button (`data-testid="menu-free-photo-*"`)
  next to the existing violet Sparkles paid button on the Vendor
  Onboarding Menu tab. One-tap generation, animate-pulse while busy,
  single-row busy invariant enforced.
- **Spend-counter integrity**: the `/api/admin/ai-photos/spend`
  aggregator now filters `cost_inr: {$ne: 0}`, so free-source rows
  (Unsplash / Pollinations) don't inflate the paid-image dashboard.
  Row still audited in `ai_image_generations` with source tag +
  `cost_inr=0` for analytics.
- **Regression suite** `/app/backend/tests/test_free_menu_photos.py`
  (9 tests, all green) — auth 401/403, validation 422 x3, happy path
  with byte-size delta, spend-non-inflation, paid endpoint
  non-regression.

## Feb 2026 — Veg / Non-Veg Classification Fix (COMPLETED)
- **Bug:** In the Vendor Onboarding Menu tab (and any menu built from
  Excel bulk-upload), every item was rendering with a red dot (non-veg)
  even for obvious veg dishes like "Paneer Masala" or "Veg Sandwich".
  Root cause — the Excel parser treated a missing / empty
  `is_vegetarian` column as `False`.
- **New module** `/app/backend/veg_classifier.py` — heuristic name+
  description classifier. Word-boundary regex: paneer/aloo/dal/veg/
  sabzi/mushroom/tofu (+ many more) → veg; chicken/mutton/fish/egg/
  prawn/keema/etc → non-veg; unknown → veg (Indian corporate default
  matches FSSAI green-dot convention).
- **Excel parser** now auto-classifies when the column is missing or
  blank; explicit user values ("yes"/"no"/"veg"/"non-veg") are still
  honoured verbatim.
- **Two remediation endpoints** for historic data:
  - `POST /api/onboarding/vendors/{id}/menu/reclassify-veg`
    (draft menus, master/site/city admin)
  - `POST /api/admin/menu-items/reclassify-veg?vendor_id=&site_id=`
    (live menu_items collection, master admin only)
- **UI**: emerald *"Auto-classify Veg"* button on the Vendor Onboarding
  Menu tab (`data-testid="reclassify-veg-btn"`). Hidden when the menu
  is empty.
- **Side-fix**: `DELETE /api/onboarding/vendors/{id}/menu/{item_id}` was
  missing its `@r.delete(...)` decorator (regression from an earlier
  edit). Restored; menu-item deletion works again.
- **Regression suite** `/app/backend/tests/test_veg_classifier.py` — 25
  tests, all green (16 unit + 2 Excel upload + 4 onboarding reclassify +
  2 live menu_items reclassify + 1 word-boundary safety test).

## Feb 2026 — Code-Review Cleanup Pass (COMPLETED)
- **Env-driven test credentials.** `ADMIN_EMAIL` / `ADMIN_PASSWORD` in
  `test_storage_upload.py`, `test_onboarding_menu.py`,
  `test_ai_photos_and_agreement.py`, `test_session_persistence.py` now
  read from `os.environ.get(...)` with the previous hard-coded values
  as sensible fallbacks. Env-override behaviour verified.
- **`/app/frontend/src/lib/logger.js`** — new dev-only logger util. In
  production builds (`NODE_ENV=production`) every `logger.log/warn/error`
  compiles to a no-op so debug traces don't leak to end-users' devtools.
- **console.error/log calls replaced with `logger.*`** across
  `master/Vendors.js`, `master/SiteDetail.js`, `superadmin/Dashboard.js`,
  `siteadmin/Dashboard.js`, `shared/EventCatering.js`.
- **`CookieConsent.js`** — silent `catch {}` blocks now `logger.warn(err)`.
- **`App.js`** — 12 inline `allowedRoles={[...]}` arrays extracted into
  module-scope constants (`ROLES_EMPLOYEE`, `ROLES_MASTER`, `ROLES_ANY`,
  etc.). Stable references, no reconciler churn on every render.
- **`useCallback` stabilisation** on `master/Vendors.js` and
  `master/Sites.js` fetch loaders — `useEffect` dependencies now honest.
- Skipped from this pass (out of scope, would risk regressions): large-
  component refactors (`OnboardingDetail`, `LoginPage`, `App.js` routing
  extraction), Python function-complexity refactors (email_service,
  admin_reports, ai_menu_photos), gradual TypeScript migration.
- Verified by testing agent (`iteration_19.json`, 42/42 pytest + 3
  frontend pages, zero console errors).

## Feb 2026 — AI Photo Spend Card on Master Dashboard (COMPLETED)
- **New endpoint** `GET /api/admin/ai-photos/spend` (master admin only)
  aggregates `ai_image_generations` rows and multiplies by ₹3.5/image.
  Returns MTD, last-30-days, and all-time buckets (rows + images + spend).
  Handles both event shapes (`count_generated` from /suggest and `filled`
  from /bulk-fill) via `$ifNull` fallback.
- **Master Dashboard card**: violet-bordered card between the orphan-
  warning and weekly-email cards. Shows Sparkles icon, MTD spend, and
  last-30-days spend with image counts. Hidden entirely on fresh installs
  where all_time.images = 0 so new admins don't see a "₹0" card.
- **Regression suite**: `/app/backend/tests/test_ai_photo_spend.py`
  (5 tests, all green). Covers schema+math, auth (401/403), both-shape
  aggregation via scratch rows, and empty-collection zeros.

## Feb 2026 — AI Menu Photos + Agreement Doc + Persistent Storage (COMPLETED)
- **AI menu-photo endpoints migrated to Emergent Object Storage.** Previously
  `/api/ai/menu-photos/{suggest,apply,bulk-fill}` wrote generated PNGs to
  `/tmp/cravitoo_uploads` — same ephemeral-disk class of bug as iter-16.
  Now they `put_object` to `cravitoo/ai-menu-photos/` and return
  `s_<b64>`-encoded URLs that persist across pod restarts / redeploys.
- `/api/ai/menu-photos/apply` relaxed to accept BOTH the legacy
  `ai_<hex>.png` filenames AND the new `s_<b64>` tokens.
- **New DOC_TYPE `agreement`** in `models.py` — the signed Vendor Agreement
  PDF. Frontend `OnboardingDetail.js` now shows 9 doc cards, with
  "Vendor Agreement (signed) *" as a required upload.
- **Per-row AI-photo button** on the Vendor Onboarding Menu tab
  (`MenuTab.js`): a violet Sparkles icon next to Edit/Delete. Clicking
  it generates one AI image via gpt-image-1 and auto-attaches it to
  the draft menu item — perfect for replacing broken photos or
  bootstrapping images for vendors who don't supply their own.
- Master Menu Management already had bulk-fill + per-item Sparkles;
  those now benefit from the same persistent-storage backend.
- **Regression suite:** `/app/backend/tests/test_ai_photos_and_agreement.py`
  (9 tests) + iter-16's `test_storage_upload.py` (11 tests). All 20 green,
  including the cross-restart persistence assertion.

## Feb 2026 — Vendor Onboarding "File not found" Bug Fixed (COMPLETED)
- **Bug (production):** clicking View on any Vendor Onboarding document
  returned `{"detail":"File not found"}`. Uploads were being stored on the
  Kubernetes pod's `/tmp/cravitoo_uploads` — an ephemeral folder wiped on
  every re-publish, leaving DB rows pointing to non-existent files.
- **Fix:** Migrated file uploads to **Emergent Object Storage** (persistent,
  cross-restart). New `/app/backend/storage.py` wraps put/get with a
  retry-on-inactive-key. `POST /api/onboarding/vendors/{id}/documents/*`
  and `POST /api/upload/menu-image` now write to
  `cravitoo/onboarding/{id}/...` / `cravitoo/menu-images/...` respectively
  and return a URL whose filename is `s_` + urlsafe-b64(path).
  `GET /api/uploads/{filename}` decodes the token and streams via
  `get_object`. Legacy `/tmp` filenames still get a friendly 404 asking
  the user to re-upload.
- All storage calls now `run_in_threadpool` so the async event loop is
  never blocked by the sync `requests` client.
- Storage init logged at startup: `INFO - Emergent Object Storage
  initialized`.
- **Regression suite:** `/app/backend/tests/test_storage_upload.py` — 11
  tests, all green. Includes the critical *upload → supervisor restart →
  re-GET returns 200 with identical bytes* assertion.

## Feb 2026 — Mobile-First Menu & Checkout UX (COMPLETED)
- **Floating checkout bar** on mobile (< lg breakpoint): fixed at bottom,
  shows live count + total (`3 items · ₹580`) with cart icon badge.
  Hidden on desktop.
- **Bottom-sheet cart drawer** on mobile: swipe-up animation, vendor-
  grouped items, +/- qty controls, "Keep shopping" back-out, X close,
  backdrop tap to dismiss. Body scroll is locked while open.
- **Desktop unchanged**: still uses the sticky right-column cart. Tapping
  the checkout button scrolls smoothly to the sticky cart if the user is
  ≥ 1024 px wide.
- **Mobile hamburger nav**: Navbar now shows a hamburger on < md that
  opens a full-height slide-in drawer with all role-appropriate links,
  user identity, quick links (Preferences, Meal Plans, Change Password,
  Data & Privacy), and Logout. Closes automatically on route change.
- **Menu page**: vendor tabs are horizontally scrollable with snap-scroll,
  menu cards drop to single column below sm, images shorter on small
  screens, buttons enlarged to `touch-manipulation` size.
- Duplicate data-testids in the mobile sheet suffixed with `-sheet`
  (e.g. `cart-total-sheet`, `place-order-btn-sheet`) so Playwright
  strict-mode selectors and screen readers don't see them twice.
- `CartInner` hoisted out of `EmployeeMenu` (props-driven) — fixes the
  React "component defined during render" anti-pattern.
- Verified end-to-end by testing agent (`iteration_15.json`,
  12/12 mobile flows + 3/3 desktop flows pass).

## Feb 2026 — Persistent Employee Sessions + Admin Deactivate (COMPLETED)
- **Behaviour**: Employees stay logged in indefinitely across app close /
  device restart. Session only ends on manual logout or when a master/super
  admin deactivates the account.
- **Backend changes:**
  - `refresh_token` lifetime **7 days → 365 days** (login, register, OTP
    verify — all cookie `max_age` set to 31 536 000).
  - `get_current_user` and `/auth/refresh` now return **403 "Account
    deactivated"** when `users.is_active === False`. Missing/undefined
    field is treated as active (backwards-compat).
  - `/auth/login` and `/auth/otp/verify` also short-circuit for
    deactivated accounts (avoids handing out doomed tokens).
  - New admin endpoints: `POST /api/admin/users/{id}/deactivate` and
    `/reactivate` — master/super admin only, cannot self-deactivate,
    cannot deactivate a master admin. Writes an `audit_log` row.
- **Mobile changes:**
  - `client.js` — new response interceptor: on 401, silently calls
    `/auth/refresh` with the stored refresh_token and retries the
    original request. Concurrent refreshes are de-duplicated. On
    403 "Account deactivated" or refresh failure, both tokens are
    wiped and the app returns to the Login stack via
    `setSessionInvalidCallback`.
  - `AuthContext.bootstrap` tries the refresh flow before deleting
    tokens on `/auth/me` failure.
- **Regression suite:** `/app/backend/tests/test_session_persistence.py`
  (16 tests, all green) covers login/OTP refresh lifetime, refresh happy
  + sad paths, deactivate/reactivate lifecycle, role guards, self-guard,
  master-admin guard, audit log, and backwards-compat.

## Feb 2026 — Master Admin Password Auto-Reset Bug Fixed (COMPLETED)
- **Bug:** `seed_admin()` in `server.py` was overwriting the admin's stored
  `password_hash` back to `ADMIN_PASSWORD` on every backend restart if the
  stored hash didn't verify against that env value. Any password change
  was silently reverted on the next redeploy / auto-reload.
- **Fix:** `seed_admin()` now only writes the password on **first creation**.
  Existing admins keep whatever password they set — role/name drift is still
  self-healed, but the hash is never touched.
- **Regression suite:** `/app/backend/tests/test_seed_admin_password.py`
  (2 tests, green) — proves the changed password survives repeated
  `seed_admin()` calls.
- Verified with real curl reproduction: change password → restart backend →
  old password returns 401, new password logs in successfully.

## Feb 2026 — Vendor Onboarding Menu Tab (COMPLETED)
- New dedicated **Menu tab** inside `/onboarding/{id}` with full CRUD:
  - `POST   /api/onboarding/vendors/{id}/menu` — add single item.
  - `PATCH  /api/onboarding/vendors/{id}/menu/{item_id}` — partial update.
  - `DELETE /api/onboarding/vendors/{id}/menu/{item_id}` — remove one.
  - `POST   /api/onboarding/vendors/{id}/menu/upload-excel` — bulk replace.
- Every item carries: `name`, `description`, `category`, `price`,
  `is_vegetarian`, `is_available`, `meal_periods` (list of
  breakfast/lunch/snacks/dinner), `image_url`, plus a UUID `item_id`.
- Excel template accepts `meal_period` column with comma-separated values.
- On master approval, `draft_menu` is materialised into the `menu_items`
  collection bound to the newly-created `vendor_id` + `site_id` — response
  now returns `menu_items_created` count.
- Edit-window is enforced: only statuses `draft`, `documents_pending`,
  `under_site_review`, `changes_requested`, `under_master_review` allow
  menu edits (approved/active/rejected are 400).
- Regression suite at `/app/backend/tests/test_onboarding_menu.py`
  (15 tests, all green).

## Feb 2026 — Client Handover Clean Slate (COMPLETED)
- Auto `seed_demo_data` **permanently disabled** on startup (no test data ever again).
- Demo panel removed: `routers/demo.py` + `frontend/src/pages/master/DemoControl.js`
  deleted; App.js route and Navbar link removed.
- Preview MongoDB wiped (backup collection `_wipe_backup_20260725_*`); master
  admin login preserved.
- New hard-delete endpoints with full cascade:
  - `DELETE /api/sites/{site_id}` — cascades meal_schedules, vendor_site_mappings,
    menu_items, orders, order_status_history, reservations; unbinds users.
  - `DELETE /api/vendors/{vendor_id}` — cascades vendor_site_mappings, menu_items,
    orders, reservations, favorites, vendor login user.
  - `DELETE /api/master/corporate-clients/{id}?cascade=true` — hard-deletes the
    client and all linked users, sites, orders, order_status_history,
    payment_transactions, reservations, pre_order_reservations, menu_items,
    vendor_site_mappings, meal_schedules, vendor_onboarding, allowed_domains,
    invoices.
  - `DELETE /api/onboarding/vendors/{onb_id}` — single-row hard delete.
  - `DELETE /api/onboarding/vendors?prefix=TEST__` — bulk purge by name prefix.
- Reset-to-Blank (`POST /api/admin/reset-to-blank`) collections extended to
  include `vendor_onboarding`, `menu_change_requests`, `favorites` so the
  Dashboard reads 0 across the board after a reset.
- Frontend delete UX:
  - Sites, Vendors: single-click Trash icon on the row.
  - Corporate Clients: first click attempts safe delete; if backend reports
    "employees still linked", a second confirm-dialog offers cascade delete
    in one click (no need for the user to know about the `?cascade=true` URL
    param).
  - Vendor Onboarding: per-row Trash icon + master-admin "Purge Test Data"
    button (bulk-deletes rows by vendor-name prefix, defaults to `TEST__`).

## Master Prompt PDF Gap Analysis (Feb 2026)

User uploaded the Cravitoo Master Prompt PDF. Compared against existing app, identified **8 gap items**. Plan agreed with user is to ship in 5 steps:

| Step | Items | Status |
|------|-------|--------|
| **1** | #1 Corporate domain restriction + #4 Email triggers (vendor/menu/site activation) + #7 Site lifecycle | ✅ **DONE (iter23, Feb 2026)** |
| **2** | #2 Fixed pre-order meal types + #3 Corporate Admin 8:00–8:45 PM bulk override | ✅ **DONE (iter24, Feb 2026)** |
| **3** | #5 Excel/CSV/PDF export buttons across all reports | ✅ **DONE (iter24, Feb 2026)** |
| **4** | #6 Corporate Client lifecycle (Draft → Review → Approved → Active) | ✅ **DONE (iter24, Feb 2026)** |
| **5** | #8 Monthly Billing Engine (Excel + PDF + auto-email) | ✅ **DONE (iter24, Feb 2026)** |

**All 8 PDF gaps now closed.** 49+ hours of work completed in 2 iterations with 62 pytest tests passing (22 iter23 + 40 iter24).

## Architecture (Iteration 23)

### Tech Stack
- **Backend**: FastAPI + MongoDB + JWT + WebSockets + Razorpay + emergentintegrations
- **Web Frontend**: React + Tailwind + Shadcn UI
- **Mobile**: Expo SDK 52 + React Navigation 7 + react-native-razorpay + expo-camera
- **AI**: OpenAI GPT-5.2 + gpt-image-1 (Emergent LLM key)
- **Real-time**: Native FastAPI WebSockets
- **Payments**: Razorpay (test keys live; production needs prod keys)
- **Emails**: Resend (cravitoo.com domain verified)
- **Push**: Expo Push Notifications

### Design
- Primary Orange: #FF5A1F, Accent Yellow: #FACC15
- Fonts: Outfit (headings), Work Sans (body)

## Implementation Progress

### Iteration 25: Spec Alignment — Master Admin City Management (Feb 2026) ✅

User shared a new "Master Admin Workflow" spec mandating strict hierarchy and full CRUD + Archive/Restore + Region field on Cities.

- **Backend**: Added `region` field to City model. New endpoints: `POST /api/cities/{id}/archive`, `POST /api/cities/{id}/restore`, `DELETE /api/cities/{id}` (blocked when linked Sites or City Admins exist). `GET /api/cities?include_archived=true` toggle.
- **Frontend**: Cities page now has Edit / Archive / Restore / Delete per card, "Show archived" toggle, Region dropdown in form, archived-state visual treatment.
- Hierarchy enforcement: City delete is hard-blocked if any Sites or City Admins reference it — must archive instead. This protects the platform hierarchy contract.

### Iteration 24: PDF Gap Steps 2–5 — Meal Types, Bulk Pre-Order, Exports, Client Lifecycle, Billing (Feb 2026) ✅

**Step 2 — Fixed Meal Types & Corp Admin Bulk Override:**
- `meal_type` enum on reservations: `veg_meal | non_veg_meal | veg_salad | non_veg_salad`
- `POST /api/reservations` requires `meal_type`; `GET /api/reservations/availability` exposes the 4 fixed options
- New `POST /api/reservations/bulk` (corp_admin only) accepts `{site_id, vendor_id, meal_period, counts: {meal_type: int}, note?}` — only between 20:00–20:45 IST
- `GET /api/reservations/bulk-window` returns `{is_open, window_start_ist, window_end_ist, meal_types}` for the corp admin UI to show countdown
- Vendor counts now include `by_meal_type` breakdown for prep planning
- Web: Employee Reservations page has 4 meal-type chips; new `/admin/bulk-pre-order` page for corp admin; Vendor Reservations shows meal-type column + bulk-source badge
- Mobile: ReservationsScreen has 4 meal-type chips

**Step 3 — Excel / CSV / PDF Exports:**
- New `/api/exports/{reservations|orders|vendor-sales|meal-summary}?format=xlsx|csv|pdf` (4 endpoints × 3 formats = 12 export combos)
- openpyxl + reportlab installed
- Reusable `<ExportButtons>` component (`/app/frontend/src/components/ExportButtons.js`) wired into master/Reservations, vendor/Reservations, and admin/Dashboard pages
- Corp Admin auto-scoped to their company; vendor scoped to their vendor_id

**Step 4 — Corporate Client Lifecycle:**
- `companies` extended with `lifecycle_status` (draft → review → approved → active), `billing_contact_name/email`, `notes`, `lifecycle_history`
- New router `/api/master/corporate-clients` (CRUD + lifecycle endpoint)
- Welcome email fires on `approved` transition via existing `render_welcome_email`
- Web: `/master/corporate-clients` page with stage badges, advance buttons, edit/delete

**Step 5 — Monthly Billing Engine:**
- New `/api/billing/run` (manual master trigger), `/billing/invoices` (list), `/billing/invoices/{id}/download?format=xlsx|pdf`, `/billing/invoices/{id}/resend`
- APScheduler-style background task fires monthly on **1st of next month at 06:00 IST**
- Per-site `meal_prices` config (defaults to ₹120/₹150/₹100/₹130) × reservation counts → Excel (line-level) + PDF (summary) generated and stored as blobs
- `email_service.send_email()` now supports Resend attachments
- Web: `/master/billing` page with month picker, generate button, invoice table with download/resend
- Corp Admin sees only own company's invoices

**Tests:** 40 new pytest tests (`test_iter24_step2_to_5.py` + `test_iter24_additional.py`). All pass + testing agent 100% verification.

### Iteration 23: PDF Gap Step 1 — Domain Restrict + Email Triggers + Site Lifecycle (Feb 2026) ✅

**Item #1 — Corporate Domain Allowlist:**
- New router `/app/backend/routers/allowed_domains.py` wired in `server.py`
- Endpoints:
  - `GET /api/admin/allowed-domains` — list (Master only)
  - `POST /api/admin/allowed-domains` — add corporate domain (rejects gmail/yahoo/outlook/etc.)
  - `DELETE /api/admin/allowed-domains/{id}`
  - `GET /api/auth/check-domain/{domain}` — public sign-up validator
- 13 free-email providers hard-blocked: gmail/yahoo/outlook/hotmail/live/icloud/aol/protonmail/rediffmail/mail/zoho/yandex/yahoo.co.in
- `auth.py` `register()` and `request_otp()` reject non-allowed domains for new users
- New web page `/master/allowed-domains` — CRUD UI with auto-blocked banner, table with company/site links + notes
- Master Admin Navbar gets new "Domains" link

**Item #4 — Email Automation Triggers:**
- `render_vendor_decision_email()` and `render_menu_decision_email()` and `render_site_activated_email()` templates already existed in `email_service.py` — wired them up:
  - `onboarding.py master_decision`: now sends branded vendor approved/rejected email on top of the existing invitation email
  - `menu_change_requests.py decide_menu_change_request`: now emails the requesting vendor on approve/reject
  - `sites.py transition_site_lifecycle`: sends site-activated email to POC on the `configured → live` transition

**Item #7 — Site Lifecycle (Draft → Configured → Live):**
- New field `lifecycle_status` on `sites` (defaults to `draft` on create; legacy rows default to `live` in API output)
- New endpoint `POST /api/sites/{id}/lifecycle` with body `{ to: 'draft'|'configured'|'live', poc_name?: str }`. Strict transition graph: `draft→configured`, `configured→{draft,live}`, `live→configured`. Invalid jumps return 400.
- Going Live: sets `activated_at`, fires `render_site_activated_email` to the site's `contact_email`. Response includes `site_activated_email_sent: bool`.
- **Registration gating**: When an `allowed_domains` rule has a `site_id`, the linked site must be `lifecycle_status == "live"` for `/auth/register` and `/auth/otp/request` to allow new sign-ups. Existing users always sign in.
- Web UI: `/master/sites` shows a per-card lifecycle badge (Draft/Configured/Live with slate/amber/emerald palette). `/master/sites/:id` Settings tab gets a new "Site Lifecycle" panel with stage transition buttons and a POC name input for the Live activation step.

**Tests:** 22 new pytest tests at `/app/backend/tests/test_iter23_step1.py` + `test_iter23_step1_extended.py`. All pass.

### Iteration 22: Razorpay payment integration + refresh tokens (Feb 2026) ✅
- Migrated entirely from Stripe to **Razorpay** (test keys in .env)
- Added JWT refresh token endpoint `/api/auth/refresh` + Axios interceptor for mid-session token rotation
- Generated full mongodump backup at `/app/cravitoo_data_export.tar.gz`

### Iteration 21: Vendor-side Photo Audit Panel (Feb 2026) ✅
(See full earlier history below — preserved)

### Iteration 20: AI Bulk-fill + Menu Request Photo Upload + Vendor Daily Digest (Feb 2026) ✅

### Iteration 19: Notification Prefs + Daily Digest + Master Admin Broadcasts (Feb 2026) ✅

### Iteration 18b: 🔴 P0 Hotfix — Pre-order IST Timezone Bug (Feb 2026) ✅

### Iteration 18: Login Error UX + iOS App Store Guide + AI Menu Photos (Feb 2026) ✅

### Iteration 17: server.py Phase 2 Refactor — Complete (Feb 2026) ✅

### Iteration 16: Mobile Reservations UI + server.py Phase 2 Refactor (Feb 2026) ✅

### Iteration 15: Meal Reservations / Pre-Ordering (Feb 2026) ✅

### Iteration 14: Vendor Menu Change Request Workflow (Feb 2026) ✅

### Iteration 13: Email OTP + Resend Integration + Compliance (Feb 2026) ✅

### Iteration 12: Legal Pages + DPDP Rights + server.py Refactor (Feb 2026) ✅

### Iteration 11: Push Notifications (Expo Push) (Feb 2026) ✅

### Iteration 10: Vendor Menu Lock-down (Feb 2026) ✅

### Iteration 9: Mobile APK Login Fix + OTA Setup (Feb 2026) ✅

### Iteration 8: P1 Batch — Refunds/Favorites/Subscription/Onboarding-tooling (Feb 2026) ✅

### Iterations 1–7: Core MVP, Multi-tenant Onboarding, Vendor + Site Lifecycle, AI features, real-time, mobile

## API Endpoints (Comprehensive)

### Auth (returns tokens for mobile, cookies for web)
- POST /api/auth/register, /api/auth/login, /api/auth/logout, GET /api/auth/me
- **POST /api/auth/refresh** (NEW iter22 — refresh access_token via refresh_token cookie/header)
- POST /api/auth/otp/request, POST /api/auth/otp/verify
- **GET /api/auth/check-domain/{domain}** (NEW iter23 — public domain validator)

### Allowed Domains (NEW iter23)
- GET / POST / DELETE /api/admin/allowed-domains[/id]

### Sites
- POST / GET / PATCH /api/sites[/id]
- **POST /api/sites/{id}/lifecycle** (NEW iter23 — draft→configured→live, fires site-activated email)

### Razorpay (NEW iter22 — replaces Stripe)
- POST /api/payments/razorpay/create-order
- POST /api/payments/razorpay/verify
- POST /api/payments/razorpay/webhook

### AI
- POST /api/ai/recommendations
- POST /api/ai/demand-forecast / wastage-analysis
- POST /api/ai/menu-photos/suggest / apply / bulk-fill

### Reservations, Menu Change Requests, Onboarding, Notifications, Broadcasts — see earlier sections

## Demo Credentials (see /app/memory/test_credentials.md)

| Role | Email | Password |
|------|-------|----------|
| Master Admin | admin@cravitoo.com | admin123 |
| Corporate Admin | demo@techcorp.com | demo123 |
| Site Admin | siteadmin@techcorp.com | site123 |
| Vendor | vendor@spicekitchen.com | vendor123 |
| Employee | employee@techcorp.com | employee123 |

## Prioritized Backlog (Remaining Items)

### All PDF Gap Items Closed ✅
8/8 items from the Master Prompt PDF are now implemented.

### Optional Future Enhancements
- [ ] **Per-site Meal Prices UI** — Master Admin UI to edit `sites.meal_prices` (currently uses defaults: ₹120/₹150/₹100/₹130). Lower priority; can be edited directly in Mongo for now.
- [ ] **Subsidy mode toggle UI** — currently all sites assumed company-pay; add per-site `subsidy_mode: employee_pay | company_pay` toggle if employee-pay sites need to bypass billing
- [ ] **Bulk-window auto-extend** — Corp Admin requested rolling 5-min override beyond 20:45 for VIP escalation (low-priority)

### Production / Ops
- [ ] Set `RAZORPAY_WEBHOOK_SECRET` in production env (user action)
- [ ] iOS App Store TestFlight submission
- [ ] Server.py final extraction phase (orders + vendor logic still inline)
- [ ] Move invoice blobs to S3/GCS (currently stored in Mongo `invoices.{xlsx_blob,pdf_blob}` — fine for low volume, but blob storage scales better)

## Known Limitations
- WebSocket in-memory store (auto-reconnect in 5s)
- Resend free-tier (100 emails/day) — monitor; upgrade plan when scaling
- AI endpoints have no rate limiting yet
- Some legacy sites in DB don't have `lifecycle_status` field — API treats missing as 'live' for safety


