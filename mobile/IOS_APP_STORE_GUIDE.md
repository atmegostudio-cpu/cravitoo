# Cravitoo — iOS App Store Publish Guide

Complete checklist for shipping the Cravitoo Customer and Partner apps to the Apple App Store via EAS Build + TestFlight.

> **Two binaries** to publish:
> - `Cravitoo` (Customer App) — Employee variant
> - `Cravitoo Partner` (Partner App) — Vendor, Site Admin, Master Admin variant

---

## 1. Prerequisites (one-time setup)

### 1.1 Apple Developer account
- Enroll at https://developer.apple.com/programs/ — **$99/year**
- **Organisation enrollment recommended** (vs. individual) because:
  - Shows "Cravitoo Foods Pvt. Ltd." as the seller (more trust)
  - You'll need a **D-U-N-S Number** (free from Dun & Bradstreet India — takes 2-5 days)
  - Requires a registered company name + GST/PAN
- Approval can take 1-7 days. Apple may call to verify.

### 1.2 App Store Connect access
- Once enrolled, log in at https://appstoreconnect.apple.com
- Accept the latest Paid Apps Agreement, Free Apps Agreement, Data Use Agreement
- Set up **Tax + Banking** under Agreements → Payments (skip if app is free)

### 1.3 EAS CLI + Apple credentials
- Make sure EAS CLI is installed locally:
  ```bash
  npm install -g eas-cli
  eas login
  ```
- The first time you run `eas build -p ios`, EAS will prompt for:
  - Your Apple ID + password (with 2FA code)
  - Your **App-Specific Password** (recommended over real password — create at https://appleid.apple.com under "Sign-In and Security")
  - Apple Team ID (auto-detected after login)
- EAS will then **auto-generate** your Distribution Certificate + Provisioning Profile + Push Notification Key (`.p8` file) and store them encrypted in EAS Cloud.

---

## 2. Configure app.config.js for iOS

Both variants need correct iOS bundle identifiers. Open `/app/mobile/app.config.js` and verify the `ios` block exists for each variant:

```js
ios: {
  supportsTablet: false,
  bundleIdentifier: variant === 'partner'
    ? 'com.cravitoo.partner'
    : 'com.cravitoo.customer',
  buildNumber: '1',
  infoPlist: {
    NSCameraUsageDescription: 'Cravitoo uses your camera to scan QR codes for order pickup and to capture vendor menu photos.',
    NSPhotoLibraryUsageDescription: 'Cravitoo uses your photo library to upload profile and menu photos.',
    ITSAppUsesNonExemptEncryption: false,
  },
},
```

> **Bundle identifiers must be unique across the App Store** and cannot be changed once submitted. We've reserved:
> - `com.cravitoo.customer`
> - `com.cravitoo.partner`

---

## 3. App Store Connect — Create the two apps

Inside App Store Connect → **Apps** → **+** (New App):

### Customer App
| Field | Value |
|-------|-------|
| Platform | iOS |
| Name | `Cravitoo` |
| Primary Language | English (India) |
| Bundle ID | `com.cravitoo.customer` (created by EAS during first build) |
| SKU | `cravitoo-customer-001` |
| User Access | Full Access |

### Partner App
| Field | Value |
|-------|-------|
| Platform | iOS |
| Name | `Cravitoo Partner` |
| Primary Language | English (India) |
| Bundle ID | `com.cravitoo.partner` |
| SKU | `cravitoo-partner-001` |
| User Access | Full Access |

---

## 4. Build production iOS binaries via EAS

From `/app/mobile/` (the iOS build is cloud-built but must be triggered from a machine with a clean network):

```bash
# Customer App
eas build --profile production --platform ios

# Partner App (uses APP_VARIANT=partner)
APP_VARIANT=partner eas build --profile production-vendor --platform ios
```

Each build takes 15-30 minutes. The output is a `.ipa` file uploaded automatically to TestFlight.

> **Free EAS tier quota**: 30 iOS builds/month. Use them carefully — every `eas build` consumes 1 credit.

---

## 5. TestFlight (Internal + External testing)

After the first successful iOS build, the binary appears in App Store Connect → **Your App** → **TestFlight** tab.

### Internal Testing (immediate, no review)
- Add up to **100 internal testers** (must have App Store Connect access — typically your team)
- Apple sends an email invite with TestFlight install link
- No review required; builds are available within 5-10 minutes

### External Testing (requires light review)
- Add up to **10,000 external testers** via:
  - Public link (`https://testflight.apple.com/join/XXXXXX`)
  - Email invites
- First external build needs Apple review (24-48 hours, more lenient than App Store review)
- Each subsequent build does **not** need re-review unless major changes

> Use TestFlight for at least **1 week** before App Store submission to catch crash bugs and gather real-user feedback.

---

## 6. App Store metadata (per app)

Inside each app → **App Store** tab:

### Required assets
- **App Icon**: 1024×1024 px PNG, no transparency, no rounded corners (Apple adds them)
- **Screenshots**: 6.5" iPhone (1284×2778 or 2778×1284) — minimum 3, maximum 10
  - Customer App: Home + Menu + Cart + Order Detail + Profile (5 recommended)
  - Partner App: Dashboard + Orders + Menu + QR Scanner + Insights (5 recommended)
- Optional: iPad screenshots (only if `supportsTablet: true`)

### Required text
- **Name**: `Cravitoo` / `Cravitoo Partner` (max 30 chars)
- **Subtitle**: 30-char marketing tagline
  - Customer: `Office cafeteria, simplified.`
  - Partner: `Run your kitchen with ease.`
- **Description**: 4,000-char limit — pitch the product. Include feature list.
- **Keywords**: 100-char comma-separated (e.g., `corporate food, cafeteria, lunch, office meals, india`)
- **Promotional Text**: 170-char (changeable without resubmit)
- **Support URL**: `https://cravitoo.com/support`
- **Marketing URL**: `https://cravitoo.com`
- **Privacy Policy URL**: `https://app.cravitoo.com/privacy` (already live)
- **Category**:
  - Customer App: Primary = `Food & Drink`, Secondary = `Business`
  - Partner App: Primary = `Business`, Secondary = `Food & Drink`

### Age rating questionnaire
- Both apps: All ratings = **No** → results in **4+** (lowest age rating)
- No violence, no gambling, no user-generated content visible to public

### App Privacy
> Apple's mandatory data-disclosure form. Cravitoo collects:

| Data Type | Linked to user? | Used for tracking? |
|-----------|-----------------|--------------------|
| Email Address | Yes | No |
| Name | Yes | No |
| Phone Number (optional) | Yes | No |
| Purchase History | Yes | No |
| Coarse Location (city) | Yes | No |
| Device ID (Expo Push token) | Yes | No |
| Diagnostics | No (anonymous) | No |

> **Do NOT** tick "Tracking" — Cravitoo does not run cross-app ads.

---

## 7. Submit for App Store review

In App Store Connect → App → **+ Version** → Fill in:
- Build (pick from TestFlight)
- Sign-in info: provide a **demo account** for Apple reviewers:
  - **Customer App**: `apple-review-customer@cravitoo.com` / `AppleReview@2026`
  - **Partner App**: `apple-review-vendor@cravitoo.com` / `AppleReview@2026`
- Notes for reviewer: explain that the app is a **B2B corporate food ordering platform** and that real users sign up via their company invite (not public registration).

Click **Submit for Review**.

> Review time: **24-72 hours** typically. First submission may take longer (3-5 days).

---

## 8. Common rejection reasons + how to avoid

| Reason | Fix |
|--------|-----|
| Sign-in Required Without Demo Account | Always provide demo credentials in reviewer notes (#7) |
| Privacy Policy Missing/Broken | Verify `https://app.cravitoo.com/privacy` returns 200 (it does ✅) |
| Crashes on launch | Test TestFlight build on a real iPhone first |
| Mentions Android / other platforms | Remove any "Available on Google Play" badges from screenshots |
| Mentions beta / TestFlight in description | Keep production copy clean — no "beta" wording |
| Uses iOS APIs without `infoPlist` description | We've already added camera + photo library descriptions (#2) |
| Logout doesn't work | Verify Logout button on Profile screen calls `/api/auth/logout` (already implemented ✅) |
| Account deletion required (in-app, since iOS 18) | We've shipped `/settings/data` with type-DELETE-to-confirm flow (already implemented ✅) |

---

## 9. After approval

- App goes live **manually** (you click "Release this Version") OR **automatically** (set under Pricing & Availability)
- First search-result rankings improve **2-4 weeks** after launch as Apple indexes
- Set up **App Store Optimization** later: A/B test screenshots via App Store Connect → Marketing tools

---

## 10. Subsequent releases

For any code change after the first App Store launch:

### Pure JS/UI fix → OTA Update (instant, no review)
```bash
eas update --branch production --message "Fix: order detail crash"
eas update --branch production-vendor --message "Fix: ..."
```

### Native module change / dependency upgrade → New build + re-submit
```bash
# Bump buildNumber in app.config.js first (e.g., "1" → "2")
eas build -p ios --profile production
# Then upload via App Store Connect → New Version → submit
```

---

## 11. Cost summary

| Item | Cost |
|------|------|
| Apple Developer Program | **$99/year** (US$ — billed annually) |
| EAS Build (free tier) | Free up to 30 iOS builds/month |
| TestFlight | Free |
| App Store hosting | Free (Apple's commission only applies on paid apps / IAP — Cravitoo is free, so $0) |
| D-U-N-S Number | Free (D&B India) |
| **Total Year 1** | **~₹8,500 (=$99)** |

---

## 12. Direct contacts (when you get stuck)

- **Apple Developer Support**: https://developer.apple.com/contact/
- **App Store Connect Help**: https://appstoreconnect.apple.com/help
- **EAS Build issues**: https://forums.expo.dev or `eas build:configure` to reset
- **D-U-N-S Number help (India)**: https://www.dnb.co.in / 1-800-419-8520

---

## TL;DR — fastest path to live

1. ✅ Enroll in Apple Developer Program ($99) → 1-7 days
2. ✅ Get D-U-N-S Number from D&B India → 2-5 days
3. ✅ `eas build -p ios --profile production` (Customer + Partner)
4. ✅ Add to TestFlight, test for 3-5 days
5. ✅ Fill App Store Connect metadata + screenshots
6. ✅ Submit for review → 24-72h
7. 🎉 Live on App Store

**Realistic timeline: 2 weeks from "I want this" to "live".**
