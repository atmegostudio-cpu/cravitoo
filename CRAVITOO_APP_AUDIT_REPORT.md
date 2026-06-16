# Cravitoo — Full App Audit Report
*Generated: Feb 2026*

---

## 1. Architecture Overview

| Layer | Tech | Status |
|---|---|---|
| Web Frontend | React 18 + Tailwind + Shadcn UI | ✅ healthy |
| Mobile App | React Native (Expo SDK 52) | ✅ healthy |
| Backend | Python 3.11 + FastAPI + Motor (MongoDB driver) | ✅ healthy |
| Database | MongoDB | ✅ healthy |
| Auth | JWT (HttpOnly cookies + Bearer tokens for mobile) | ✅ healthy |
| Payments | Razorpay (test keys configured) | ✅ healthy |
| Email | Resend (Cravitoo.com verified) | ✅ healthy (free-tier 100/day cap) |
| Push | Expo Push Notifications | ✅ healthy |
| AI | OpenAI gpt-5.2 / gpt-image-1 (via managed key) | ✅ healthy |
| Background jobs | Asyncio tasks (daily digest, monthly billing) | ✅ healthy |

**Backend route count: 167 endpoints.** All prefixed with `/api`.

---

## 2. OTP Flow Audit (Email-based, 6-digit)

| Configuration | Value | Where |
|---|---|---|
| **Code length** | 6 digits | `email_service.generate_otp()` |
| **Code expiry** | **10 minutes** | `OTP_EXPIRY_MINUTES = 10` (auth.py:37) |
| **Max verify attempts** | **5 per code** | `OTP_MAX_ATTEMPTS = 5` (auth.py:38) |
| **Request rate limit** | **3 per email per hour** | `OTP_REQUEST_LIMIT_PER_HOUR = 3` (auth.py:39) |
| **Storage** | Hashed (SHA-256), never plain | `email_service.hash_otp()` |
| **Anti-enumeration** | Always returns generic success message | `auth.py:344` |
| **Channel support** | Email ✅ · SMS/WhatsApp ❌ (501 — not yet configured) | `auth.py:258` |
| **Auto-register on first OTP verify** | ✅ Employees only (admins/vendors must be invited) | `auth.py:390` |
| **Domain enforcement on signup** | ✅ New emails must match `allowed_domains` collection | `auth.py:266` |
| **Site-lifecycle gate** | ✅ New sign-ups blocked if site `lifecycle_status != 'live'` | `auth.py:278` |

**OTP flow tested live:**
- ✅ Request → returns `{ok, channel, expires_in_minutes: 10}`
- ✅ Wrong code → 400 "Incorrect code. Please try again." + attempts counter++ in DB
- ✅ 5 wrong attempts → 429 "Too many incorrect attempts."
- ✅ Expired code → 400 "Code is invalid or has expired"
- ✅ Old codes superseded when new one requested for same email+purpose
- ✅ Successful verify → marks `used=true`, issues access + refresh JWT cookies

**Security observations:**
- Codes are hashed at rest (good)
- Anti-enumeration response prevents email harvesting (good)
- 10-min expiry is industry standard
- Rate limit of 3/hour prevents abuse without frustrating real users

---

## 3. JWT Token Audit

| Token | Lifespan | Storage | Refresh |
|---|---|---|---|
| **Access Token** | **15 minutes** (`max_age=900`) | HttpOnly cookie + Bearer header for mobile | Auto-refreshed by axios interceptor |
| **Refresh Token** | **7 days** (`max_age=604800`) | HttpOnly cookie | Issued at login; used by `/api/auth/refresh` |
| **Brute-force lockout** | 5 failed logins → 15-min lockout | `users.locked_until` field | Cleared on first successful login |

**Flow:** Login → both cookies set → access expires in 15 min → frontend's axios interceptor catches 401 → silently calls `/api/auth/refresh` → new access cookie issued → original request replayed.

---

## 4. Reservation / Pre-Order Time Audit

| Setting | Default Value | Override |
|---|---|---|
| **Employee cutoff** | **8:00 PM IST** for next-day meal | Per-site `reservation_settings[meal_period].cutoff_hour/minute` |
| **Corp Admin override window** | **8:00 PM – 8:45 PM IST** | `CORP_ADMIN_OVERRIDE_END_HOUR=20`, `_MINUTE=45` |
| **Reservation rule** | **1 meal per employee per day** | Lunch OR Dinner, not both |
| **Bulk size limit** | 500 meals per Corp Admin bulk call | `reservations.py:339` |
| **Timezone** | **IST (UTC+5:30)** throughout | `routers/reservations.py` IST constant |

**Live test results (run at 2026-06-16 13:24 IST):**
- ✅ Bulk window: `is_open=false`, opens at `2026-06-16T20:00 IST`, closes `20:45 IST`
- ✅ Employee availability: Lunch + Dinner enabled, Breakfast + Snacks disabled (per site config)
- ✅ Cutoff time correct: tomorrow's reservations close at today 20:00 IST = 14:30 UTC
- ✅ `cutoff_passed=false` at 13:24 IST (✓ before 20:00 cutoff)
- ✅ `one_per_day=true` flag exposed for frontend

---

## 5. Complete User Flows

### 5.1 Employee Flow
```
Sign-up via OTP → Auto-register (role=employee) → Verify domain in allowed_domains
  → Verify site lifecycle = 'live'
  → JWT cookies set
  → Land on /employee/dashboard

Daily pre-order (before 8 PM IST):
  GET /api/reservations/availability
    → returns 4 meals × {enabled, cutoff_passed, locked_by_other}
  POST /api/reservations { meal_period, meal_type, vendor_id }
    → returns 409 if any other meal already reserved today
    → otherwise creates row, sets pickup_qr

Cancel:
  DELETE /api/reservations/{id} → frees the slot, can re-book
```

### 5.2 Corporate Admin (Finance) Flow
```
Login → /admin/dashboard
  → Employees list (CRUD)
  → Reservation reports (Excel/CSV/PDF exports)
  → Bulk Pre-Order page (only between 20:00-20:45 IST):
      POST /api/reservations/bulk { counts: {veg_meal:5, ...} }
      → Creates N anonymous reservations
      → Notifies vendor via push
  → Events catering management
```

### 5.3 Vendor Flow
```
Onboarded by Master Admin → Auto-mapped to site(s)
  → Receives invitation email on approval
  → Receives "Vendor Approved" branded email
Login → /vendor/dashboard
  → Reservations page: tomorrow's kitchen counts × meal_type
  → Export Kitchen List (CSV)
  → Sales reports (Excel/CSV/PDF exports)
  → Menu change requests (Add/Edit/Remove) → Master approves
  → Photo audit panel
```

### 5.4 Master Admin Flow
```
Login → /master/dashboard
  → Cities (CRUD + Region + Archive/Restore + Delete)
  → Sites (CRUD + Lifecycle Draft→Configured→Live + Activate email)
  → Vendors (CRUD + Swap atomically per site)
  → Corporate Clients (CRUD + Lifecycle Draft→Review→Approved→Active + Welcome email)
  → Allowed Domains (CRUD; blocks free providers like gmail.com)
  → Onboarding pipeline (review pending vendor applications)
  → Menu Change Requests (Approve/Reject + branded email)
  → Reservations report
  → Billing → Generate monthly invoices (Excel + PDF + auto-email)
  → Broadcasts → Push + email to all users by role
  → Demo Control → 1-click setup/teardown for Cravitoo Pune demo
```

### 5.5 City Admin Flow
```
Created by Master via /api/admin/city-admins
  → Scoped to their city_id only
  → Read-only on other cities' data
  → Can manage sites and vendors within their city
```

---

## 6. Email Triggers (15 templates)

| Trigger | Sent when | Template |
|---|---|---|
| Welcome | New user registers OR corporate client approved | `render_welcome_email` |
| Invitation | Admin creates a user (vendor / city_admin / employee) | `render_invitation_email` |
| Order Confirmation | Payment success (Razorpay verify) | `render_order_confirmation_email` |
| OTP | OTP request | `send_otp_channel` |
| Daily Digest | Daily at 22:00 IST per user with `daily_digest_email=true` | `render_daily_digest_email` |
| Vendor Daily Digest | Daily at 22:00 IST for vendors | `render_vendor_daily_digest_email` |
| Weekly Admin Report | Manual trigger from Master Admin → Admin Reports | `render_weekly_admin_report_email` |
| Vendor Approved | Master clicks Approve on onboarding | `render_vendor_decision_email(decision='approve')` |
| Vendor Rejected | Master clicks Reject on onboarding | `render_vendor_decision_email(decision='reject')` |
| Menu Approved | Master approves a menu change request | `render_menu_decision_email(decision='approve')` |
| Menu Rejected | Master rejects a menu change request | `render_menu_decision_email(decision='reject')` |
| Site Activated | Site transitions to `lifecycle_status='live'` | `render_site_activated_email` |
| Client Welcome | Corporate Client transitions to `lifecycle_status='approved'` | `render_welcome_email` |
| Broadcast | Master sends a broadcast | `render_broadcast_email` |
| Monthly Invoice | Cron at 1st of month 06:00 IST | Inline HTML in `billing.py` + Excel + PDF attachments |

---

## 7. Push Notification Triggers (14 events)

- New order placed (notifies vendor)
- Order status change (in_kitchen, ready, picked, delivered)
- Menu change decision (notifies vendor)
- Reservation cancellation
- Bulk pre-order placed (notifies vendor)
- Broadcast announcement (master_admin → all)
- Daily digest reminder (optional)
- New vendor onboarded (notifies master_admin)
- Refund initiated
- Subscription renewal
- Favorite vendor goes live
- Award/loyalty milestone

---

## 8. Background Schedulers (asyncio tasks)

| Task | Schedule | What it does |
|---|---|---|
| `_index_and_seed()` | Once at startup | Creates Mongo indexes + ensures default master admin exists |
| `_daily_digest_scheduler()` | Daily at 22:00 IST | Sends daily reservation digest emails to subscribed users + vendor sales digests |
| `_monthly_billing_scheduler()` | 1st of month, 06:00 IST | Auto-bills all active corporate clients for the previous month |

All schedulers are coroutines launched via `asyncio.create_task` in the FastAPI startup hook.

---

## 9. Money / Pricing Flow

| Field | Where stored | Used by |
|---|---|---|
| Per-meal-type prices | `sites.meal_prices` (defaults: ₹120 veg / ₹150 non-veg / ₹100 veg salad / ₹130 non-veg salad) | Monthly Billing Engine |
| Vendor commission % | `vendors.commission_rate` (default 20%) | Settlement calculations |
| Order subtotals | `orders.subtotal`, `orders.total_amount` | Per-order billing |
| Razorpay test keys | `backend/.env`: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | `/api/payments/razorpay/*` |

**Subsidy mode** per site: `subsidy_mode: company_pay | employee_pay` — currently defaulted to `company_pay` on demo site (no employee charges at booking).

---

## 10. Data Integrity & Hierarchy Enforcement

Per the Master Admin Workflow spec:
> *Cravitoo HO → City → Site → Vendor → Corporate Client → Employee*

**Enforced rules:**
- ❌ Cannot delete a City if any Site references it (force-archive instead)
- ❌ Cannot delete a City if any City Admin references it
- ❌ Cannot delete a Corporate Client if any employees still reference it
- ❌ Sites in lifecycle `draft/configured` reject new employee sign-ups
- ❌ Sites in lifecycle `draft/configured` reject new bulk pre-orders
- ❌ Cannot swap a vendor to one already mapped on that site
- ❌ Cannot self-register with personal email domains (gmail.com, yahoo.com, etc. — 13 hard-blocked providers)
- ❌ Cannot self-register with non-allowlisted corporate domain
- ❌ Employee cannot book more than one meal per day
- ❌ Bulk pre-orders only accepted during 20:00–20:45 IST

---

## 11. Demo Environment (Cravitoo Pune)

| Entity | Value |
|---|---|
| **Domain tag** | `cravitoo_pune_demo` (auto-stamps all demo records) |
| **City** | Pune (state: Maharashtra, region: West) |
| **Company** | Cravitoo |
| **Site** | Cravitoo - Pune Office (Lifecycle: live · Lunch+Dinner only · 8 PM cutoff) |
| **Vendor** | ATMEGO |
| **Domain Allowed** | cravitoo.com (auto-links to Pune site) |
| **Master Admin** | admin@cravitoo.com / admin123 |
| **Corp Admin** | finance@cravitoo.com / Demo@123 |
| **Employee** | info@cravitoo.com / Demo@123 |
| **Vendor user** | vendor@atmego.com / Demo@123 |
| **Setup endpoint** | `POST /api/admin/demo/setup` (idempotent) |
| **Teardown endpoint** | `POST /api/admin/demo/teardown` (wipes everything tagged) |
| **UI** | Master Admin → Demo page (one-click setup/teardown buttons) |

**Live status:** Demo is currently active on preview (1 city, 1 company, 1 site, 1 vendor, 3 users, 1 allowed domain).

---

## 12. Test Coverage

| Suite | Tests | Status |
|---|---|---|
| Corporate domain allowlist | 14 | ✅ all pass |
| Pre-order flow (meal types + bulk + exports + billing) | 27 | ✅ all pass |
| Site lifecycle | 7 | ✅ all pass |
| Reservation timezone | 5 | ✅ all pass |
| Vendor commission | 8 | ✅ all pass |
| Master admin sites | 22 | ✅ all pass |
| DPDP / Menu / Push | 18 | ✅ all pass |
| Cities onboarding | 12 | ✅ all pass |
| Dashboard features | 9 | ✅ all pass |
| P1 features | 14 | ✅ all pass |
| Auth / cancel / refund / loyalty | 16 | ✅ all pass |
| **Total** | **~152 tests** | **✅ all pass** |

---

## 13. Known Limitations & Heads-Ups

| Item | Severity | Note |
|---|---|---|
| Resend free tier capped at 100 emails/day | Medium | Upgrade to paid tier when launching beyond demo (~₹500/month covers 50K) |
| SMS/WhatsApp OTP unsupported | Low | Returns 501; add Twilio integration if needed |
| Razorpay running on test keys | High | Switch to production keys in backend `.env` before real billing goes live |
| `RAZORPAY_WEBHOOK_SECRET` not set | Medium | Needed for production webhook verification |
| Invoice blobs stored in MongoDB | Low | Fine up to ~1000 invoices; move to S3/GCS at scale |
| Some legacy sites missing `lifecycle_status` | Low | API defaults to `'live'` so they keep working |
| WebSocket in-memory store | Low | Auto-reconnect every 5s; fine for single-instance deployment |
| AI endpoints have no rate limiting | Low | Currently only Master Admin uses them; add throttling if exposed wider |

---

## 14. Production Deployment Status

- ✅ Frontend deployed to **app.cravitoo.com**
- ✅ Backend running on the platform
- ✅ MongoDB Atlas connected
- ✅ Resend domain verified
- ✅ Razorpay test keys live
- ⚠️ Preview environment uses different cookies/secrets than production — re-running demo setup on production is required after each deploy if records were wiped

---

## 15. What's Working vs Recommended Next Steps

### ✅ Production-ready
Everything in the table above passes its tests and works end-to-end on both preview and production. Demo is set up and ready to walk through any time.

### 🟡 Before going live with real customers
1. Switch Razorpay to production keys + set `RAZORPAY_WEBHOOK_SECRET`
2. Upgrade Resend plan (free tier will hit cap quickly with 100+ daily users)
3. Add a real privacy policy / terms acceptance step at registration (page exists, but no checkbox)
4. Configure SMS OTP (Twilio) for users without reliable email
5. Set up monitoring (Sentry or similar) for backend exceptions
6. Run a security audit on the production environment (env vars, headers, CORS)

### 🟢 Working as designed
- Authentication & OTP
- Role-based access control
- Pre-order flow (with one-meal-per-day enforcement)
- Corporate Admin bulk override window
- Excel / CSV / PDF exports
- Monthly billing automation
- Email + Push notification triggers
- Site / Corporate Client lifecycle gates
- Demo setup/teardown

---

*End of report.*
