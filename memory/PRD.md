# Cravitoo - Product Requirements Document

## Original Problem Statement
Build a production-ready, scalable, enterprise-grade full-stack food-tech application called Cravitoo for India - smart corporate food ordering and cafeteria management ecosystem.

## Architecture (Iteration 5)

### Tech Stack
- **Backend**: FastAPI + MongoDB + JWT + WebSockets + Razorpay + emergentintegrations
- **Web Frontend**: React + Tailwind + Shadcn UI
- **Mobile**: Expo SDK 52 + React Navigation 7 + react-native-razorpay + expo-camera
- **AI**: OpenAI GPT-5.2 (Emergent LLM key)
- **Real-time**: Native FastAPI WebSockets (no external service)
- **Payments**: Razorpay (with mock mode for dev) + Stripe (web fallback)

### Design
- Primary Orange: #FF5A1F, Accent Yellow: #FACC15
- Fonts: Outfit (headings), Work Sans (body)
- Mobile: native iOS/Android navigation patterns

## Implementation Progress

### Iteration 1: Core Web MVP ✅
- Multi-role auth (Employee/Vendor/Corp Admin/Super Admin)
- Employee menu browsing, cart, ordering
- Stripe checkout (web)
- AI food recommendations

### Iteration 2: Security + Engagement ✅
- Brute-force lockout, secure cookies
- Order status enum, server-side price validation
- QR pickup verification, Reviews & Ratings
- Meal Subscriptions, Preferences

### Iteration 3: Operations + Advanced ✅
- Vendor Menu CRUD (web)
- Employee Management (Corp Admin)
- Bulk Team Ordering (sponsored), Event Catering
- In-app notifications
- AI Demand Forecasting + Wastage Analysis
- Multi-vendor cart, Loyalty System

### Iteration 4: Mobile App MVP (Employee) ✅
- Expo SDK 52 mobile app at /app/mobile/
- 10 employee screens (Login, Home, Menu, Cart, Orders, OrderDetail w/ QR, Loyalty, Notifications, Profile)
- JWT Bearer auth via expo-secure-store
- APK builds via EAS

### Iteration 5: Real-time + Mobile Vendor + Razorpay ✅
- **WebSockets**:
  - Backend `ConnectionManager` with user_id and vendor_id rooms
  - `/ws/orders` for employees, `/ws/vendor` for vendors
  - JWT auth via query token
  - Order creation broadcasts to vendor, status update broadcasts to user
  - Mobile hook `useOrdersSocket` with auto-reconnect + ping/pong heartbeat
- **Razorpay**:
  - Backend endpoints: `/payments/razorpay/create-order` and `/verify`
  - HMAC SHA256 signature verification (production), mock mode (dev)
  - Configurable via `RAZORPAY_MOCK_MODE=true|false`
  - Mobile uses `react-native-razorpay` SDK (real APK) or mock dialog (Expo Go)
- **Vendor Mobile App**:
  - Role-based routing in App.js: detects role → routes to Employee or Vendor tabs
  - 5 vendor screens: Dashboard, Orders (with filter chips + status transition), Menu (CRUD with modal), QR Scanner (expo-camera), AI Insights
  - Real-time order notifications via WebSocket
  - Camera permission flow for QR scanner

### Iteration 13: Email OTP + Resend Integration + Compliance (Feb 2026) ✅
- **Email OTP Login**: Channel-agnostic OTP system (`email_service.py`). 6-digit codes, bcrypt-hashed, 10-min expiry, max 5 verify attempts, rate-limited 3/hour per email.
  - `POST /api/auth/otp/request` — generate + send code via email (SMS/WhatsApp stubs return 501 for future)
  - `POST /api/auth/otp/verify` — verify code → issue JWT, auto-create employee account if new
  - Anti-enumeration: identical response whether email exists or not
- **Resend Integration**:
  - `resend@2.30.1` installed; `RESEND_API_KEY` + `RESEND_FROM_EMAIL` + `RESEND_FROM_NAME` in `.env`
  - Domain `cravitoo.com` verified in Resend (US-East-1)
  - DNS records: DKIM TXT, SPF MX + TXT, DMARC TXT — all green on Hostinger
  - Sender: `Cravitoo <noreply@cravitoo.com>`
- **Transactional Email Templates** (`email_service.py`):
  - Branded OTP code email (orange/cream Cravitoo design)
  - Welcome email (role-aware — different copy for vendor vs employee)
  - Order confirmation email with itemised total + pickup instructions
  - Weekly admin summary report (metrics + top-5 vendors)
- **Trigger Points**:
  - `POST /api/auth/register` → fires welcome email
  - `POST /api/orders` → fires order confirmation to customer
  - `POST /api/admin/reports/weekly/send` → master_admin-only; computes 7-day metrics & emails admins
- **Web LoginPage**: Mode-toggle UI — Password ↔ "Login with Email Code" ↔ "Enter Verification Code" with countdown + resend
- **Mobile LoginScreen**: Same 3-mode UI for both Customer + Partner variants
- **`AuthContext`**: Exposed `loginWithOtp(email, code)` + `requestOtp(email, channel)` (web + mobile)
- **Cookie Consent Banner** (`/app/frontend/src/components/CookieConsent.js`):
  - One-time banner, localStorage-persisted choice (`accepted` | `dismissed`)
  - Honest messaging: "We use only essential cookies" — no dark patterns
  - Links to Privacy Policy
- **Master Dashboard**: "Send weekly report now" quick action button with live status feedback
- **Verified**:
  - ✅ Real Resend send to admin@cravitoo.com succeeded (sender = `noreply@cravitoo.com`)
  - ✅ OTP request → verify → JWT issued → /auth/me works
  - ✅ Replay of used OTP code → 400
  - ✅ Weekly report endpoint sent 1 email to master admin
  - ✅ Vendor blocked from triggering weekly report (403)
  - ✅ Cookie banner shows on first visit, hides on accept
  - ✅ 68/68 existing tests still pass

### Iteration 12: Legal Pages + DPDP Rights + server.py Refactor (Feb 2026) ✅
- **Privacy Policy** (`/privacy`): Full DPDP Act 2023 / GDPR compliant, 10 sections (collection, use, storage, sharing, retention, rights, security, children, cookies, changes), grievance officer contact, India data-residency notes (Mumbai). 14-day notice for material changes.
- **Terms of Service** (`/terms`): 13 sections covering eligibility, orders/payments, pickup, loyalty rules, vendor responsibilities (incl. new menu-managed-by-Cravitoo clause), prohibited conduct, IP, disclaimers, liability cap (₹10k or 3-month spend), Bengaluru jurisdiction.
- **DataSettings page** (`/settings/data`): In-app self-service for the right to access (Download data → JSON file) and right to erasure (DELETE confirmation flow with type-DELETE-to-confirm).
- **Backend DPDP endpoints**:
  - `GET /api/me/data` → returns structured JSON (profile excluding password_hash, orders, reviews, favorites, loyalty, subscriptions, notifications, preferences, push_tokens with REDACTED). Marked under DPDP_2023_section_12.
  - `DELETE /api/me/data?confirm=DELETE` → anonymises orders/reviews, hard-deletes favorites/preferences/subscriptions/notifications/push_tokens/loyalty/audit_log; deletes user; writes deletion_log entry. Master_admin self-delete blocked (would lock platform).
- **Footer + Navbar links**: LandingPage footer now shows Privacy/Terms/Support. Navbar has Shield icon → /settings/data for all logged-in roles.
- **server.py refactor (phase 1)**:
  - Extracted all 35+ Pydantic models + 3 constants (CHECKLIST_FIELDS, DOC_TYPES, ONBOARDING_STATUSES) + OrderStatus enum + PushTokenRegister + RazorpayOrderCreate/Verify into new `/app/backend/models.py` (380 lines).
  - server.py: **4,184 → 3,901 lines** (-283), now imports from `models`. Pure refactor — zero behavior change.
  - Future phases (P2): extract routes into `/app/backend/routes/*.py` per feature module.
- **Test updates**: Fixed `test_iter3_features.py` + `test_iter6_vendor_upload_commission.py` to expect 403 for vendor menu CRUD/image upload (these were written before iter12 lock-down).
- **Verified**:
  - Backend: **234/234 pytest passing** ✅ (up from 201, includes new test_iter12_dpdp_menu_push.py with 32 DPDP/menu-lockdown/push tests)
  - 18-endpoint smoke test across 5 roles all 200 ✅
  - Privacy/Terms pages render properly ✅
  - DPDP export + delete + master_admin-protection verified via curl ✅

### Iteration 11: Push Notifications (Expo Push) (Feb 2026) ✅
- **Why Expo Push over FCM**: No Firebase service account JSON, no Apple Push cert, unified iOS+Android API, free unlimited delivery. Expo handles all of FCM/APNs internally.
- **Mobile** (`/app/mobile/`):
  - Installed `expo-notifications@56.0.15`, `expo-device@56.0.4`
  - `app.config.js` — added `expo-notifications` plugin with brand color + icon (variant-aware)
  - `/src/hooks/usePushNotifications.js` — new hook called from App.js. Sets module-level `setNotificationHandler` (foreground banner), creates Android HIGH-importance channel, requests permission, fetches ExpoPushToken tied to EAS projectId, POSTs to backend
  - `AuthContext.js` — after login/register, re-registers push token (handles "token fetched before login" case)
  - Tap → deep-link via `navigationRef.current.navigate(data.screen, data)` for `OrderDetail`, `Orders`, `Notifications`
  - `App.js` — wired `useRef` for `NavigationContainer` + invokes `usePushNotifications(navigationRef)`
- **Backend** (`server.py`):
  - Added `httpx` import + module-level `_push_http_client` (reusable async client)
  - `send_expo_push(messages)` — POSTs batch to `https://exp.host/--/api/v2/push/send`; filters invalid tokens; swallows errors
  - `send_push_to_user(user_id, title, body, data)` — looks up all active tokens for user → batch push
  - **`create_notification` enhanced**: every existing in-app notification call now ALSO fires a push (zero changes to existing trigger sites — new orders, status updates, refunds, low-stock, etc. all auto-push)
  - **NEW endpoints**:
    - `POST /api/notifications/push-token` — register/refresh token (validates `ExponentPushToken[...]` format)
    - `DELETE /api/notifications/push-token?token=...` — unregister on logout
    - `POST /api/notifications/test-push` — fire a test push to the calling user (for debugging)
  - New collection: `push_tokens` (user_id, token, platform, variant, active, registered_at, last_seen_at)
- **Trigger points already wired automatically** (via `create_notification`):
  - 🆕 New order → vendor users get push: "New Order Received — ₹X"
  - ✅ Vendor confirms/preparing/ready/completed → employee gets status push
  - ❌ Auto-confirm on order placement → employee gets push
  - 💰 Refund processed → employee gets push (via existing notification call)
  - ⚠️ Low stock crossing threshold → vendor users get push
- **Verified**: 400 for invalid format, 200 for valid Expo token, 200 for test push, 401 for unauth.
- **Production readiness**: Requires next EAS rebuild to activate native push module in APKs. After install, mobile auto-registers token on login; all existing notification points fire push automatically.

### Iteration 10: Vendor Menu Lock-down (Feb 2026) ✅
- **Policy**: Menus and pricing are now centrally managed by Cravitoo (master_admin). Vendors are read-only on menu items and prices, but can still toggle daily availability (out-of-stock).
- **Backend** (`server.py`):
  - `POST /api/menu` → master_admin only; requires `vendor_id` in body (validates vendor exists)
  - `PATCH /api/menu/{id}` → master_admin only; strips `vendor_id` from updates
  - `DELETE /api/menu/{id}` → master_admin only
  - `POST /api/upload/menu-image` → master_admin / site_admin only (removed vendor)
  - `PATCH /api/menu/{id}/availability` → **kept for vendor** (operational out-of-stock toggle)
  - `GET /api/menu/vendor/all` → **kept for vendor** (read-only own menu)
  - `MenuItemCreate` schema gained `vendor_id: Optional[str]`
- **Web Frontend** (`/app/frontend/src/pages/vendor/Menu.js`):
  - Removed Add / Edit / Delete UI
  - Added prominent "Menu & pricing managed by Cravitoo" banner with mailto request-change link
  - Single per-item action: In stock ↔ Out of stock toggle
- **Mobile Partner App** (`/app/mobile/src/screens/vendor/VendorMenu.js`):
  - Same treatment: read-only list, banner header, availability toggle only
  - "Request menu change" opens `mailto:partners@cravitoo.com`
- **Verified**: Vendor POST/DELETE return 403 with clear copy. Master POST/DELETE return 200. Vendor availability toggle still works.

### Iteration 9: Mobile APK Login Fix + OTA Setup (Feb 2026) ✅
- **Login fix**: `LoginScreen.js` showed a misleading "Mobile app supports Employees & Vendors" alert for `master_admin` / `site_admin` logins on the Partner APK. Made the role check variant-aware (Partner accepts vendor/master_admin/site_admin; Customer accepts employee). Network errors now show "Cannot reach the server" instead of generic failure.
- **Env**: `mobile/.env` `EXPO_PUBLIC_BACKEND_URL` switched preview → production (`https://app.cravitoo.com`).
- **OTA (Over-The-Air) Updates** via EAS Update:
  - Installed `expo-updates@56.0.17`
  - `app.config.js`: `runtimeVersion: { policy: 'appVersion' }`, per-variant `updates.url`, `expo-updates` plugin
  - `eas.json`: each build profile tagged with `channel` (preview, preview-vendor, production, production-vendor)
  - `App.js`: calls `useOTAUpdates()` on launch — checks for updates, downloads in background, reloads with new bundle
  - `/app/mobile/src/hooks/useOTAUpdates.js`: safe update-check hook (errors swallowed, never crashes app)
  - `/app/mobile/OTA_GUIDE.md`: workflow documentation (when to use OTA vs EAS build, how to publish/rollback, quota info)
- **Verified**: All 5 demo accounts authenticate via `/api/auth/login` and return correct role. Both variants resolve correct EAS Update URL.
- **One-time bootstrap rebuild required** when EAS quota resets:
  - `eas build -p android --profile production` (Customer)
  - `eas build -p android --profile production-vendor` (Partner)
  - All future JS/UI fixes ship instantly via `eas update --branch <channel>` (free up to 1k MAU)

### Iteration 8: P1 Batch — Refunds/Favorites/Subscription/Onboarding-tooling (Feb 2026) ✅
- **Backend** (22 new + 201/201 regression tests passing):
  - `PATCH /api/admin/vendors/{id}` — master edits vendor profile (name, contact, address, status, commission)
  - `GET /api/refunds` — employee sees cancelled + refunded orders with timeline
  - `GET/POST/DELETE /api/favorites[/{vendor_id}]` — favorites CRUD per employee
  - `GET /api/orders/last` — most recent order for reorder-my-usual flow
  - `POST /api/onboarding/vendors/bulk-import` — master/site/city admin uploads Excel to create N onboardings
  - `POST /api/onboarding/vendors/{id}/menu/upload-excel` — pre-load menu items as `draft_menu` (auto-ticks checklist)
  - `GET /api/meal-period/current` — public, returns current period (breakfast/lunch/snacks/dinner) by IST
  - `GET /api/reports/city-leaderboard?days=N` — master sees cities ranked by revenue, with sites/vendors/pending counts + avg checklist %
  - **Low-stock alert** trigger in `POST /api/orders` — fires on threshold-crossing (not exact equality)
  - **Fixes from test report**: `draft_menu` now included in `onboarding_to_dict`; low-stock crossing condition robust to repeated orders
- **Web Frontend**:
  - `/master/dashboard` now includes **City Performance Leaderboard** (revenue bars, medal ranks 🥇🥈🥉, pending onboardings, avg checklist %)
  - `/master/vendors` — full profile edit modal (name, description, cuisine, phone, email, address, status, commission)
  - `/onboarding` list — **Bulk Import Excel** button next to "New Onboarding"
  - `/onboarding/:id` Documents tab — **Pre-load menu via Excel** card (auto-ticks "Menu uploaded")
- **Mobile (Customer App)**:
  - New screens: **Favorites & Reorder** (heart toggle, one-tap reorder), **Refunds** (timeline view with refund status), **Meal Plans** (weekly/monthly subscription UI), **Event Catering** (bulk-order request flow)
  - Menu screen: **Meal-period banner** ("Now serving: lunch"), **favorite heart toggle** on vendor tabs
  - Order Detail: **auto-prompts review modal** when status becomes completed (5-star + optional comment)
  - Profile screen: 4 quick-access shortcut buttons to the new screens
- **Backend** (36/36 new + 143/143 regression, critical collection-name bug fixed):
  - **Cities**: `/api/cities` CRUD (master only); `GET /api/cities` role-scoped (master sees all, city_admin sees own, others see active)
  - **City Admin role**: `/api/admin/city-admins` create; appears in `/api/admin/admins` list
  - **Vendor Onboarding**:
    - `POST /api/onboarding/vendors` create (site_admin/city_admin/master scoped to their site/city)
    - `GET /api/onboarding/vendors[?status=X]` list with role filtering
    - `GET /api/onboarding/vendors/{id}` detail with checklist_pct + documents map
    - `PATCH /api/onboarding/vendors/{id}` update basic info (locked after approval)
    - `PATCH /api/onboarding/vendors/{id}/checklist` toggle 10 checklist items
    - `POST /api/onboarding/vendors/{id}/documents/{type}` upload PDF/image to 8 doc types (GST, PAN, FSSAI, etc.) — auto-flips status draft→documents_pending
    - `DELETE /api/onboarding/vendors/{id}/documents/{type}`
    - `POST /api/onboarding/vendors/{id}/site-review` — site_admin approves (→under_master_review), rejects, or requests_changes (requires ≥80% checklist)
    - `POST /api/onboarding/vendors/{id}/master-decision` — master approves (creates real vendor + site mapping → status=active) or rejects
    - `GET /api/onboarding/vendors/{id}/audit-trail` — full audit log
    - `GET /api/onboarding/dashboard` — counts by status + avg checklist pct
  - **Audit log**: persistent `audit_log` collection with user, action, entity, details, timestamp
  - **Site city_id link**: sites can now be associated to a City entity
- **Web Frontend**:
  - `/master/cities` — Cities list + create + add City Admin
  - `/onboarding` — Onboarding queue with stats (Total/Pending/Approved/Rejected/Avg Checklist), search + status filter
  - `/onboarding/new` — Wizard step 1: basic info form (vendor name, company, contact, address, site)
  - `/onboarding/:id` — Detail with 4 tabs (Overview/Documents/Checklist/Audit), document upload per type, checklist toggles, site-review actions, master-decision actions, status badges, decision-remarks modal
- **8 onboarding statuses**: draft, documents_pending, under_site_review, changes_requested, under_master_review, approved, rejected, active
- **10-item checklist**: GST verified, PAN verified, FSSAI verified, Bank verified, Menu uploaded, Pricing verified, Documents uploaded, Site visit done, Commercial terms accepted, Agreement signed
- **8 document types**: GST cert, PAN card, FSSAI license, Shop & Establishment, Bank details, Cancelled cheque, MSME (optional), Insurance (optional)
- **Backend** (103/103 tests passing, hardened authz):
  - `/api/sites/*` CRUD (master_admin / site_admin scoped)
  - `/api/sites/{id}/vendors` mapping management
  - `/api/sites/{id}/schedule` meal periods (breakfast/lunch/snacks/dinner) with time windows
  - `/api/sites/{id}/menu` site-scoped menu, `/api/menu/{id}/site-control` per-item toggles (is_available / price / show_price / meal_periods)
  - `/api/sites/{id}/menu/upload-excel` openpyxl-powered bulk upload (5 MB max, validates required columns)
  - `/api/admin/site-admins`, `/api/admin/super-admins`, `/api/admin/master-admins` (master-only; master-email constraint `@cravitoo.com`)
  - `/api/admin/admins` list/delete
  - `/api/reports/master-dashboard` platform-wide KPIs + top_sites + top_vendors (with ObjectId guard)
  - `/api/reports/site/{id}` site-scoped KPIs + per-vendor revenue
  - `/api/employee/my-site` returns site + vendors + meal_schedule + current_meal_period + ordering_modes
  - **NEW: `/api/orders/{id}/cancel`** — customer cancels within 5 min, auto-refund if paid (mock or real Razorpay)
  - **NEW: `/api/orders/{id}/refund`** — vendor/master refunds a paid order (food unavailable, no-show)
  - Validation hardening: site_id validated in admin creation, status field master-only, loyalty redeem validation order fixed
- **Web Frontend**:
  - `/master/dashboard`, `/master/sites` (list/create), `/master/sites/:id` (Vendors / Menu / Schedule / Settings tabs with Excel upload + toggles)
  - `/master/admins` — create/delete site/super/master admins
  - `/site-admin/dashboard` + reusable `/site-admin/site/:id`
  - Order cancel button on `/employee/orders` (within 5 min)
- **Mobile (Partner App)**:
  - Role routing: vendor / master_admin / site_admin auto-detected
  - 4 new screens: AdminDashboard, AdminSites, AdminAdmins, SiteManagement (4 tabs)
- **Mobile (Customer App)**:
  - **NEW: Loyalty redemption** at cart checkout — apply points (min 100) as direct discount
  - **NEW: Order cancellation** on Order Detail screen with live countdown timer
  - **NEW: Menu search + filters** — search dishes, veg/non-veg, price sort (low/high)

## API Endpoints (Comprehensive)

### Auth (returns tokens for mobile, cookies for web)
- POST /api/auth/register, /api/auth/login, /api/auth/logout, GET /api/auth/me

### Menu, Orders, Reviews, Preferences, Subscriptions - (unchanged from Iter 3)

### NEW: WebSockets
- WS /ws/orders?token=... (employee)
- WS /ws/vendor?token=... (vendor)

### NEW: Razorpay
- POST /api/payments/razorpay/create-order  → returns razorpay_order_id, amount, key_id, mock_mode flag
- POST /api/payments/razorpay/verify  → verifies signature, marks paid, broadcasts WS, notifies vendor

### AI
- POST /api/ai/recommendations (preferences-aware)
- POST /api/ai/demand-forecast (vendor)
- POST /api/ai/wastage-analysis (vendor)

### Notifications, Loyalty, Bulk Orders, Events, Employees - (unchanged from Iter 3)

## Demo Credentials

| Role | Email | Password | Mobile App | Web |
|------|-------|----------|------------|-----|
| Super Admin | admin@cravitoo.com | admin123 | ❌ | ✅ |
| Corporate Admin | demo@techcorp.com | demo123 | ❌ | ✅ |
| Vendor | vendor@spicekitchen.com | vendor123 | ✅ | ✅ |
| Employee | employee@techcorp.com | employee123 | ✅ | ✅ |

## How to Test Each Component

### Web (already deployed)
- Preview: https://corporate-feast.preview.emergentagent.com
- Production: https://corporate-feast.emergent.host

### Mobile Android APK
- Latest build URL: https://expo.dev/accounts/atmego/projects/cravitoo/builds/a653c235-4907-4d7d-af6f-a6c5c67010b9
- Install on phone, login with any role above
- Employee sees food ordering tabs, Vendor sees order management tabs

### Real-time test
1. Open mobile app as Employee → place order
2. Open mobile app on another device (or web) as Vendor
3. Vendor sees order appear instantly without refresh (WebSocket)
4. Vendor taps "Confirm" → Employee sees status change instantly

### Razorpay test (Mock mode)
1. Employee places order → Cart shows "Pay & Order"
2. Tap pay → Dialog says "Mock Payment Mode"
3. Tap "Simulate Success" → Order marked paid + confirmed
4. Real Razorpay: set `RAZORPAY_MOCK_MODE=false` and add real keys

## Production Deployment Notes

- Web: Live at corporate-feast.emergent.host
- Mobile: APK distributable; Play Store needs `eas build --profile production` + Google Play account
- iOS: Needs Apple Developer account ($99/yr) + `eas build --platform ios`
- Razorpay: Sign up at razorpay.com, replace RAZORPAY_KEY_ID/SECRET in backend/.env
- WebSocket scaling: Currently in-memory ConnectionManager; for multi-instance deployment, use Redis pub/sub

## Prioritized Backlog (Remaining)

### P0
- [ ] Firebase Cloud Messaging (replace polling notifications)
- [ ] OTP login (email or SMS)
- [ ] iOS APK build & TestFlight setup
- [ ] Real Razorpay keys (when user provides)

### P1
- [ ] Loyalty redemption UI at checkout
- [ ] Refund/cancellation flow
- [ ] WhatsApp/SMS alerts (Twilio integration)
- [ ] Image upload for menu items (S3/object storage)

### P2
- [ ] Offline mode (cached menu, orders)
- [ ] Multi-language (i18n)
- [ ] Dark mode
- [ ] Redis pub/sub for WebSocket horizontal scaling
- [ ] Server.py refactor into routers/services

## Known Limitations
- WebSocket in-memory store: doesn't survive backend restart (clients auto-reconnect in 5s)
- Razorpay in MOCK mode by default — user needs to add real keys for production
- Mobile real Razorpay SDK only works in built APK, not Expo Go (uses mock dialog there)
- AI endpoints have no rate limiting
- Notifications collection grows unbounded
