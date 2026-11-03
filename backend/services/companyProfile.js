// services/companyProfile.js
//
// The current company's white-label profile: name / logo / colours, contact
// details, country settings (currency, time zone, weekly off), registration
// numbers and document settings. Read from the in-memory company registry
// (services/companyRegistry.js), so it costs no database query. Anything a
// company has not filled in yet falls back to its country preset and then
// to the .env values.
import Company from "../models/Company.js";
import { DEFAULT_CURRENCY, findCurrency } from "../config/currencies.js";
import { DEFAULT_COUNTRY, findCountry } from "../config/countries.js";
import { getCompanyId, runUnscoped } from "../utils/tenant.js";
import {
  getRegisteredCompany,
  listRegisteredCompanies,
  companyWorkHours,
  companySaturdayRule,
} from "../utils/companyContext.js";
import { isOwnerCompany } from "../utils/ownerCompany.js";

// Text / choice fields the company profile form may change (super admin or
// the company's admin). Images (logo / signature / stamp) and legalIds are
// handled separately in the company controller.
export const PROFILE_FIELDS = [
  "name",
  "legalName",
  "nameAr",
  "shortName",
  "tagline",
  "logoUrl",
  "primaryColor",
  "sidebarColor",
  "loginTitle",
  "loginSubtitle",
  "financeTitle",
  "signatoryName",
  "signatoryTitle",
  "address",
  "city",
  "state",
  "postalCode",
  "phone",
  "email",
  "website",
  "country",
  "currencyCode",
  "numberLocale",
  "timeZone",
];

// Kept for older imports.
export const BRANDING_FIELDS = PROFILE_FIELDS;

const envDefaults = () => ({
  name: process.env.COMPANY_NAME || "HRM Portal",
  legalName: "",
  nameAr: "",
  shortName: process.env.COMPANY_SHORT_NAME || "",
  tagline: process.env.COMPANY_TAGLINE || "Manage staff, payroll, and attendance in one place.",
  logoUrl: process.env.COMPANY_LOGO_URL || "",
  primaryColor: process.env.COMPANY_PRIMARY_COLOR || "#2563eb",
  sidebarColor: process.env.COMPANY_SIDEBAR_COLOR || "#0b1220",
  loginTitle: process.env.COMPANY_LOGIN_TITLE || "HRM Portal",
  loginSubtitle:
    process.env.COMPANY_LOGIN_SUBTITLE ||
    "Access is limited to authorised personnel and is logged for security.",
  financeTitle: process.env.COMPANY_FINANCE_TITLE || "Finance Manager",
  signatoryName: "",
  signatoryTitle: "",
  address: "",
  city: "",
  state: "",
  postalCode: "",
  phone: "",
  email: "",
  website: "",
  country: DEFAULT_COUNTRY,
  currencyCode: "",
  numberLocale: "",
  timeZone: "",
});

/** Public URL of a company's uploaded logo (browsers cache it for long). */
export const logoPathFor = (company) =>
  company?._id && company.logoUpdatedAt
    ? `/api/company/logo/${company._id}?v=${new Date(company.logoUpdatedAt).getTime()}`
    : "";

/**
 * Builds the profile object the website, the mobile app and the PDFs use.
 * `baseUrl` (e.g. "https://api.example.com") turns an uploaded logo into a
 * full URL; without it the path starts with "/api/...".
 */
export const buildProfile = (row, { baseUrl = "" } = {}) => {
  const out = envDefaults();
  for (const f of PROFILE_FIELDS) {
    const v = row?.[f];
    if (typeof v === "string" && v !== "") out[f] = v;
  }
  // Look & feel (buttons, sidebar colour): a company that has not chosen its
  // own colours gets the OWNER company's (ZAP Solutionz) — so every company
  // starts with the same GUI as ZAP and changes it only when it wants to.
  const owner = listRegisteredCompanies().find(isOwnerCompany);
  for (const f of ["primaryColor", "sidebarColor"]) {
    const own = row?.[f];
    if (!(typeof own === "string" && own !== "") && typeof owner?.[f] === "string" && owner[f] !== "") {
      out[f] = owner[f];
    }
  }
  out.hasCustomTheme = !!(row?.primaryColor || row?.sidebarColor);
  // Internship / Probation on or off for this company (super admin setting).
  out.probationEnabled = row?.probationEnabled !== false;

  const country = findCountry(out.country) || findCountry(DEFAULT_COUNTRY);
  out.country = country.code;
  out.countryName = country.name;
  out.rtl = !!country.rtl;
  out.phoneCode = country.phoneCode;

  const cur =
    findCurrency(out.currencyCode) ||
    findCurrency(country.currencyCode) ||
    (process.env.COMPANY_CURRENCY && findCurrency(process.env.COMPANY_CURRENCY)) ||
    findCurrency(DEFAULT_CURRENCY);
  out.currencyCode = cur.code;
  out.numberLocale = out.numberLocale || country.numberLocale || cur.locale;
  out.timeZone = out.timeZone || country.timeZone;
  out.weeklyOffDays =
    Array.isArray(row?.weeklyOffDays) && row.weeklyOffDays.length
      ? row.weeklyOffDays
      : country.weeklyOffDays;

  // Working time (Settings → Work week & hours). Defaults: 10:00 – 18:30,
  // short Saturday 10:00 – 16:00 (only when Saturday is not a weekly off).
  const work = companyWorkHours(row);
  out.workStartTime = work.start;
  out.workEndTime = work.end;
  const sat = companySaturdayRule({ ...row, weeklyOffDays: out.weeklyOffDays });
  out.shortSaturday = row?.shortSaturday !== false; // the admin's switch
  out.shortSaturdayActive = sat.enabled; // false when Saturday is a weekly off
  out.saturdayStartTime = sat.start;
  out.saturdayEndTime = sat.end;

  // Uploaded logo -> served URL; an https logo URL is used as is.
  const uploaded = logoPathFor(row);
  if (uploaded) out.logoUrl = `${baseUrl}${uploaded}`;
  // true ONLY when the company itself set a logo (uploaded or its own https
  // link). Without it the website / app show the general product logo.
  out.hasCustomLogo = !!(uploaded || (typeof row?.logoUrl === "string" && row.logoUrl));
  if (!out.hasCustomLogo) out.logoUrl = "";
  out.isOwner = isOwnerCompany(row);

  // Registration numbers with their labels (in the country's order).
  const ids = row?.legalIds instanceof Map ? Object.fromEntries(row.legalIds) : row?.legalIds || {};
  out.legalIds = { ...ids };
  out.legalIdList = country.legalIds
    .filter((d) => ids[d.key])
    .map((d) => ({ key: d.key, label: d.label, value: ids[d.key], print: !!d.print }));

  out.hasSignature = !!row?.hasSignature;
  out.hasStamp = !!row?.hasStamp;

  if (row?._id) {
    out.companyId = String(row._id);
    out.slug = row.slug;
    out.isActive = row.isActive !== false;
  }
  return out;
};

/**
 * Profile of a company (default: the current request's company). Never
 * throws; with no company the .env defaults are returned (login page of a
 * site that has not picked a company).
 */
export const getCompanyProfile = async (companyId = getCompanyId(), opts = {}) =>
  buildProfile(getRegisteredCompany(companyId), opts);

/** Same, synchronous (for code that cannot await). */
export const getCompanyProfileSync = (companyId = getCompanyId(), opts = {}) =>
  buildProfile(getRegisteredCompany(companyId), opts);

// Kept so older callers still work: the registry is refreshed on save.
export const clearCompanyProfileCache = () => {};

// ── Images for PDFs (logo / signature / stamp) ────────────────────────────
// Kept out of the registry (they can be a few hundred KB each); loaded on
// demand and cached briefly per company.
const ASSET_TTL_MS = 5 * 60 * 1000;
const assetCache = new Map(); // companyId -> { at, version, value }

export const clearCompanyAssetCache = (companyId) => {
  if (companyId) assetCache.delete(String(companyId));
  else assetCache.clear();
};

/**
 * { logo: Buffer|null, logoDataUrl, signature: Buffer|null, stamp: Buffer|null }
 * for the given company (default: current). An https logo URL is not
 * downloaded here; PDFs then fall back to the company name.
 */
export const getCompanyAssets = async (companyId = getCompanyId()) => {
  if (!companyId) return { logo: null, logoDataUrl: "", signature: null, stamp: null };
  const key = String(companyId);
  const reg = getRegisteredCompany(key);
  const version = `${reg?.logoUpdatedAt || ""}|${reg?.assetsUpdatedAt || ""}`;
  const hit = assetCache.get(key);
  if (hit && hit.version === version && Date.now() - hit.at < ASSET_TTL_MS) return hit.value;

  const row = await runUnscoped(() =>
    Company.findById(key).select("+logoData +signatureData +stampData").lean(),
  ).catch(() => null);
  const toBuf = (dataUrl) => {
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(dataUrl || ""));
    return m ? Buffer.from(m[2], "base64") : null;
  };
  const value = {
    logo: toBuf(row?.logoData),
    logoDataUrl: row?.logoData || "",
    signature: toBuf(row?.signatureData),
    stamp: toBuf(row?.stampData),
  };
  if (assetCache.size > 200) assetCache.clear();
  assetCache.set(key, { at: Date.now(), version, value });
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
