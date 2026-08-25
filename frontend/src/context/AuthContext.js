import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    // PWA cold-start behaviour: iOS + Android can clear the short-lived
    // access_token cookie while keeping the 365-day refresh_token. If we go
    // straight to /auth/me we'd get a 401 → user bounces to /login. Instead
    // we PROACTIVELY refresh first — one silent call, then /auth/me.
    try {
      await axios.post(
        `${API}/auth/refresh`,
        {},
        { withCredentials: true, timeout: 10000, skipAuthRedirect: true },
      );
    } catch (_) {
      // No refresh cookie or expired refresh → /auth/me will 401 below and
      // we'll cleanly land as "logged out". No noisy console errors.
    }

    try {
      const { data } = await axios.get(`${API}/auth/me`, {
        withCredentials: true,
        // Silent probe — never redirect or trigger an auto-refresh from this call.
        skipAuthRedirect: true,
      });
      setUser(data);
    } catch (error) {
      setUser(false);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const { data } = await axios.post(
      `${API}/auth/login`,
      { email, password },
      { withCredentials: true }
    );
    setUser(data);
    return data;
  };

  const loginWithOtp = async (email, code) => {
    const { data } = await axios.post(
      `${API}/auth/otp/verify`,
      { email, code },
      { withCredentials: true }
    );
    setUser(data);
    return data;
  };

  const requestOtp = async (email, channel = 'email') => {
    const { data } = await axios.post(
      `${API}/auth/otp/request`,
      { email, channel, purpose: 'Login' },
      { withCredentials: true }
    );
    return data;
  };

  const register = async (email, password, name, role) => {
    const { data } = await axios.post(
      `${API}/auth/register`,
      { email, password, name, role },
      { withCredentials: true }
    );
    setUser(data);
    return data;
  };

  const logout = async () => {
    await axios.post(`${API}/auth/logout`, {}, { withCredentials: true });
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithOtp, requestOtp, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;