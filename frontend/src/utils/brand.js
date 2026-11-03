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

// General (product) logo: shown everywhere until a company uploads its own.
// The owner company (ZAP Solutionz) keeps /mainlogo.png until it uploads one.
export const GENERAL_LOGO = env.VITE_GENERAL_LOGO_URL || "/hrm-logo.png";
export const OWNER_FALLBACK_LOGO = "/mainlogo.png";

const DEFAULTS = Object.freeze({
  name: env.VITE_COMPANY_NAME || "ZAP Solutionz",
  shortName: env.VITE_COMPANY_SHORT_NAME || "",
  tagline:
    env.VITE_COMPANY_TAGLINE ||
    "Manage staff, payroll, and attendance in one place.",
  logoUrl: GENERAL_LOGO,
  // true only when THIS company uploaded its own logo (set by the server)
  hasCustomLogo: false,
  isOwner: false,
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
  // ---- white label: country / locale of the company in use ----
  companyId: "",
  slug: "",
  legalName: "",
  nameAr: "",
  country: "IN",
  countryName: "India",
  timeZone: env.VITE_DEFAULT_TIMEZONE || "Asia/Kolkata",
  weeklyOffDays: [0], // 0 = Sunday ... 6 = Saturday
  // Working time (Settings → Work week & hours), "HH:mm" 24-hour.
  workStartTime: "10:00",
  workEndTime: "18:30",
  // Short Saturday (when Saturday is not a weekly off): own hours, any
  // attendance = full day. shortSaturdayActive = the switch AND Saturday is a working day.
  shortSaturday: true,
  shortSaturdayActive: true,
  saturdayStartTime: "10:00",
  saturdayEndTime: "16:00",
  rtl: false,
  phoneCode: "+91",
  city: "",
  state: "",
  postalCode: "",
  signatoryName: "",
  signatoryTitle: "",
  legalIdList: [], // [{ key, label, value, print }]
  // false = this company has no Internship / Probation (super admin setting):
  // staff are confirmed on their joining date.
  probationEnabled: true,
});

const FIELDS = Object.keys(DEFAULTS);

// Fills in the number format from the currency when none is chosen.
const normalize = (b) => {
  const cur = findCurrency(b.currencyCode) || findCurrency(DEFAULT_CURRENCY);
  // Company logo only if the company really set one; otherwise the general
  // logo (ZAP keeps its own). This also stops an old cached logo of another
  // company from leaking through.
  const logoUrl =
    b.hasCustomLogo && b.logoUrl
      ? b.logoUrl
      : b.isOwner
        ? OWNER_FALLBACK_LOGO
        : GENERAL_LOGO;
  return Object.freeze({
    ...b,
    logoUrl,
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
    else if (typeof v === "boolean") out[f] = v;
    else if (Array.isArray(v) && Array.isArray(DEFAULTS[f])) out[f] = v;
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
  // Browser tab icon = the company logo.
  if (current.logoUrl) {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    if (link.href !== current.logoUrl) link.href = current.logoUrl;
  }
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

// Fetches the brand of the company in use: the logged-in user's company,
// the company the super admin opened (X-Company-Id, added by api.js), or —
// on the login page — ?company=<link name> / the site's own domain.
// Never throws — if the server can't be reached the cached / default brand
// stays in use.
export const loadBrandFromServer = async ({ company } = {}) => {
  try {
    const params = {};
    if (company) params.company = company;
    if (typeof window !== "undefined") params.host = window.location.hostname;
    const res = await api.get("/api/settings", { timeout: 8000, params });
    if (res.data?.data) setBrand(res.data.data);
  } catch {
    /* keep the cached / default brand */
  }
};

// ── Company time zone & weekly off days ───────────────────────────────────
/** "Asia/Riyadh" etc. — the company's time zone. */
export const companyTimeZone = () => current.timeZone || "Asia/Kolkata";

/** UTC offset of the company's time zone in ms (Asia/Kolkata -> 5.5 h). */
export const tzOffsetMs = (at = Date.now()) => {
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: companyTimeZone(),
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date(at))
      .find((p) => p.type === "timeZoneName")?.value;
    const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(part || "");
    if (!m) return 0;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) * 60000;
  } catch {
    return 5.5 * 3600 * 1000;
  }
};

/** "YYYY-MM-DD" of a date in the company's time zone. */
export const companyDayKey = (value = new Date()) => {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + tzOffsetMs(t)).toISOString().slice(0, 10);
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekly off days (0 = Sunday). India [0]; Saudi Arabia / Qatar [5, 6]. */
export const weeklyOffDays = () =>
  Array.isArray(current.weeklyOffDays) && current.weeklyOffDays.length ? current.weeklyOffDays : [0];

export const isWeeklyOffDow = (dow) => weeklyOffDays().includes(dow);

/** "Sunday" / "Friday & Saturday" */
export const weeklyOffLabel = () => weeklyOffDays().map((d) => DAY_NAMES[d]).join(" & ");

// ── Working time ──────────────────────────────────────────────────────────
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hmOr = (v, fallback) => (typeof v === "string" && HM.test(v) ? v : fallback);

/** Company office hours: { start: "10:00", end: "18:30" }. */
export const workHours = () => ({
  start: hmOr(current.workStartTime, "10:00"),
  end: hmOr(current.workEndTime, "18:30"),
});

// Short Saturdays apply from 1 Apr 2026 (same date as the server).
const SHORT_SATURDAY_FROM = "2026-04-01";

/**
 * Default Login / Logout for a day "YYYY-MM-DD": the company's working hours,
 * or its Saturday hours on a short Saturday. Same rule as the server
 * (services/leave.js companyShiftForDate).
 */
export const companyShiftForDate = (dateKey) => {
  const key = String(dateKey || "").slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(key) ? new Date(`${key}T00:00:00Z`) : null;
  const saturdayOff = weeklyOffDays().includes(6);
  if (d && d.getUTCDay() === 6 && current.shortSaturday !== false && !saturdayOff && key >= SHORT_SATURDAY_FROM) {
    return { start: hmOr(current.saturdayStartTime, "10:00"), end: hmOr(current.saturdayEndTime, "16:00") };
  }
  return workHours();
};

/** "09:30" -> "9:30 AM" */
export const formatHM = (hm) => {
  if (!HM.test(String(hm || ""))) return "";
  const [h, m] = hm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/** "10:00 AM–6:30 PM" for a day (or the normal working day). */
export const shiftLabel = (dateKey) => {
  const { start, end } = dateKey ? companyShiftForDate(dateKey) : workHours();
  return `${formatHM(start)}–${formatHM(end)}`;
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

// ── Staff ID prefix ───────────────────────────────────────────────────────
// Two or more words -> first letter of the first two words ("Zap Solutionz" -> ZS);
// one word -> its first two letters ("Acme" -> AC). Same rule as the backend
// (utils/staffIdPrefix.js).
export const staffIdPrefixFor = (name = current.name) => {
  const words = String(name || "")
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean);
  let prefix;
  if (words.length >= 2) prefix = words[0][0] + words[1][0];
  else if (words.length === 1) prefix = words[0].slice(0, 2);
  else prefix = "ST";
  return prefix.toUpperCase().padEnd(2, "X");
};
