# Cravitoo - Product Requirements Document

## Original Problem Statement
Build a production-ready, scalable, enterprise-grade full-stack food-tech application called Cravitoo for India - smart corporate food ordering and cafeteria management ecosystem.

## Master Prompt PDF Gap Analysis (Feb 2026)

User uploaded the Cravitoo Master Prompt PDF. Compared against existing app, identified **8 gap items**. Plan agreed with user is to ship in 5 steps:

| Step | Items | Status |
|------|-------|--------|
| **1** | #1 Corporate domain restriction + #4 Email triggers (vendor/menu/site activation) + #7 Site lifecycle | ✅ **DONE (iter23, Feb 2026)** |
| 2 | #2 Fixed pre-order meal types + #3 Corporate Admin 8:00–8:45 PM bulk override | ⏳ Next |
| 3 | #5 Excel/CSV/PDF export buttons across all reports | ⏳ |
| 4 | #6 Corporate Client lifecycle (Draft → Review → Approved → Active) | ⏳ |
| 5 | #8 Monthly Billing Engine (Excel + PDF + auto-email) | ⏳ |

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

## Prioritized Backlog (Remaining PDF Gap Items)

### Step 2 — P1 Pre-order parity
- [ ] **#2 Fixed pre-order meal types** — replace free-form vendor menu picker with 4 fixed options (Veg Meal / Non-Veg Meal / Veg Salad / Non-Veg Salad)
- [ ] **#3 Corporate Admin override** 20:00–20:45 IST bulk pre-order window + bulk-order UI

### Step 3 — P2 Exports
- [ ] **#5 Excel / CSV / PDF export** buttons on all admin/master/vendor report dashboards

### Step 4 — P2 Corporate Client lifecycle
- [ ] **#6 Corporate Client** entity with Draft → Review → Approved → Active flow + auto Welcome Email

### Step 5 — P3 Billing
- [ ] **#8 Monthly Billing Engine** — APScheduler cron + per-corporate-client Excel + PDF invoice + auto email

### Other
- [ ] Set `RAZORPAY_WEBHOOK_SECRET` in production env (user action)
- [ ] iOS App Store TestFlight submission
- [ ] FCM/APNs setup (already wired via Expo Push)

## Known Limitations
- WebSocket in-memory store (auto-reconnect in 5s)
- Resend free-tier (100 emails/day) — monitor; upgrade plan when scaling
- AI endpoints have no rate limiting yet
- Some legacy sites in DB don't have `lifecycle_status` field — API treats missing as 'live' for safety


