// src/utils/api.js
import axios from "axios";
import { BACKEND_URL } from "./constants";
import { getSelectedCompany, isOwnerCompany } from "./company";
import { showToast } from "./toast";

const api = axios.create({
  baseURL: BACKEND_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000,
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Super admin: the company opened on the Companies page. (For admins and
    // staff the server always uses their own company and ignores this.)
    const company = getSelectedCompany();
    // Super admin viewing a client company: view only. Block every write
    // here (the server refuses it too) so no half-filled form is lost silently.
    const method = (config.method || "get").toLowerCase();
    const url = config.url || "";
    let role = "";
    try { role = (JSON.parse(localStorage.getItem("user") || "null")?.role || "").toLowerCase(); } catch { /* ignore */ }
    if (
      role === "super-admin" && company?._id && !isOwnerCompany(company) &&
      !["get", "head", "options"].includes(method) &&
      !/^\/?api\/(company|auth)(\/|$)/.test(url.replace(/^https?:\/\/[^/]+/, ""))
    ) {
      showToast("error", "View only — this company's admin adds and edits its own details.");
      return Promise.reject(Object.assign(new Error("View only"), { response: { status: 403, data: { code: "CLIENT_COMPANY_READ_ONLY", message: "View only" } } }));
    }
    if (company?._id && !config.headers["X-Company-Id"]) {
      config.headers["X-Company-Id"] = company._id;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const code = error.response?.data?.code;
    const onLogin = window.location.pathname.startsWith("/login");
    if (status === 401 && !onLogin) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    } else if (code === "COMPANY_REQUIRED" || code === "COMPANY_NOT_FOUND") {
      // Super admin with several companies and none opened (or it was deleted).
      if (code === "COMPANY_NOT_FOUND") localStorage.removeItem("selectedCompany");
      if (!window.location.pathname.startsWith("/companies")) window.location.href = "/companies";
    } else if ((code === "COMPANY_INACTIVE" || code === "COMPANY_MISSING") && !onLogin) {
      ["token", "user", "selectedCompany"].forEach((k) => localStorage.removeItem(k));
      window.location.href = `/login?reason=${code === "COMPANY_INACTIVE" ? "company-inactive" : "no-company"}`;
    }
    return Promise.reject(error);
  }
);

export const get = (url, params) => api.get(url, { params });
export const post = (url, data) => api.post(url, data);
export const put = (url, data) => api.put(url, data);
export const patch = (url, data) => api.patch(url, data);
export const del = (url, data) => api.delete(url, { data });

export default api;