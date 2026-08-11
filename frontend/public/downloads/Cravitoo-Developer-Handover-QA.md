# Cravitoo · Developer Onboarding Pack

*Two Q&A documents to prepare for your meeting with an external software developer.*

---

# 📄 Part 1 — What YOU (the founder) will present to the developer

*Print this and hand it over at the start of the meeting. It answers every technical question a developer needs to onboard on Cravitoo.*

### 1. What is Cravitoo?

A production-ready corporate food-ordering platform for India. Employees at partner companies browse menus, place orders (pre-order or cash-and-carry), and pay via Razorpay. Partner vendors receive orders on their Vendor app. Master, City and Site admins manage the full ecosystem. Three clients (web + Customer mobile + Partner mobile) all talk to the same backend and database.

### 2. What is the tech stack?

- **Web frontend:** React 19, React Router, TailwindCSS, Shadcn UI, Axios, lucide-react icons.
- **Mobile:** React Native + Expo (EAS Build). Two variants: **Customer** and **Partner**, both from the same repo (`APP_VARIANT` env).
- **Backend:** FastAPI (Python 3.11), Motor (async MongoDB driver), JWT auth (access 15 min + refresh 365 days), bcrypt, Pydantic v2.
- **Database:** MongoDB Atlas (managed by Emergent).
- **Third-party integrations:** Resend (emails — paid tier, `noreply@cravitoo.com`), Razorpay (payments), OpenAI GPT via the Emergent LLM key (AI recommendations), Expo Push Notifications, Google Maps (planned).
- **Hosting:** Emergent Platform. Preview = `corporate-feast.preview.emergentagent.com`. Production = `corporate-feast.emergent.host` mapped to `app.cravitoo.com`.

### 3. How is the code organised?

```
/app
├── backend/           FastAPI app
│   ├── server.py      main app + core endpoints
│   ├── routers/       auth, sites, onboarding, reset, corporate_clients,
│   │                  allowed_domains, billing, reservations
│   ├── models.py      Pydantic + Mongo schemas
│   ├── email_service.py  Resend wrapper
│   └── tests/         pytest regression suite
├── frontend/          React web app
│   ├── src/pages/     employee, master, corporate, vendor, onboarding
│   ├── src/components/ Navbar, Sidebar, NotificationBell, ProtectedRoute
│   └── src/context/   AuthContext
└── mobile/            React Native (Expo) — Customer + Partner variants
    ├── src/screens/   employee, vendor, admin, auth
    ├── src/api/client.js  axios + 401 auto-refresh interceptor
    └── eas.json       production & production-vendor build profiles
```

### 4. What roles / user types exist?

- `master_admin` — full platform control (only one)
- `super_admin` — helps master
- `city_admin` — manages one city
- `site_admin` — manages one corporate office site
- `corporate_admin` — company HR / operations lead
- `vendor` — restaurant partner
- `employee` — end user placing orders

### 5. What are the biggest modules?

- **Vendor Onboarding** — documents, checklist, site review, master approval, menu upload (auto-materialises to `menu_items` on approval)
- **Menu & Ordering** — browse, cart, Razorpay checkout, order status
- **Meal Plans / Subscriptions**
- **Meal Schedules & Pre-orders**
- **Corporate Clients + Sites + Allowed Domains** — employee email gate
- **Monthly Billing Engine**
- **Notifications** — email + push
- **Reset-to-Blank** — client handover clean slate

### 6. What is the deployment / CI flow?

- Emergent hosts both preview and production. "Save to GitHub" pushes to the repo; "Re-publish" deploys.
- Mobile is built via **EAS** locally (`eas build --profile production`) then submitted to Play Store + TestFlight. JS-only mobile fixes can hot-ship via `eas update --branch production`.

### 7. Known open issues / recent bug fixes

- ✅ Master admin password reset-on-restart bug (fixed via `seed_admin` no-longer-touches-password)
- ✅ Session persistence — refresh tokens now 365 days, 401 auto-refresh interceptor in mobile
- ✅ Cascade delete on Sites / Vendors / Corporate Clients (prevents orphans)
- ✅ Demo-data seeding permanently disabled
- ⏳ Play Store rollout of the new mobile builds (needs redeploy from `eas.json` with production URL)
- ⏳ Some employee flows (Orders, Meal Plans, Preferences) not yet fully responsive on mobile web

### 8. What tests exist?

- `pytest /app/backend/tests/` — regression suites for session persistence, seed_admin, onboarding menu, vendor commission, reservation timezone.
- `/app/test_reports/iteration_*.json` — Playwright + backend contract reports from the automated testing agent.
- ESLint config for the frontend.

### 9. What are the API contracts?

- All backend routes are prefixed **`/api`** and routed by Emergent's ingress to port 8001.
- Auth: JWT (access 15 min + refresh 365 days), delivered as cookies (web) or `Authorization: Bearer` (mobile).
- Full route list: `GET /api/health`, `POST /api/auth/*`, `/api/sites`, `/api/vendors`, `/api/menu`, `/api/orders`, `/api/onboarding/*`, `/api/master/*`, `/api/admin/*`, `/api/reports/*`. Documentation via OpenAPI at `/docs` (FastAPI auto-generated).

### 10. What are the immediate priorities you'd like the developer to work on?

- Full mobile-web responsiveness for the remaining employee pages (Orders, Meal Plans, Preferences)
- Deactivate / Reactivate user UI on the Admins & Employees page (backend already exists)
- Vendor self-service menu editor on the Vendor app
- Auto-refresh dashboard (websocket push for real-time counts)
- Ready-to-run EAS Build + store submission for both mobile variants

### 11. Access / handover items you'll provide the developer

- GitHub read/write access to the Emergent repo
- Emergent workspace collaborator invite (so they can Save-to-GitHub / Re-publish / view logs)
- Resend API key, Razorpay keys, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `MONGO_URL`, `DB_NAME` — via a password manager (1Password / Bitwarden), never over email
- Play Store & Apple Developer team invites for the two mobile apps
- Domain (`cravitoo.com`) DNS access if they need to update MX / TXT records
- This document + `/app/memory/PRD.md` + the Vendor Registration Checklist

---

<div style="page-break-after: always"></div>

# 🎤 Part 2 — What the developer will ask YOU

*Skim through these before the meeting. Fill in the blanks where marked `<...>`.*

## Business / product

**Q1. Who is the target user and what's the current scale?**
Corporate employees in India. Currently `<state MAU / DAU numbers OR "pre-launch, first client handover in progress">`.

**Q2. Do you have paying customers yet?**
`<yes/no — if yes, how many companies, sites, employees, and monthly GMV>`.

**Q3. What's the primary revenue model?**
Commission on vendor sales (12–18 %) + optional corporate subscription for premium features.

**Q4. Who owns the IP? Any prior contractors?**
`<you / your company>`. Prior work: built on Emergent Platform by Emergent's AI agents (E1). No third-party contractors have write access today.

**Q5. What's the launch / production deadline?**
`<your date>`. Current status: mobile apps waiting on final EAS build + store rollout.

## Access & credentials

**Q6. Can you give me a walkthrough of the running app?**
Yes — I have a demo master admin (`admin@cravitoo.com`) on the preview URL. Live production is `app.cravitoo.com`.

**Q7. Do you have GitHub, Emergent, Play Store, Apple Developer, Resend, Razorpay, and MongoDB Atlas access ready to hand over?**
Yes — I'll share credentials via 1Password / Bitwarden / your preferred password manager. Direct email / WhatsApp will not be used for secrets.

**Q8. Do you have separate accounts for me or will I use yours?**
`<create a dedicated dev@cravitoo.com or use their own email — recommend the former>`.

**Q9. Are there any secrets in the codebase today?**
No — every secret is in Emergent's Manage-Publishing → Secrets (production) and `/app/backend/.env` (preview only, not committed). No secrets in the repo.

## Architecture

**Q10. What database are we using, and how big is it?**
MongoDB Atlas managed by Emergent, current size `<let me get you the exact size — Manage Publishing → Database tab>`.

**Q11. Do you have staging / preview / production environments?**
Two — **preview** (`corporate-feast.preview.emergentagent.com`, safe to break) and **production** (`app.cravitoo.com`). Preview is used by the AI agent for testing.

**Q12. What CI/CD is in place?**
Emergent handles it. "Save to GitHub" → commit. "Re-publish" → deploy. Mobile is built via EAS locally then submitted to stores.

**Q13. Any test coverage?**
Yes — pytest regression suites for critical flows; Playwright reports in `/app/test_reports/`. No dedicated frontend unit tests yet.

**Q14. Any known scaling bottlenecks?**
Not encountered yet — traffic is low. Likely candidates when it grows: MongoDB Atlas tier, Razorpay webhook throughput, Resend rate limits.

## Mobile

**Q15. Do you have Play Store & Apple Developer accounts?**
`<yes — under Cravitoo owner name / or need to be created>`. Bundle IDs: `<add>`. EAS project IDs are in `mobile/eas.json`.

**Q16. Which one is the customer app vs partner app?**
Both from same repo. `production` profile = Customer, `production-vendor` profile = Partner. `APP_VARIANT` env selects the UI.

**Q17. Are there any live installs I need to migrate?**
`<state number of Play Store / TestFlight installs — this affects whether OTA updates or forced re-install are needed>`.

## Integrations

**Q18. Which third-party services am I responsible for?**
Razorpay (payments), Resend (email), OpenAI via Emergent LLM key, Expo Push. All keys are in Emergent → Secrets.

**Q19. What's the Resend sender domain?**
`noreply@cravitoo.com`, verified on paid tier.

**Q20. Razorpay — test or live mode?**
`<test on preview, live on production>`.

## Team / process

**Q21. How do you want me to communicate?**
`<Slack / WhatsApp / email — pick one primary, one urgent>`. Weekly written status update; monthly demo call.

**Q22. What are the top 3 priorities right now?**
Full mobile-web responsiveness · Deactivate-user UI · Mobile Play Store / TestFlight rollout with production backend URL baked in.

**Q23. Do you have a bug tracker?**
`<Notion / Linear / GitHub Issues / no — pick or say we'll set up>`. Currently informal — bugs go through this Emergent chat + the PRD.md.

**Q24. What's the definition of "done" for a feature?**
Code merged → regression tests pass → Playwright smoke passes → deployed to preview → verified by me → deployed to production.

**Q25. What's the budget / hourly rate / retainer?**
`<your commercial answer>`.

**Q26. What's my scope — full-time hand-over or ongoing feature work?**
`<state whether it's a one-time fix, monthly retainer, or full ownership transfer>`.

## Legal / handover

**Q27. Is there an NDA to sign?**
`<yes — send in advance / no>`.

**Q28. Who signs off on production deploys?**
`<you / a designated stakeholder>`. Currently only I have master admin access.

**Q29. Where is the source of truth for feature roadmap?**
`/app/memory/PRD.md` in the repo + the Emergent chat history for context.

**Q30. Can I use my own tooling / language / stack for new modules?**
`<prefer FastAPI + React to keep it consistent — Emergent's AI agent works best with this stack>`.

---

## One extra thing to bring to the meeting

Also bring the **Vendor Registration Checklist PDF** — it doubles as a concrete example of the level of documentation you already maintain. Developers judge founders by the quality of the handover pack, and this one is already miles ahead of the average.

---

*Cravitoo · Developer Handover Pack · v1.0 · Feb 2026*
