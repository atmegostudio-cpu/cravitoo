import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import client from '../api/client';

// ──────────────────────────────────────────────────────────────────
// Foreground notification behavior — show banner + sound when app is open
// MUST be set at module top-level (not inside a component).
// ──────────────────────────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Request notification permission, set up Android channel, fetch Expo Push Token,
 * register it with the Cravitoo backend, and listen for taps to deep-link.
 *
 * Behavior:
 *  • Skipped on simulators (push only works on physical devices)
 *  • Permission denied → silently no-ops
 *  • Token refresh → re-registers automatically
 *  • Tap notification → tries to deep-link via `navigationRef`
 */
export default function usePushNotifications(navigationRef) {
  const responseListenerRef = useRef(null);
  const receivedListenerRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      try {
        // Android: create high-importance channel BEFORE asking permission
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Cravitoo Notifications',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF5A1F',
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          });
        }

        // Push only works on physical devices
        if (!Device.isDevice) {
          return;
        }

        // Request permission
        const { status: existing } = await Notifications.getPermissionsAsync();
        let final = existing;
        if (existing !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          final = status;
        }
        if (final !== 'granted') {
          // User denied — silently no-op (don't break the app)
          return;
        }

        // Get the Expo push token (tied to this EAS project)
        const projectId =
          Constants?.expoConfig?.extra?.eas?.projectId ??
          Constants?.easConfig?.projectId;

        if (!projectId) {
          console.warn('[Push] No EAS projectId — token cannot be issued');
          return;
        }

        const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
        const token = tokenResult.data;

        if (!mounted) return;

        // Register token with backend (best-effort — failure is non-fatal)
        try {
          const platform = Platform.OS === 'ios' ? 'ios' : 'android';
          const variant = Constants?.expoConfig?.extra?.appVariant || 'customer';
          await client.post('/notifications/push-token', { token, platform, variant });
        } catch (err) {
          // User may not be logged in yet — token will register after login when this hook re-runs
          console.warn('[Push] token register failed:', err?.response?.data || err.message);
        }
      } catch (err) {
        console.warn('[Push] setup failed:', err?.message || err);
      }
    };

    setup();

    // Listener: notification received in foreground
    receivedListenerRef.current = Notifications.addNotificationReceivedListener(() => {
      // Could update in-app badge counts here
    });

    // Listener: user tapped a notification → deep-link
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const content = response.notification.request.content;
        let data = content.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch { /* ignore */ }
        }
        if (!data || !navigationRef?.current) return;

        // Deep link based on data.screen + data.id
        if (data.screen === 'OrderDetail' && data.orderId) {
          navigationRef.current.navigate('OrderDetail', { orderId: String(data.orderId) });
        } else if (data.screen === 'Orders') {
          navigationRef.current.navigate('Orders');
        } else if (data.screen === 'Notifications') {
          navigationRef.current.navigate('Notifications');
        }
      } catch (err) {
        console.warn('[Push] response handler failed:', err?.message || err);
      }
    });

    return () => {
      mounted = false;
      if (receivedListenerRef.current) {
        receivedListenerRef.current.remove();
      }
      if (responseListenerRef.current) {
        responseListenerRef.current.remove();
      }
    };
  }, [navigationRef]);
}
