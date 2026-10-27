// services/companyProfile.js
//
// The company's settings: name / logo / colours, contact details and the
// payroll currency. They are saved by an admin on the Settings page (one
// "main" row in the CompanyProfile collection). Anything not saved yet falls
// back to the .env values, so an existing install keeps working unchanged.
import CompanyProfile from "../models/CompanyProfile.js";
import { DEFAULT_CURRENCY, findCurrency } from "../config/currencies.js";

// Every setting the Settings page may change.
export const BRANDING_FIELDS = [
  "name",
  "shortName",
  "tagline",
  "logoUrl",
  "primaryColor",
  "sidebarColor",
  "loginTitle",
  "loginSubtitle",
  "financeTitle",
  "address",
  "phone",
  "email",
  "website",
  "currencyCode",
  "numberLocale",
];

const envDefaults = () => ({
  name: process.env.COMPANY_NAME || "HRM Portal",
  shortName: process.env.COMPANY_SHORT_NAME || "",
  tagline:
    process.env.COMPANY_TAGLINE ||
    "Manage staff, payroll, and attendance in one place.",
  logoUrl: process.env.COMPANY_LOGO_URL || "",
  primaryColor: process.env.COMPANY_PRIMARY_COLOR || "#2563eb",
  sidebarColor: process.env.COMPANY_SIDEBAR_COLOR || "#0b1220",
  loginTitle: process.env.COMPANY_LOGIN_TITLE || "HRM Portal",
  loginSubtitle:
    process.env.COMPANY_LOGIN_SUBTITLE ||
    "Access is limited to authorised personnel and is logged for security.",
  financeTitle: process.env.COMPANY_FINANCE_TITLE || "Finance Manager",
  address: process.env.COMPANY_ADDRESS || "",
  phone: process.env.COMPANY_PHONE || "",
  email: process.env.COMPANY_EMAIL || "",
  website: process.env.COMPANY_WEBSITE || "",
  currencyCode: process.env.COMPANY_CURRENCY || DEFAULT_CURRENCY,
  numberLocale: "",
});

// Saved values are read on every payslip / letter, so keep them for a short
// while. Saving settings clears this right away.
const TTL_MS = 30 * 1000;
let cache = null;

export const clearCompanyProfileCache = () => {
  cache = null;
};

const build = (row) => {
  const base = envDefaults();
  const out = { ...base };
  for (const f of BRANDING_FIELDS) {
    const v = row?.[f];
    // "" in the database means "not set" -> keep the default
    if (typeof v === "string" && v !== "") out[f] = v;
  }
  const cur = findCurrency(out.currencyCode) || findCurrency(DEFAULT_CURRENCY);
  out.currencyCode = cur.code;
  out.numberLocale = out.numberLocale || cur.locale;
  return out;
};

export const getCompanyProfile = async () => {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  let row = null;
  try {
    row = await CompanyProfile.findOne({ key: "main" }).lean();
  } catch {
    /* database hiccup: fall back to the .env defaults */
  }
  const value = build(row);
  cache = { value, expiresAt: Date.now() + TTL_MS };
  return value;
};

// "Rs. 1,00,000.00" — text for PDFs (their built-in fonts cannot draw ₹ and
// most other currency symbols, so the currency's PDF label is used).
export const formatMoney = (value, profile, decimals = 2) => {
  const cur = findCurrency(profile?.currencyCode) || findCurrency(DEFAULT_CURRENCY);
  const num = Number(value) || 0;
  let text;
  try {
    text = num.toLocaleString(profile?.numberLocale || cur.locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    text = num.toFixed(decimals);
  }
  const sep = /^[A-Za-z]{2,}\.?$/.test(cur.pdf) ? " " : "";
  return `${cur.pdf}${sep}${text}`;
};
