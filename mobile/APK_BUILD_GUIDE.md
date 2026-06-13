# Cravitoo APK — Build & Demo Guide

This document explains the **easiest path** to get a real installable APK in your hand for a live demo on any Android phone.

There are **3 ways** to demo the mobile app — pick whichever fits.

---

## ⚡ Option 1 — Expo Go (60 seconds, no APK needed)

Best for **internal/personal demos**. You install Expo Go from the Play Store once, then scan a QR code anytime to see the live app.

1. On your Android phone, install **"Expo Go"** from Google Play Store
2. Open a terminal on **any machine that has the repo** (your Mac will do once)
3. Run:
   ```bash
   cd mobile
   yarn install         # only first time
   npx expo start --tunnel
   ```
4. A QR code appears in the terminal
5. Open **Expo Go** on your phone → "Scan QR code" → tap the QR
6. The app loads instantly — fully interactive, talks to your real production backend

**Pros:** zero build time, instantly reflects code changes
**Cons:** needs Expo Go installed; not your own branded icon on home screen

---

## 📦 Option 2 — Real APK via GitHub Actions (recommended for client demos)

Builds a real `.apk` file on Expo's cloud. Anyone on Android can install it directly without Expo Go.

### Setup (only once)
1. **Push the repo to GitHub** — push your local repo to a fresh GitHub repository
2. Get an Expo access token:
   - Go to [https://expo.dev](https://expo.dev) → log in (your Cravitoo account)
   - Top-right avatar → **Settings** → **Access tokens** → **Create token**
   - Name it `github-actions` → copy the long token
3. Add it to GitHub:
   - Your repo on GitHub → **Settings** → **Secrets and variables** → **Actions**
   - **New repository secret** → Name: `EXPO_TOKEN`, Value: the token you copied
   - Save

### Build the APK
1. Repo on GitHub → **Actions** tab → **EAS Build APK (Demo)** workflow
2. Click **Run workflow** (top-right)
3. Pick:
   - **Variant:** `customer` (this is the Employee + Corp Admin app)
   - **Profile:** `preview` (this gives you an installable standalone APK)
4. Click the green **Run workflow** button
5. Wait ~10–15 min — the build runs on Expo's cloud
6. When done, open the **Track progress** link in the job summary → it goes to expo.dev → there's a big **Install** / **Download** button
7. Open that link **on the Android phone** → tap Install → done

### Install the APK on the phone
- The link on expo.dev gives you both:
  - **QR code** — scan with phone camera, opens the install page
  - **Direct .apk download** — tap → "Open" → Android may say "Unknown source", tap **Settings → Allow** → install
- After install, the Cravitoo icon appears on the home screen

**Pros:** real branded app, works offline, ready to share with anyone
**Cons:** 10–15 min build time; Expo free tier = 30 builds/month (plenty for demos)

---

## 🛠 Option 3 — Local APK build (advanced)

Only if you have an Android-dev-ready Mac/PC with Java 17 + Android SDK installed.

```bash
cd mobile
npx expo prebuild --platform android --clean
cd android
./gradlew assembleRelease
# APK ends up at android/app/build/outputs/apk/release/app-release.apk
```

Most people skip this and use Option 1 or 2.

---

## During the demo

Whichever route you pick, the demo flow is the same:

1. **Open the app** → Login screen
2. **Login** with `info@cravitoo.com` / `Demo@123` (employee)
3. **Pre-booking** → pick Veg Meal / Non-Veg Meal / Veg Salad / Non-Veg Salad for Lunch or Dinner → Reserve
4. **Switch to** `finance@cravitoo.com` / `Demo@123` (Corp Admin) → Bulk Pre-Order (only between 8:00–8:45 PM IST)
5. **Switch to** `vendor@atmego.com` / `Demo@123` (Vendor) → see tomorrow's kitchen counts

Make sure you've run the demo setup endpoint first on production:
```
POST https://app.cravitoo.com/api/admin/demo/setup
```
(or use the **Master Admin → Demo** page in the web admin → click **Set up demo**)

---

## Vendor app

The Vendor mobile app is the same codebase with `APP_VARIANT=vendor`. To build that APK:
- Option 2 → choose **Variant: vendor** + **Profile: preview-vendor**

## Troubleshooting

- **"Unknown source" warning on Android install** — that's expected for any non-Play-Store APK. Tap **Settings** → toggle **Allow from this source** → back → tap Install.
- **EAS build fails with "no Expo account"** — double-check the `EXPO_TOKEN` secret is set in GitHub Actions.
- **App opens but can't login** — your phone may be on a different network than the backend. Make sure the backend at `app.cravitoo.com` is reachable from the phone (open it in mobile browser first).
