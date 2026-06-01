import { useEffect, useState, useCallback } from 'react';
import * as Updates from 'expo-updates';

/**
 * useOTAUpdates — checks for an OTA update on app launch and applies it.
 *
 * Behavior:
 *  • Skipped automatically in dev (Expo Go / development client) — Updates.isEnabled is false
 *  • On launch: fetches manifest from EAS Update server (non-blocking, ~1-2s)
 *  • If an update is available → downloads in background → reloads app with new JS bundle
 *  • Safe: any error is swallowed; user never sees a crash from update failures
 *
 * To publish an update from the host:
 *   eas update --branch production --message "Login role-check fix"
 *   eas update --branch production-vendor --message "Login role-check fix"
 */
export default function useOTAUpdates() {
  const [updateState, setUpdateState] = useState({
    checking: false,
    downloading: false,
    error: null,
  });

  const checkForUpdates = useCallback(async () => {
    if (!Updates.isEnabled) {
      // Dev mode / Expo Go — OTA disabled. No-op.
      return;
    }
    try {
      setUpdateState((s) => ({ ...s, checking: true, error: null }));
      const result = await Updates.checkForUpdateAsync();
      setUpdateState((s) => ({ ...s, checking: false }));

      if (result.isAvailable) {
        setUpdateState((s) => ({ ...s, downloading: true }));
        await Updates.fetchUpdateAsync();
        setUpdateState((s) => ({ ...s, downloading: false }));
        // Apply update by reloading the app
        await Updates.reloadAsync();
      }
    } catch (err) {
      // Never crash the app due to OTA — just log & continue with current bundle
      // eslint-disable-next-line no-console
      console.warn('[OTA] update check failed:', err?.message || err);
      setUpdateState({ checking: false, downloading: false, error: err });
    }
  }, []);

  useEffect(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  return updateState;
}
