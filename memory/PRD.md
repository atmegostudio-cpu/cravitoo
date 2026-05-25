# Cravitoo - Product Requirements Document

## Original Problem Statement
Build a production-ready, scalable, enterprise-grade full-stack food-tech application called Cravitoo for India. Smart corporate food ordering and cafeteria management ecosystem for corporate offices, IT parks, educational institutions, hospitals, event organizers. Combines GoKhana, Swiggy Minis, Zomato for Business with Apple-style clean UI and Stripe-inspired premium dashboards. Must be responsive, market-ready, scalable, secure, cloud-deployable.

## Architecture

### Tech Stack
- **Backend**: FastAPI + MongoDB + JWT Auth
- **Frontend**: React + Tailwind CSS + Shadcn UI
- **AI**: OpenAI GPT-5.2 (via Emergent LLM key)
- **Payments**: Stripe Checkout (test mode)
- **Auth**: JWT (httpOnly cookies) + bcrypt + brute-force lockout

### Color Palette
- Primary Orange: #FF5A1F
- Accent Yellow: #FACC15
- Background: #F9FAFB
- Dark sections: #111827

### Fonts
- Headings: Outfit
- Body: Work Sans

## User Personas

1. **Employee**: Browses menus, orders meals, manages subscriptions/preferences
2. **Vendor**: Manages menu, accepts orders, tracks revenue
3. **Corporate Admin**: Manages company employees and spending
4. **Super Admin**: Manages all companies and vendors on platform

## Implemented Features (May 2026)

### Authentication & Security
- JWT auth with httpOnly cookies (secure flag for HTTPS)
- 4-role RBAC (employee, vendor, corporate_admin, super_admin)
- Brute-force lockout (5 attempts → 15 min lockout, IP+email tracking)
- Bcrypt password hashing
- Safe ObjectId validation (returns 404 not 500)

### Employee App
- Landing page with premium hero
- Dashboard with stats, vendors, AI recommendations
- Menu browsing with cart (multi-quantity)
- Stripe checkout with INR currency
- Orders page with payment status polling
- QR code pickup verification (display)
- Reviews/ratings (5-star + comment)
- Meal subscriptions (Basic/Standard/Premium plans)
- Dietary preferences, allergies, favorite cuisines

### Vendor App
- Dashboard with revenue analytics
- Order management (status transitions via enum)
- Pickup QR verification page
- Menu management (placeholder)

### Corporate Admin
- Dashboard with company-wide analytics
- Total orders & spend tracking

### Super Admin
- Dashboard with companies & vendors
- Platform-wide visibility

### AI Features
- GPT-5.2 powered meal recommendations
- Personalized based on user preferences (cuisines, dietary, allergies)
- Session-based chat history per user

### Payments
- Stripe Checkout integration
- Server-side price validation (no client tampering)
- Payment status polling with user-scoped authorization
- Transaction records in MongoDB

## API Endpoints

### Auth
- POST /api/auth/register
- POST /api/auth/login (with brute-force lockout)
- POST /api/auth/logout
- GET /api/auth/me

### Vendors & Menu
- GET /api/vendors
- GET /api/vendors/{id}
- POST /api/vendors (super_admin/corporate_admin only)
- GET /api/menu/{vendor_id}
- POST /api/menu (vendor only)
- PATCH /api/menu/{item_id}

### Orders
- POST /api/orders (employee only, server-side price validation, generates QR)
- GET /api/orders (role-scoped)
- PATCH /api/orders/{id} (vendor only, enum status)
- POST /api/orders/{id}/verify-pickup (vendor only)

### Payments
- POST /api/payments/checkout (Stripe session)
- GET /api/payments/status/{session_id} (owner-scoped)
- POST /api/webhook/stripe

### AI
- POST /api/ai/recommendations (preferences-aware)

### Reviews & Preferences & Subscriptions
- POST /api/reviews
- GET /api/reviews/vendor/{id}
- GET /api/preferences
- POST /api/preferences
- POST /api/subscriptions
- GET /api/subscriptions

### Analytics
- GET /api/analytics/vendor
- GET /api/analytics/corporate

### Companies
- GET /api/companies
- POST /api/companies (super_admin only)

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@cravitoo.com | admin123 |
| Corporate Admin | demo@techcorp.com | demo123 |
| Vendor | vendor@spicekitchen.com | vendor123 |
| Employee | employee@techcorp.com | employee123 |

## Test Results
- Iteration 1: 15/15 backend tests passed, employee dashboard frontend verified
- Iteration 2: 28/28 backend tests passed, all new pages (Preferences, Subscriptions, QR, Reviews, VerifyPickup) verified end-to-end

## Prioritized Backlog

### P0 (Critical for production)
- [ ] React Native mobile app (Expo)
- [ ] Razorpay/UPI integration for India market
- [ ] OTP login (mobile/email)
- [ ] Real-time order tracking with WebSockets

### P1 (High value features)
- [ ] Corporate Admin: Employee management UI (add/remove/department)
- [ ] Vendor: Full menu CRUD UI with image upload
- [ ] Bulk team ordering
- [ ] Event catering module
- [ ] Pantry automation
- [ ] Push notifications (Firebase)
- [ ] WhatsApp + SMS notifications

### P2 (Polish & enhancement)
- [ ] Demand forecasting AI
- [ ] Food wastage analytics
- [ ] Vendor performance scoring
- [ ] Heatmaps for peak cafeteria timing
- [ ] Multi-vendor cart support
- [ ] Refund/cancellation flow
- [ ] Loyalty/referral system

## Known Minor Issues
- Stripe payment flow tested only to URL generation (test mode)
- Brute force lockout doesn't auto-expire records (cleared on next attempt after window)
- Mobile responsive design needs deeper testing
