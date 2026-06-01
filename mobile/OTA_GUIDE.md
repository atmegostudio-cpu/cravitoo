# Cravitoo Mobile — OTA (Over-The-Air) Updates Guide

## What is OTA?

OTA lets you push **JavaScript / UI / asset** updates to already-installed APKs
**without** rebuilding the binary or going through Play Store / App Store review.

Native changes (new permissions, new SDKs, version bumps) still require an EAS build.

---

## When OTA is used

| Change type | OTA works? | Action |
|---|---|---|
| JS / React component logic | ✅ Yes | `eas update` |
| New screen (JS only) | ✅ Yes | `eas update` |
| Style / theme tweak | ✅ Yes | `eas update` |
| API endpoint change | ✅ Yes | `eas update` |
| Asset (image, font) | ✅ Yes | `eas update` |
| New native module / permission | ❌ No | Full `eas build` |
| Expo SDK upgrade | ❌ No | Full `eas build` |
| `app.config.js` native settings | ❌ No | Full `eas build` |
| Version bump (1.0.0 → 1.0.1) | ❌ No | Full `eas build` |

---

## First-time setup (already done in code)

1. ✅ `expo-updates` installed (`/app/mobile/package.json`)
2. ✅ `app.config.js` configured with `updates.url` + `runtimeVersion`
3. ✅ `eas.json` build profiles tagged with `channel`
4. ✅ `App.js` calls `useOTAUpdates()` on launch

**One-time bootstrap rebuild required (after EAS quota resets):**

```bash
# Customer app (Cravitoo)
cd /app/mobile && eas build -p android --profile production

# Partner app (Cravitoo Partner)
cd /app/mobile && eas build -p android --profile production-vendor
```

After these two builds, all future JS-only fixes ship via OTA.

---

## Publishing an OTA update (no EAS build needed)

### Step 1 — Make your code change
Edit any `.js` / `.jsx` file under `/app/mobile/src/`.

### Step 2 — Publish to the correct channel

```bash
cd /app/mobile

# Customer app — production users
eas update --branch production --message "Fix: login alert wording"

# Customer app — preview / internal testers
eas update --branch preview --message "Test: new menu filter"

# Partner app — production
eas update --branch production-vendor --message "Fix: vendor dashboard"

# Partner app — preview
eas update --branch preview-vendor --message "Test: bulk-scan UI"
```

### Step 3 — Users get it automatically
- App checks for updates on every launch
- If update available → downloads in background → applies on next app open
- Typically users see the fix within 1-2 app sessions

---

## Safe rollback (if a bad update ships)

```bash
# See past updates
eas update:list --branch production

# Roll back to a previous update (Expo will show you the IDs)
eas update --branch production --message "Rollback to <date>" --republish --group <previous-update-group-id>
```

---

## Recommended workflow

1. **Test locally** with `npx expo start` or your dev client
2. **Push to preview channel** first: `eas update --branch preview ...`
3. **Verify on internal testers' devices**
4. **Promote to production**: `eas update --branch production ...`

---

## Quota & cost (EAS Update — separate from EAS Build)

- **Free tier**: 1,000 MAU (Monthly Active Updates Recipients) free
- **Beyond free tier**: ~$0.005 per MAU
- **Does NOT consume EAS Build credits** — totally separate quota
- Suitable for B2B apps up to ~1k corporate users for free

---

## Troubleshooting

**Update not appearing on device?**
- Force-close the app and reopen (OTA checks happen on launch)
- Confirm `runtimeVersion` in your APK matches the update's runtime (must be same)
- Check `eas update:list --branch <channel>` to confirm the update was published
- Wait 1-2 minutes after publishing (CDN propagation)

**"Update incompatible" error?**
- This means you changed native code (`runtimeVersion` mismatch) — you need an EAS rebuild

**Want to disable OTA temporarily?**
- Edit `app.config.js` → `updates.enabled = false` → rebuild

---

## Files involved

- `/app/mobile/package.json` — `expo-updates` dependency
- `/app/mobile/app.config.js` — `updates.url`, `runtimeVersion`, `plugins`
- `/app/mobile/eas.json` — `channel` per build profile
- `/app/mobile/App.js` — `useOTAUpdates()` invocation
- `/app/mobile/src/hooks/useOTAUpdates.js` — update check logic
