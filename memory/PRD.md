# Cravitoo - Product Requirements Document

## Original Problem Statement
Build a production-ready, scalable, enterprise-grade full-stack food-tech application called Cravitoo for India. Smart corporate food ordering and cafeteria management ecosystem for corporate offices, IT parks, educational institutions, hospitals, event organizers. Combines GoKhana, Swiggy Minis, Zomato for Business with Apple-style clean UI and Stripe-inspired premium dashboards.

## Architecture

### Tech Stack
- **Backend**: FastAPI + MongoDB + JWT Auth + emergentintegrations library
- **Frontend**: React + Tailwind CSS + Shadcn UI + lucide-react icons
- **AI**: OpenAI GPT-5.2 (via Emergent LLM key) - meal recommendations, demand forecast, wastage analysis
- **Payments**: Stripe Checkout (INR, test mode)
- **Auth**: JWT (httpOnly cookies) + bcrypt + brute-force lockout

### Design System
- Primary Orange: #FF5A1F, Accent Yellow: #FACC15
- Background: #F9FAFB, Dark sections: #111827
- Fonts: Outfit (headings), Work Sans (body)
- Glassmorphism navbar, Bento Grid dashboards

## User Personas
1. **Employee**: Browse menus, order meals, manage subscriptions/preferences, redeem loyalty points
2. **Vendor**: Manage menu (CRUD), accept orders, view AI insights, verify pickup
3. **Corporate Admin**: Manage employees, approve events, view analytics
4. **Super Admin**: Manage all companies and vendors

## Implemented Features

### Iteration 1: Core MVP (May 2026)
- Multi-role JWT auth, registration, role-based routing
- Employee menu browsing, ordering, Stripe checkout
- Vendor dashboard with analytics
- Corporate admin dashboard
- Super admin dashboard
- AI food recommendations (GPT-5.2)

### Iteration 2: Security + Engagement Features
- Brute-force lockout (5 attempts → 15 min lockout, IP+email tracking)
- Secure cookies (HTTPS-aware), Order status enum
- Server-side price validation, Payment status owner-scoping
- Safe ObjectId validation (404 vs 500)
- QR Pickup verification (display + verify)
- Meal Subscriptions (Basic ₹3000, Standard ₹5500, Premium ₹7500)
- Reviews & Ratings (5-star + comment, auto-update vendor rating)
- Employee Preferences (dietary, allergies, favorite cuisines)

### Iteration 3: P1 + P2 Features
**P1 - Operations:**
- Vendor Menu CRUD (Add/Edit/Delete with image upload, availability toggle)
- Employee Management (Corp Admin can add/remove/group by department)
- Bulk Team Ordering (multi-user orders, sponsored=auto-paid+confirmed)
- Event Catering (custom menus with headcount, approval workflow)
- In-app Notifications (Bell with badge, auto-create on order events)

**P2 - Advanced:**
- AI Demand Forecasting (GPT-5.2 + order aggregations)
- AI Food Wastage Analysis (cancellation metrics + suggestions)
- Multi-vendor Cart (cart persists in localStorage, grouped by vendor)
- Loyalty System (Starter/Bronze/Silver/Gold tiers, 1 point per ₹100, redeemable as discount)

## API Endpoints

### Auth
- POST /api/auth/register, /api/auth/login, /api/auth/logout, GET /api/auth/me

### Menu
- GET /api/menu/{vendor_id} (public), GET /api/menu/vendor/all (vendor)
- POST /api/menu, PATCH /api/menu/{id}, DELETE /api/menu/{id}

### Orders
- POST /api/orders, GET /api/orders, PATCH /api/orders/{id} (enum)
- POST /api/orders/bulk (sponsored option, skipped report)
- POST /api/orders/{id}/verify-pickup

### Payments
- POST /api/payments/checkout, GET /api/payments/status/{id}, POST /api/webhook/stripe

### AI
- POST /api/ai/recommendations (preferences-aware)
- POST /api/ai/demand-forecast (vendor)
- POST /api/ai/wastage-analysis (vendor)

### Reviews / Preferences / Subscriptions
- POST /api/reviews, GET /api/reviews/vendor/{id}
- GET /api/preferences, POST /api/preferences
- POST /api/subscriptions, GET /api/subscriptions

### Employee Management
- POST /api/companies/employees, GET /api/companies/employees, DELETE /api/companies/employees/{id}

### Events
- POST /api/events, GET /api/events, PATCH /api/events/{id}/approve (with ownership scoping)

### Notifications
- GET /api/notifications, PATCH /api/notifications/{id}/read, POST /api/notifications/mark-all-read

### Loyalty
- GET /api/loyalty, POST /api/loyalty/redeem (applies discount to unpaid order)

### Analytics
- GET /api/analytics/vendor, GET /api/analytics/corporate

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@cravitoo.com | admin123 |
| Corporate Admin | demo@techcorp.com | demo123 |
| Vendor | vendor@spicekitchen.com | vendor123 |
| Employee | employee@techcorp.com | employee123 |

## Test Results
- Iteration 1: 15/15 backend tests passed
- Iteration 2: 28/28 backend tests passed
- Iteration 3: 43/43 backend tests passed (15 new + 28 regression)
- All frontend pages verified end-to-end via Playwright

## Mobile App (Iteration 4 - React Native + Expo)

Built a native iOS/Android mobile app at `/app/mobile/` using Expo SDK 52:

**Screens** (Employee role only):
- Login & Register (with secure token storage via expo-secure-store)
- Home (AI recommendations, vendor list, notifications bell)
- Menu (vendor tabs, multi-vendor cart)
- Cart (quantity controls, place order)
- Orders (list with status badges)
- Order Detail (with QR code for pickup)
- Loyalty (tier card, points, stats)
- Notifications (in-app, polled)
- Profile (sign out)

**Tech**: React Native 0.76, React Navigation 7 (Stack + Tabs), Axios, expo-secure-store, expo-linear-gradient, @expo/vector-icons

**Backend update**: `/api/auth/login` and `/api/auth/register` now return `access_token` + `refresh_token` in response body (mobile uses Bearer auth). Web continues to use httpOnly cookies.

**How to test**:
1. Install Expo Go on phone (iOS App Store / Google Play)
2. Run `cd /app/mobile && yarn start`
3. Scan QR with Camera (iOS) or Expo Go (Android)
4. Login: `employee@techcorp.com` / `employee123`

**Build for stores**: `eas build --platform android|ios` (requires Expo account + Apple Developer / Google Play account)

## Prioritized Backlog (Remaining)

### P0 (Critical for production)
- [ ] React Native mobile app (Expo)
- [ ] Razorpay/UPI integration (replaces Stripe for India)
- [ ] OTP login (mobile/email)
- [ ] Real-time order tracking with WebSockets
- [ ] Refactor server.py (1450+ lines) into routers/services

### P1 (High value enhancements)
- [ ] Loyalty point usage at checkout UI (backend works, needs UI)
- [ ] Image upload for menu items (S3/object storage)
- [ ] Vendor inventory tracking
- [ ] Push notifications via Firebase FCM
- [ ] WhatsApp/SMS alerts via Twilio
- [ ] Email notifications via SendGrid/Resend

### P2 (Nice-to-have)
- [ ] Vendor performance scoring AI
- [ ] Heatmaps for peak cafeteria timing
- [ ] AI-powered dynamic pricing
- [ ] Multi-language support
- [ ] Refund/cancellation flow
- [ ] Bulk order CSV export

## Known Minor Issues
- Stripe checkout tested only to URL generation (test mode)
- Loyalty UI doesn't yet apply redemption at checkout time
- server.py is monolithic (~1450 lines) - should be split into routers
- AI endpoints have no rate limiting
- Notifications collection has no TTL (grows unbounded)
