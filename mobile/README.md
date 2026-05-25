# Cravitoo Mobile App (React Native + Expo)

The official Cravitoo mobile app for **employees** — built with React Native + Expo SDK 52, sharing the same FastAPI backend as the web app.

## Features

- **Login & Register** with secure token storage (expo-secure-store)
- **Home Dashboard** with AI-powered meal recommendations (GPT-5.2)
- **Browse Menu** with vendor tabs and item cards
- **Multi-vendor Cart** with quantity controls
- **Order Placement** (pickup orders, payment on pickup in mobile MVP)
- **Order Tracking** with status badges
- **Order Details** with **QR Code Pickup**
- **Loyalty Rewards** (Starter/Bronze/Silver/Gold tiers, points balance)
- **Notifications** (in-app, polled from backend)
- **Profile** with sign-out

## Tech Stack

- **Expo SDK 52** (React Native 0.76)
- **React Navigation 7** (Stack + Bottom Tabs)
- **Axios** for API calls
- **expo-secure-store** for JWT token storage
- **expo-linear-gradient** for gradients
- **@expo/vector-icons** (Ionicons)

## Project Structure

```
/app/mobile/
├── App.js                       # Entry point with navigation
├── app.json                     # Expo config (name, icon, bundle IDs)
├── babel.config.js
├── package.json
├── assets/
│   ├── icon.png                 # App icon (Cravitoo logo)
│   └── splash.png
└── src/
    ├── theme.js                 # Color tokens, spacing, typography
    ├── api/
    │   └── client.js            # Axios instance with Bearer auth
    ├── context/
    │   └── AuthContext.js       # Auth state + login/logout
    └── screens/
        ├── LoginScreen.js
        ├── RegisterScreen.js
        ├── HomeScreen.js
        ├── MenuScreen.js
        ├── CartScreen.js
        ├── OrdersScreen.js
        ├── OrderDetailScreen.js
        ├── LoyaltyScreen.js
        ├── NotificationsScreen.js
        └── ProfileScreen.js
```

## Running the App

### 1. Prerequisites

- **Node.js** 20+
- **Yarn** (NOT npm)
- **Expo Go app** on your phone:
  - iOS: [App Store](https://apps.apple.com/app/expo-go/id982107779)
  - Android: [Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent)

### 2. Install Dependencies

```bash
cd /app/mobile
yarn install
```

### 3. Start the Dev Server

```bash
cd /app/mobile
yarn start
```

This will print a QR code in your terminal.

### 4. Open on Your Phone

- **iOS**: Open the **Camera** app → point at the QR code → tap the banner that appears (opens Expo Go)
- **Android**: Open **Expo Go** app → tap "Scan QR code" → point at the QR code

The app will load in about 30-60 seconds the first time (it's bundled JavaScript over the network).

### 5. Login

Use the seeded employee account:
- Email: `employee@techcorp.com`
- Password: `employee123`

## Backend Connection

The mobile app connects to the same FastAPI backend as the web. The URL is configured in `app.json` under `extra.apiUrl`:

```json
"extra": {
  "apiUrl": "https://corporate-feast.preview.emergentagent.com"
}
```

To point to production, change to `https://corporate-feast.emergent.host`.

The backend was updated to return JWT tokens in the response body (for mobile) in addition to httpOnly cookies (for web).

## Building for Production (App Store / Play Store)

### Option A: EAS Build (recommended)

```bash
npm install -g eas-cli
eas login
cd /app/mobile
eas build:configure
eas build --platform android      # builds AAB for Play Store
eas build --platform ios          # builds IPA for App Store (requires Apple Dev account)
```

### Option B: Local APK (Android only, no Expo account)

```bash
cd /app/mobile
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# APK at android/app/build/outputs/apk/release/app-release.apk
```

## Known Limitations (Mobile MVP)

- **Payment**: Stripe Checkout (web) is not yet wired in the mobile app. Orders are created with `payment_status: pending` and assumed paid-on-pickup. For real payment, integrate Stripe React Native SDK or Razorpay (recommended for India).
- **No push notifications yet**: Notifications are polled from the backend. To enable real push, integrate `expo-notifications` + Firebase Cloud Messaging.
- **Employee role only**: Vendor, Corporate Admin, and Super Admin still use the web app.
- **No offline mode**: Requires internet connection.

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Employee | employee@techcorp.com | employee123 |

(Vendor/Admin/Super Admin must use the web app at https://corporate-feast.emergent.host)

## Troubleshooting

- **"Network request failed"** → Make sure your phone and computer are on the same Wi-Fi network, OR use `--tunnel` flag: `yarn start --tunnel`
- **"Expo Go can't reach metro"** → Try running `yarn start --tunnel`
- **iOS won't load** → On iOS 16+, the camera scan only works for QR codes from real Expo Go installs; tap the "Open in Expo Go" link manually
- **Login fails with CORS** → The backend has `allow_origins=["*"]` and supports both cookie + Bearer auth, so this should not happen. Check that `apiUrl` in `app.json` points to a reachable server.
