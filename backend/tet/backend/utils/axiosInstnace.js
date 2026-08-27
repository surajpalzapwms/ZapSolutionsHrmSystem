// src/api/axiosInstance.js
import axios from "axios";

const BASE_URL = process.env.FRONTEND_URL;

const pt = axios.create({
  baseURL: BASE_URL,
  timeout: 60000, // adjust to whatever you already use
});

// --- Request interceptor: attach token ---
pt.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// --- Response interceptor: handle session expiry cleanly ---
pt.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const hadToken = Boolean(error.config?.headers?.Authorization);

    // Only auto-redirect when this was an AUTHENTICATED request that got
    // rejected (expired/invalid token). A 401 on /login itself (wrong
    // credentials) never carries an Authorization header, so it falls
    // through to the normal reject path and your login form's own
    // "Invalid credentials" toast still works.
    if (status === 401 && hadToken) {
      localStorage.removeItem("token");

      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }

      // Never resolve/reject further so component-level .catch() / toast
      // code never runs and shows "Invalid token" / "Session expired" etc.
      return new Promise(() => {});
    }

    // Everything else (400, 401 without token, 403, 500, network errors...)
    // behaves normally so existing component error handling still works.
    return Promise.reject(error);
  }
);

export default pt;
