// src/utils/brand.js
// The company's name, logo, colours, contact details and payroll currency.
//
// Defaults come from the VITE_COMPANY_* variables (or the values below); the
// admin's saved Settings (GET /api/settings) are applied on top at start-up
// and whenever the Settings page is saved. The last saved settings are kept
// in localStorage so the logo / colours paint immediately on the next visit.
//
// Plain module values + a tiny subscribe() so React components (useBrand)
// AND non-React code (PDF generators, number formatting) read the same data.
import api from "./api";
import { DEFAULT_CURRENCY, findCurrency } from "./currencies";

const env = import.meta.env || {};
const CACHE_KEY = "brandSettings";

const DEFAULTS = Object.freeze({
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
  address: "",
  phone: "",
  email: "",
  website: "",
  currencyCode: DEFAULT_CURRENCY,
  numberLocale: "",
});

const FIELDS = Object.keys(DEFAULTS);

// Fills in the number format from the currency when none is chosen.
const normalize = (b) => {
  const cur = findCurrency(b.currencyCode) || findCurrency(DEFAULT_CURRENCY);
  return Object.freeze({
    ...b,
    currencyCode: cur.code,
    numberLocale: b.numberLocale || cur.locale,
  });
};

// Only known fields; empty strings mean "not set" -> keep the default.
const merge = (base, data) => {
  const out = { ...base };
  for (const f of FIELDS) {
    const v = data?.[f];
    if (typeof v === "string" && v !== "") out[f] = v;
  }
  return out;
};

const readCache = () => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  } catch {
    return null;
  }
};

let current = normalize(merge(DEFAULTS, readCache()));
const listeners = new Set();

export const getBrand = () => current;
export const subscribeBrand = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Pushes the brand colours / title into the page.
export const applyBrandToDocument = () => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--brand-primary", current.primaryColor);
  root.style.setProperty("--brand-sidebar", current.sidebarColor);
  if (current.name) document.title = current.name;
};

// Applies settings from the server (or the Settings page after saving).
export const setBrand = (data) => {
  current = normalize(merge(DEFAULTS, data));
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(current));
  } catch {
    /* storage full / disabled — settings just aren't remembered offline */
  }
  applyBrandToDocument();
  listeners.forEach((fn) => fn());
};

export const resetBrand = () => {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
  current = normalize({ ...DEFAULTS });
  applyBrandToDocument();
  listeners.forEach((fn) => fn());
};

// Fetches the saved settings. Never throws — if the server can't be reached
// the cached / default brand stays in use.
export const loadBrandFromServer = async () => {
  try {
    const res = await api.get("/api/settings", { timeout: 8000 });
    if (res.data?.data) setBrand(res.data.data);
  } catch {
    /* keep the cached / default brand */
  }
};

// ── Money ─────────────────────────────────────────────────────────────────
// "₹1,23,456.79" — for the screen.
export const formatMoney = (value, decimals = 2) => {
  const { currencyCode, numberLocale } = current;
  const num = Number(value);
  const safe = Number.isFinite(num) ? num : 0;
  try {
    return new Intl.NumberFormat(numberLocale, {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(safe);
  } catch {
    return `${currencyCode} ${safe.toFixed(decimals)}`;
  }
};

// Just the digits with the number format, no symbol: "1,23,456.79".
export const formatPlainNumber = (value, decimals = 2) => {
  const num = Number(value);
  try {
    return (Number.isFinite(num) ? num : 0).toLocaleString(current.numberLocale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return (Number.isFinite(num) ? num : 0).toFixed(decimals);
  }
};

// "₹" / "$" / "AED" — the symbol alone (input prefixes, labels).
export const currencySymbol = () => {
  try {
    const part = new Intl.NumberFormat(current.numberLocale, {
      style: "currency",
      currency: current.currencyCode,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value || current.currencyCode;
  } catch {
    return current.currencyCode;
  }
};

// "Rs. 1,23,456.79" — for PDFs, whose built-in fonts only draw basic Latin.
export const formatMoneyPdf = (value, decimals = 2) => {
  const cur = findCurrency(current.currencyCode) || findCurrency(DEFAULT_CURRENCY);
  const sep = /^[A-Za-z]{2,}\.?$/.test(cur.pdf) ? " " : "";
  return `${cur.pdf}${sep}${formatPlainNumber(value, decimals)}`;
};
