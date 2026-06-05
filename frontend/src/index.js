import React from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import "@/index.css";
import App from "@/App";

// Global axios defaults so a hung connection surfaces a clear timeout error
// to the UI (instead of leaving the user staring at a spinner indefinitely).
axios.defaults.timeout = 25000;

// ===========================================================================
// Auto-refresh interceptor — silently exchanges the refresh_token cookie for
// a new access_token when any request returns 401, then retries the original
// call. Fixes the "Not authenticated" mid-session bug where the 15-min access
// token expires while the user is still actively using the app.
// ===========================================================================
const API_BASE = process.env.REACT_APP_BACKEND_URL;

let refreshPromise = null;            // shared promise so only ONE refresh is in flight at a time

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config || {};
    const status = error.response?.status;

    // Only attempt refresh on 401s, never on the auth endpoints themselves
    const isAuthEndpoint =
      original.url?.includes("/auth/login") ||
      original.url?.includes("/auth/register") ||
      original.url?.includes("/auth/refresh") ||
      original.url?.includes("/auth/logout");

    if (status !== 401 || original._retried || isAuthEndpoint) {
      return Promise.reject(error);
    }

    original._retried = true;
    try {
      // Coalesce concurrent 401s into a single refresh
      if (!refreshPromise) {
        refreshPromise = axios
          .post(`${API_BASE}/api/auth/refresh`, {}, { withCredentials: true })
          .finally(() => {
            // Release the lock after the request settles (success or fail)
            setTimeout(() => { refreshPromise = null; }, 0);
          });
      }
      await refreshPromise;
      // Retry the original request — the new cookie is now set in the browser
      return axios({ ...original, withCredentials: true });
    } catch (refreshErr) {
      // Refresh failed too (refresh_token expired or invalid) — bounce to login
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login?expired=1";
      }
      return Promise.reject(refreshErr);
    }
  }
);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
