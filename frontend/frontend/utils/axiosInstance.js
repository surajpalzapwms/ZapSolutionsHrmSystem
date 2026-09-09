// frontend/src/api/axiosInstance.js
import axios from "axios";

const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL,
  withCredentials: true, // matches server's cors({ credentials: true })
});

// ── Request interceptor ──────────────────────────────────────────────
// This is the #1 place a "token sent but server sees NO_TOKEN" bug hides:
// if `getToken()` reads from the wrong storage key, or runs before login
// has actually stored the token, the header silently never gets set and
// the request goes out with no Authorization header at all.
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token"); // confirm this key matches what login actually sets
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    } else if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[axios] No token found in storage for request to ${config.url}`);
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ── Response interceptor ─────────────────────────────────────────────
// Distinguishes an expired session (should redirect to login) from a
// genuinely invalid/missing token (should also redirect, but is worth
// logging separately since it usually signals a client-side bug rather
// than a normal session timeout).
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const code = error.response?.data?.code;

    if (code === "TOKEN_EXPIRED") {
      // eslint-disable-next-line no-console
      console.info("[axios] Session expired — redirecting to login");
      localStorage.removeItem("token");
      window.location.href = "/login?reason=expired";
    } else if (code === "TOKEN_INVALID" || code === "NO_TOKEN") {
      // eslint-disable-next-line no-console
      console.warn(`[axios] Auth rejected (${code}) on ${error.config?.url}`);
      localStorage.removeItem("token");
      window.location.href = "/login?reason=invalid";
    }

    return Promise.reject(error);
  },
);

export default axiosInstance;