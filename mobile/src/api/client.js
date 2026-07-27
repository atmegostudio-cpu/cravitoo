import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const client = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 30000,
});

// Attach Bearer token to every outgoing request
client.interceptors.request.use(async (config) => {
  try {
    const token = await SecureStore.getItemAsync('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (e) {
    // SecureStore not yet available
  }
  return config;
});

// -----------------------------------------------------------------------
// Silent access-token refresh.
//
// When any request returns 401 (access token expired), the interceptor:
//   1. Reads the long-lived refresh_token from SecureStore.
//   2. Calls POST /auth/refresh to get a fresh access token.
//   3. Retries the original request with the new token.
//   4. If refresh itself fails (deactivated user, token corrupted, etc.),
//      clears both tokens so the AuthProvider bootstrap can send the
//      user back to the login screen.
//
// Refresh calls are de-duplicated: while one refresh is in-flight, every
// other 401 waits on the same promise instead of firing parallel refresh
// requests.
//
// Callers may set `config._skipRefresh = true` (or point the URL to an
// auth-flow endpoint) to opt out of the refresh dance.
// -----------------------------------------------------------------------
let refreshPromise = null;
let sessionInvalidCallback = null;

export const setSessionInvalidCallback = (cb) => {
  sessionInvalidCallback = cb;
};

const isAuthFlowEndpoint = (url = '') =>
  url.includes('/auth/login') ||
  url.includes('/auth/register') ||
  url.includes('/auth/refresh') ||
  url.includes('/auth/otp');

async function performRefresh() {
  const refreshToken = await SecureStore.getItemAsync('refresh_token');
  if (!refreshToken) throw new Error('no refresh token');
  const resp = await axios.post(
    `${API_URL}/api/auth/refresh`,
    {},
    { headers: { Authorization: `Bearer ${refreshToken}` }, timeout: 15000 },
  );
  const newToken = resp.data?.access_token;
  if (!newToken) throw new Error('no access_token in refresh response');
  await SecureStore.setItemAsync('access_token', newToken);
  return newToken;
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config || {};
    const status = error.response?.status;
    if (!status) return Promise.reject(error);

    // 403 = permanently deactivated user OR insufficient role — wipe session.
    if (status === 403 && error.response?.data?.detail === 'Account deactivated') {
      await SecureStore.deleteItemAsync('access_token');
      await SecureStore.deleteItemAsync('refresh_token');
      if (sessionInvalidCallback) sessionInvalidCallback('deactivated');
      return Promise.reject(error);
    }

    if (
      status === 401 &&
      !original._retried &&
      !original._skipRefresh &&
      !isAuthFlowEndpoint(original.url)
    ) {
      original._retried = true;
      try {
        if (!refreshPromise) {
          refreshPromise = performRefresh().finally(() => {
            refreshPromise = null;
          });
        }
        const newToken = await refreshPromise;
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return client(original);
      } catch (e) {
        await SecureStore.deleteItemAsync('access_token');
        await SecureStore.deleteItemAsync('refresh_token');
        if (sessionInvalidCallback) sessionInvalidCallback('expired');
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  },
);

export default client;
export { API_URL };
