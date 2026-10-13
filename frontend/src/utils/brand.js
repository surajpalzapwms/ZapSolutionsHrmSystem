// src/utils/brand.js
// The company's name, logo and colours. This is a single-company app, so the
// brand is fixed here (optionally overridden with VITE_COMPANY_* variables in
// the frontend .env at build time). Plain module values, so non-React code
// (PDF generators) can read it too.
const env = import.meta.env || {};

export const BRAND = Object.freeze({
  name: env.VITE_COMPANY_NAME || "ZAP Solutionz",
  shortName: env.VITE_COMPANY_SHORT_NAME || "",
  tagline:
    env.VITE_COMPANY_TAGLINE ||
    "Manage staff, payroll, and attendance in one place.",
  logoUrl: env.VITE_COMPANY_LOGO_URL || "/mainlogo.png",
  primaryColor: env.VITE_COMPANY_PRIMARY_COLOR || "#2563eb",
  sidebarColor: env.VITE_COMPANY_SIDEBAR_COLOR || "#0b1220",
  loginTitle: env.VITE_COMPANY_LOGIN_TITLE || "HRM Portal",
  loginSubtitle:
    env.VITE_COMPANY_LOGIN_SUBTITLE ||
    "Access is limited to authorised personnel and is logged for security.",
  financeTitle: env.VITE_COMPANY_FINANCE_TITLE || "Finance Manager",
});

export const getBrand = () => BRAND;

// Pushes the brand colours into the CSS variables used by buttons / sidebar.
export const applyBrandToDocument = () => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--brand-primary", BRAND.primaryColor);
  root.style.setProperty("--brand-sidebar", BRAND.sidebarColor);
};
