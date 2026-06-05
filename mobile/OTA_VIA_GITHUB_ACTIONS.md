# Shipping OTA Updates via GitHub Actions

> **TL;DR**: GitHub → Actions → "EAS OTA Update" → Run workflow → pick variant, type message, click green button. ~3 min later, users get the update.

## One-time setup (do this once)

### 1. Generate an Expo access token
1. Go to https://expo.dev/accounts/{your-account}/settings/access-tokens
2. Click **"Create token"**
3. Name: `github-actions-cravitoo`
4. **Copy the token value** (starts with something like `dKi...`). You won't see it again.

### 2. Add the token as a GitHub secret
1. Open `https://github.com/{your-org}/{your-repo}/settings/secrets/actions`
2. Click **"New repository secret"**
3. Name: `EXPO_TOKEN`  (exactly this — case sensitive)
4. Value: paste the token from step 1
5. Click **"Add secret"**

Done. You'll never touch this again unless the token expires.

---

## Shipping an update (any time)

1. Open `https://github.com/{your-org}/{your-repo}/actions/workflows/eas-update.yml`
2. Click **"Run workflow"** (top-right green button)
3. Fill the form:

   | Field | Choose |
   |---|---|
   | **variant** | `customer` (employee app), `vendor` (partner app), `both` (fastest for full-platform fixes), or `preview` / `preview-vendor` (internal testing only) |
   | **message** | e.g. `"Fix pre-order cutoff timezone bug"` — visible to users in the update history |

4. Click the green **"Run workflow"** button at the bottom
5. Watch the run (~3 min). Green checkmark = users will receive the update on next app open.

---

## When to use which channel

| Channel | Audience | Use when |
|---|---|---|
| `production` (customer) | Real employees using the Cravitoo app | Customer-facing bug fixes & features |
| `production-vendor` (partner) | Real vendor staff at the cafeteria | Partner-facing fixes (orders dashboard, pickup scanner, etc.) |
| `both` | All users | Cravitoo-wide fixes (auth, networking, push notifications) |
| `preview` / `preview-vendor` | TestFlight / internal APK testers | QA-test a change before promoting to production |

---

## Important limitations

OTA updates **can ship**:
- Any JavaScript / TypeScript / JSX code change
- Tailwind-style style updates
- Text changes, copy fixes, new screens (as long as no new native module)
- Configuration changes that don't require a native rebuild

OTA updates **cannot ship**:
- New native modules (e.g. adding `react-native-camera`)
- Expo SDK upgrades (e.g. SDK 52 → 53)
- App icon, splash screen, bundle identifier changes
- New native permissions in `infoPlist` / `AndroidManifest`

For those changes, run `eas build` instead and submit a new App Store / Play Store version.

---

## Troubleshooting

- **"EXPO_TOKEN secret is missing"** → you skipped step 2 above. Add the secret.
- **"Project not found"** → the EAS project ID in `app.config.js` doesn't match your Expo account. Verify with `eas project:info` locally.
- **Update published but users don't see it** → users must close & reopen the app once. OTA fetches on app launch, not in the background.
- **Wrong variant got the update** → re-run with the correct variant. OTAs are versioned, so users will pick up the latest within seconds.

---

## Rollback an OTA update

If a bad OTA went out:
```bash
# From your local machine
cd mobile
eas update:list --branch production       # find the previous good update ID
eas update:republish --group {update-id}  # re-publish it as the latest
```
Users get the rollback on next app open.
