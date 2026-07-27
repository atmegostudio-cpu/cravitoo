import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import client, { setSessionInvalidCallback } from '../api/client';

const AuthContext = createContext(null);

const APP_VARIANT = Constants.expoConfig?.extra?.appVariant || 'customer';

export const isPartnerApp = () => APP_VARIANT === 'vendor';

export const isMasterAdmin = (user) => user?.role === 'master_admin';
export const isSiteAdmin = (user) => user?.role === 'site_admin';
export const isVendorRole = (user) => user?.role === 'vendor';
export const isPartnerRole = (user) => ['vendor', 'master_admin', 'site_admin'].includes(user?.role);

// Re-register the Expo push token with the backend (best-effort, called after login)
async function tryRegisterPushTokenAfterLogin() {
  try {
    if (!Device.isDevice) return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;
    if (!projectId) return;
    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResult.data;
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const variant = APP_VARIANT;
    await client.post('/notifications/push-token', { token, platform, variant });
  } catch (err) {
    // Silently no-op — backend will pick up token on next app open
  }
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // If the client's response interceptor gives up on the session (refresh
    // failed OR account was deactivated), it invokes this callback so we
    // reset user state and the app boots back to the Login stack.
    setSessionInvalidCallback(() => {
      setUser(null);
    });
    bootstrap();
  }, []);

  const bootstrap = async () => {
    try {
      const token = await SecureStore.getItemAsync('access_token');
      const refresh = await SecureStore.getItemAsync('refresh_token');
      if (!token && !refresh) {
        // Fully anonymous — nothing to restore.
        return;
      }
      try {
        const { data } = await client.get('/auth/me');
        setUser(data);
      } catch (e) {
        // 401 already triggered auto-refresh via the interceptor. If we're
        // still here with an error, the refresh also failed — the interceptor
        // has already wiped the tokens, so simply stay logged out.
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const { data } = await client.post('/auth/login', { email, password });
    if (data.access_token) {
      await SecureStore.setItemAsync('access_token', data.access_token);
    }
    if (data.refresh_token) {
      await SecureStore.setItemAsync('refresh_token', data.refresh_token);
    }
    setUser(data);
    // Re-register push token now that user is authenticated
    tryRegisterPushTokenAfterLogin();
    return data;
  };

  const register = async (email, password, name) => {
    const { data } = await client.post('/auth/register', { email, password, name, role: 'employee' });
    if (data.access_token) {
      await SecureStore.setItemAsync('access_token', data.access_token);
    }
    if (data.refresh_token) {
      await SecureStore.setItemAsync('refresh_token', data.refresh_token);
    }
    setUser(data);
    tryRegisterPushTokenAfterLogin();
    return data;
  };

  const requestOtp = async (email, channel = 'email') => {
    const { data } = await client.post('/auth/otp/request', { email, channel, purpose: 'Login' });
    return data;
  };

  const loginWithOtp = async (email, code) => {
    const { data } = await client.post('/auth/otp/verify', { email, code });
    if (data.access_token) {
      await SecureStore.setItemAsync('access_token', data.access_token);
    }
    if (data.refresh_token) {
      await SecureStore.setItemAsync('refresh_token', data.refresh_token);
    }
    setUser(data);
    tryRegisterPushTokenAfterLogin();
    return data;
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('access_token');
    await SecureStore.deleteItemAsync('refresh_token');
    try {
      await client.post('/auth/logout');
    } catch (e) {
      // Ignore logout error
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithOtp, requestOtp, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
