# Cravitoo - Product Requirements Document

## Original Problem Statement
Build a production-ready, scalable, enterprise-grade full-stack food-tech application called Cravitoo for India - smart corporate food ordering and cafeteria management ecosystem.

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


