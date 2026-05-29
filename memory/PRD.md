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

### Iteration 7: Vendor Onboarding & Approval Workflow (CURRENT — Feb 2026) ✅
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
