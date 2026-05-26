import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import client from '../api/client';

const AuthContext = createContext(null);

const APP_VARIANT = Constants.expoConfig?.extra?.appVariant || 'customer';

export const isPartnerApp = () => APP_VARIANT === 'vendor';

export const isMasterAdmin = (user) => user?.role === 'master_admin';
export const isSiteAdmin = (user) => user?.role === 'site_admin';
export const isVendorRole = (user) => user?.role === 'vendor';
export const isPartnerRole = (user) => ['vendor', 'master_admin', 'site_admin'].includes(user?.role);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bootstrap();
  }, []);

  const bootstrap = async () => {
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (token) {
        const { data } = await client.get('/auth/me');
        setUser(data);
      }
    } catch (e) {
      await SecureStore.deleteItemAsync('access_token');
      await SecureStore.deleteItemAsync('refresh_token');
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
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
