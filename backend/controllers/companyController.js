// controllers/companyController.js
//
// White label / multi-company.
//
//   SUPER ADMIN                         creates a CLIENT company with a name +
//                                       country and gives its admin a one-time
//                                       invite link; activates / deactivates,
//                                       picks tabs, sets plan limits, deletes
//                                       empty ones. The super admin can NOT
//                                       edit a client company's profile, logo
//                                       or data. Inside the OWNER company
//                                       (ZAP Solutionz) the super admin can
//                                       edit everything.
//   COMPANY ADMIN                       fills in their own company: logo,
//   (with the "Settings" tab)           colours, address, registration / tax
//                                       numbers, signatory, signature, stamp,
//                                       currency, time zone, weekly off days,
//                                       then adds staff and everything else.
//   PUBLIC                              branding for the login page, logos.
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Company from "../models/Company.js";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import OfficeNetwork from "../models/OfficeNetwork.js";
import {
  PROFILE_FIELDS,
  buildProfile,
  clearCompanyAssetCache,
} from "../services/companyProfile.js";
import {
  refreshCompanyInRegistry,
  reloadCompanyRegistry,
} from "../services/companyRegistry.js";
import { getRegisteredCompany, listRegisteredCompanies } from "../utils/companyContext.js";
import { clearAuthUserCache } from "../middleware/auth.js";
import AdminInvite from "../models/AdminInvite.js";
import Branch from "../models/Branch.js";
import { findCompanyAdmin } from "../services/adminRules.js";
import { issueInvite, listInvites, revokeInvite, inviteShape, InviteError } from "../services/adminInvites.js";
import {
  TAB_TREE,
  COMPANY_TABS,
  CURRENT_TABS_VERSION,
  normalizeEnabledTabs,
  effectiveEnabledTabs,
  hasTabAccess,
} from "../config/permissions.js";
import { findCurrency, NUMBER_FORMATS } from "../config/currencies.js";
import { countryList, findCountry, isValidTimeZone, DEFAULT_COUNTRY } from "../config/countries.js";
import { runUnscoped, runWithCompany, getCompanyId } from "../utils/tenant.js";
import { isOwnerCompany, slugTakesOwnerIdentity } from "../utils/ownerCompany.js";
import {
  parseOfficeEntries,
  reloadOfficeNetworks,
  getClientIp,
  officeEntryForIp,
  isLoopbackIp,
  serverLanEntries,
} from "../utils/officeNetwork.js";

const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^(?=.{3,120}$)([a-z0-9-]+\.)+[a-z]{2,}$/;
const IMAGE_DATA = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i;
const PDF_IMAGE_DATA = /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/i;
const MAX_LOGO_CHARS = 600000; // ~450 KB image once base64 encoded
const MAX_SIGN_CHARS = 300000; // ~220 KB

const LIMITS = {
  name: 80,
  legalName: 160,
  nameAr: 160,
  shortName: 30,
  tagline: 160,
  loginTitle: 80,
  loginSubtitle: 200,
  financeTitle: 60,
  signatoryName: 80,
  signatoryTitle: 80,
  address: 300,
  city: 80,
  state: 80,
  postalCode: 20,
  phone: 40,
  email: 120,
  website: 120,
};

const bad = (res, message, status = 400, extra = {}) =>
  res.status(status).json({ success: false, message, ...extra });

const slugify = (v) =>
  String(v || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** "https://api.example.com" of this request (logo links must be absolute for the app). */
const baseUrlOf = (req) => `${req.protocol}://${req.get("host")}`;

// ── Reading the profile form ─────────────────────────────────────────────
/**
 * Validates every profile field present in `body`. Returns
 * { set, unset } (mongo update parts) or { error }. `current` is the
 * company as stored (used for the country of legal numbers).
 */
const readProfile = (body, current = {}) => {
  const set = {};
  const unset = {};
  const has = (k) => body[k] !== undefined;

  // Country first: it decides which registration numbers exist and fills
  // in currency / time zone / weekly off days that were not sent.
  let country = findCountry(current.country) || findCountry(DEFAULT_COUNTRY);
  if (has("country")) {
    const c = findCountry(body.country);
    if (!c) return { error: `Country "${body.country}" is not supported` };
    if (c.code !== current.country) {
      set.country = c.code;
      if (!has("currencyCode")) set.currencyCode = c.currencyCode;
      if (!has("numberLocale")) set.numberLocale = c.numberLocale;
      if (!has("timeZone")) set.timeZone = c.timeZone;
      if (!has("weeklyOffDays")) set.weeklyOffDays = c.weeklyOffDays;
    }
    country = c;
  }

  for (const field of PROFILE_FIELDS) {
    if (field === "country" || !has(field)) continue;
    const value = String(body[field] ?? "").trim();

    if (field === "name") {
      if (!value) return { error: "Company name is required" };
    } else if (field === "primaryColor" || field === "sidebarColor") {
      if (value && !HEX.test(value)) return { error: `${field} must be a hex colour like #2563eb` };
    } else if (field === "logoUrl") {
      // Uploaded image -> logoData; https link -> logoUrl; "" -> no logo.
      if (!value) {
        unset.logoUrl = 1;
        unset.logoData = 1;
        unset.logoUpdatedAt = 1;
      } else if (IMAGE_DATA.test(value)) {
        if (value.length > MAX_LOGO_CHARS) return { error: "Logo image is too large (max about 400 KB)" };
        set.logoData = value;
        set.logoUpdatedAt = new Date();
        unset.logoUrl = 1;
      } else if (/^https:\/\/\S+$/i.test(value) && value.length <= 1000) {
        // Re-sending our own served logo link changes nothing.
        if (/\/api\/company\/logo\//.test(value)) continue;
        set.logoUrl = value;
        unset.logoData = 1;
        unset.logoUpdatedAt = 1;
      } else {
        return { error: "Logo must be an https:// image link or an uploaded PNG / JPG / WebP image" };
      }
      continue;
    } else if (field === "currencyCode") {
      if (!value) return { error: "Please choose a currency" };
      const cur = findCurrency(value);
      if (!cur) return { error: `Currency "${value}" is not supported` };
      set.currencyCode = cur.code;
      continue;
    } else if (field === "numberLocale") {
      if (value && !NUMBER_FORMATS.some((f) => f.locale === value)) return { error: "Unknown number format" };
    } else if (field === "timeZone") {
      if (value && !isValidTimeZone(value)) return { error: `Unknown time zone "${value}"` };
    } else if (field === "email") {
      if (value && !EMAIL.test(value)) return { error: "Email address is not valid" };
    } else if (field === "website") {
      if (value && !/^(https?:\/\/)?[^\s]+\.[^\s]+$/i.test(value)) return { error: "Website is not valid" };
    }

    if (LIMITS[field] && value.length > LIMITS[field]) {
      return { error: `${field} must be at most ${LIMITS[field]} characters` };
    }
    if (value === "" && field !== "name") unset[field] = 1;
    else set[field] = value;
  }

  // Weekly off days: [0..6], 0 = Sunday.
  if (has("weeklyOffDays")) {
    const v = body.weeklyOffDays;
    if (!Array.isArray(v)) return { error: "weeklyOffDays must be a list of day numbers (0 = Sunday)" };
    const days = [...new Set(v.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
    if (days.length > 3) return { error: "At most 3 weekly off days" };
    set.weeklyOffDays = days.length ? days : country.weeklyOffDays;
  }

  // Working time (Settings → Work week & hours). "HH:mm", 24-hour.
  const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
  const timePair = (startKey, endKey, label) => {
    if (!has(startKey) && !has(endKey)) return null;
    const start = String(body[startKey] ?? current[startKey] ?? "").trim();
    const end = String(body[endKey] ?? current[endKey] ?? "").trim();
    if (!start && !end) {
      unset[startKey] = 1;
      unset[endKey] = 1;
      return null;
    }
    if (!HM.test(start) || !HM.test(end)) return `${label}: times must look like 09:30 (24-hour)`;
    if (toMin(end) - toMin(start) < 60) return `${label}: end time must be at least 1 hour after start time`;
    set[startKey] = start;
    set[endKey] = end;
    return null;
  };
  const workErr =
    timePair("workStartTime", "workEndTime", "Working hours") ||
    timePair("saturdayStartTime", "saturdayEndTime", "Saturday hours");
  if (workErr) return { error: workErr };
  if (has("shortSaturday")) set.shortSaturday = body.shortSaturday === true || body.shortSaturday === "true";

  // Registration / tax numbers of the company's country.
  if (has("legalIds")) {
    const input = body.legalIds && typeof body.legalIds === "object" ? body.legalIds : {};
    const ids = {};
    for (const def of country.legalIds) {
      const raw = String(input[def.key] ?? "").trim().toUpperCase().replace(/\s+/g, "");
      if (!raw) continue;
      if (raw.length > 40) return { error: `${def.label} is too long` };
      if (def.pattern && !new RegExp(def.pattern).test(raw)) {
        return { error: `${def.label} does not look right${def.hint ? ` (e.g. ${def.hint})` : ""}` };
      }
      ids[def.key] = raw;
    }
    set.legalIds = ids;
  }

  // Signature / stamp images for letters (PNG / JPG; "" removes).
  for (const [field, flag] of [
    ["signatureData", "hasSignature"],
    ["stampData", "hasStamp"],
  ]) {
    if (!has(field)) continue;
    const value = String(body[field] ?? "").trim();
    if (!value) {
      unset[field] = 1;
      set[flag] = false;
    } else {
      if (!PDF_IMAGE_DATA.test(value)) return { error: "Signature and stamp must be PNG or JPG images" };
      if (value.length > MAX_SIGN_CHARS) return { error: "Signature / stamp image is too large (max about 200 KB)" };
      set[field] = value;
      set[flag] = true;
    }
    set.assetsUpdatedAt = new Date();
  }

  for (const k of Object.keys(set)) delete unset[k];
  return { set, unset };
};

// ── Super-admin-only fields ──────────────────────────────────────────────
const readAdminFields = (body) => {
  const set = {};
  const unset = {};
  if (body.slug !== undefined) {
    const slug = slugify(body.slug);
    if (!slug) return { error: "Invalid link name" };
    set.slug = slug;
  }
  if (body.isActive !== undefined) set.isActive = Boolean(body.isActive);
  if (body.maxStaff !== undefined) {
    if (body.maxStaff === null || body.maxStaff === "") unset.maxStaff = 1;
    else {
      const n = Number(body.maxStaff);
      if (!Number.isInteger(n) || n < 1 || n > 100000) return { error: "Staff limit must be a whole number" };
      set.maxStaff = n;
    }
  }
  if (body.customDomain !== undefined) {
    const d = String(body.customDomain || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    if (!d) unset.customDomain = 1;
    else if (!DOMAIN.test(d)) return { error: "Custom domain is not valid (e.g. hr.yourcompany.com)" };
    else set.customDomain = d;
  }
  if (body.enabledTabs !== undefined) {
    const v = body.enabledTabs;
    if (v === null || v === "all") unset.enabledTabs = 1;
    else if (!Array.isArray(v)) return { error: "enabledTabs must be a list of tab keys" };
    else {
      set.enabledTabs = normalizeEnabledTabs(v);
      set.tabsVersion = CURRENT_TABS_VERSION; // saved with the full list
    }
  }
  if (body.probationEnabled !== undefined) set.probationEnabled = body.probationEnabled !== false;
  return { set, unset };
};

// ── Office Wi-Fi of a company (super admin form) ─────────────────────────
const syncOfficeNetworks = (companyId, entries, userId) =>
  runWithCompany(companyId, async () => {
    const existing = await OfficeNetwork.find().lean();
    const keep = new Set(entries);
    const stale = existing.filter((r) => !keep.has(r.ip)).map((r) => r._id);
    if (stale.length) await OfficeNetwork.deleteMany({ _id: { $in: stale } });
    const have = new Set(existing.map((r) => r.ip));
    const kept = entries.filter((e) => have.has(e));
    if (kept.length) await OfficeNetwork.updateMany({ ip: { $in: kept } }, { $set: { enabled: true } });
    for (const ip of entries) {
      if (!have.has(ip)) await OfficeNetwork.create({ ip, name: "Office Wi-Fi", enabled: true, addedBy: userId });
    }
    await reloadOfficeNetworks();
  });

// ── Shapes ───────────────────────────────────────────────────────────────
const listShape = (c, counts, req) => {
  const p = buildProfile(c, { baseUrl: baseUrlOf(req) });
  return {
    _id: c._id,
    name: c.name,
    slug: c.slug,
    isActive: c.isActive !== false,
    // The owner company (ZAP Solutionz) is the only one the super admin can open / edit.
    isOwner: isOwnerCompany(c),
    hasCustomLogo: p.hasCustomLogo,
    country: p.country,
    countryName: p.countryName,
    currencyCode: p.currencyCode,
    timeZone: p.timeZone,
    weeklyOffDays: p.weeklyOffDays,
    workStartTime: p.workStartTime,
    workEndTime: p.workEndTime,
    shortSaturday: p.shortSaturday,
    saturdayStartTime: p.saturdayStartTime,
    saturdayEndTime: p.saturdayEndTime,
    logoUrl: p.logoUrl,
    primaryColor: p.primaryColor,
    sidebarColor: p.sidebarColor,
    shortName: c.shortName || "",
    customDomain: c.customDomain || "",
    maxStaff: c.maxStaff ?? null,
    enabledTabs: effectiveEnabledTabs(c),
    tabsVersion: c.tabsVersion || 1,
    probationEnabled: c.probationEnabled !== false,
    createdAt: c.createdAt,
    staffCount: counts?.staff ?? 0,
    adminCount: counts?.admin ?? 0,
    officeNetworks: counts?.officeNetworks ?? [],
    // How complete the profile is (shown on the company card).
    profileComplete: profileCompleteness(c),
  };
};

const profileCompleteness = (c) => {
  const checks = [
    !!(c.logoUrl || c.logoUpdatedAt),
    !!c.address,
    !!c.phone,
    !!c.email,
    !!(c.legalIds && Object.keys(c.legalIds instanceof Map ? Object.fromEntries(c.legalIds) : c.legalIds).length),
    !!c.signatoryName,
    !!(c.primaryColor || c.sidebarColor),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
};

// ── Public ───────────────────────────────────────────────────────────────

// GET /api/company/countries  (public) — presets for the forms.
export const getCountries = (req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.json({ success: true, data: countryList(), defaultCountry: DEFAULT_COUNTRY });
};

/**
 * Which company a PUBLIC request is about (login page, /api/settings):
 * ?company=<slug>, ?id=, X-Company-Id header, a login token, or the
 * site's own domain (company.customDomain). Returns an id or null.
 */
export const resolvePublicCompanyId = async (req) => {
  const slug = String(req.query.company || req.query.slug || "").toLowerCase().trim();
  if (slug) {
    const hit = listRegisteredCompanies().find((c) => c.slug === slug);
    if (hit) return String(hit._id);
  }
  const id = String(req.query.id || req.get("x-company-id") || "").trim();
  if (mongoose.isValidObjectId(id) && getRegisteredCompany(id)) return id;

  // A logged-in caller: their own company (the token is only decoded, the
  // data returned is public branding anyway).
  const auth = req.get("authorization") || "";
  if (auth.startsWith("Bearer ")) {
    try {
      const { default: jwt } = await import("jsonwebtoken");
      const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
      const user = await runUnscoped(() => User.findById(decoded.id).select("company").lean());
      if (user?.company) return String(user.company);
    } catch {
      /* not logged in / expired -> fall through */
    }
  }

  const host = String(req.query.host || req.get("x-forwarded-host") || req.get("origin") || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[:/].*$/, "");
  if (host) {
    const byDomain = listRegisteredCompanies().find((c) => c.customDomain && c.customDomain === host);
    if (byDomain) return String(byDomain._id);
  }

  // Only one company: it is the one.
  const all = listRegisteredCompanies();
  return all.length === 1 ? String(all[0]._id) : null;
};

// GET /api/company/branding?company=acme  (public)
export const getBranding = async (req, res) => {
  try {
    const companyId = await resolvePublicCompanyId(req);
    const profile = buildProfile(getRegisteredCompany(companyId), { baseUrl: baseUrlOf(req) });
    res.set("Cache-Control", "no-cache");
    res.set("Vary", "Authorization, X-Company-Id, Origin");
    res.json({ success: true, data: publicBranding(profile) });
  } catch {
    res.status(500).json({ success: false, message: "Could not load branding" });
  }
};

// Login page only needs the look, not the registration numbers.
const publicBranding = (p) => {
  const { legalIds: _ids, legalIdList: _list, ...rest } = p;
  return rest;
};

// GET /api/company/logo/:id?v=  (public) — the uploaded logo image.
export const getLogo = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
    const row = await runUnscoped(() =>
      Company.findById(req.params.id).select("+logoData logoUpdatedAt").lean(),
    );
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(row?.logoData || "");
    if (!m) return res.status(404).end();
    const etag = `"logo-${row._id}-${new Date(row.logoUpdatedAt || 0).getTime()}"`;
    // The URL changes (?v=) whenever the logo changes, so it can be cached for long.
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.set("ETag", etag);
    // helmet blocks cross-origin images by default; the website runs on another origin.
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    if (req.get("if-none-match") === etag) return res.status(304).end();
    res.type(m[1]).send(Buffer.from(m[2], "base64"));
  } catch {
    res.status(404).end();
  }
};

// ── Company profile (admin of the company, or super admin) ───────────────

// The super admin can view a client company's profile but not change it.
const canEditProfile = (req) =>
  !(req.user?.role === "super-admin" && !isOwnerCompany(req.company)) &&
  hasTabAccess(req.user, "settings", req.company);

// GET /api/company/profile — the full profile of the current company.
export const getMyProfile = async (req, res) => {
  const companyId = getCompanyId();
  if (!companyId) return bad(res, "Open a company first.", 400, { code: "COMPANY_REQUIRED" });
  const company = getRegisteredCompany(companyId);
  const profile = buildProfile(company, { baseUrl: baseUrlOf(req) });
  const country = findCountry(profile.country);
  res.json({
    success: true,
    data: {
      ...profile,
      // Editable raw values (the form shows "not set" instead of defaults).
      raw: Object.fromEntries(PROFILE_FIELDS.map((f) => [f, company?.[f] || ""])),
      legalIdFields: country.legalIds,
      canEdit: canEditProfile(req),
      isSuperAdmin: req.user.role === "super-admin",
      // super admin only (shown read-only to the company admin)
      maxStaff: company?.maxStaff ?? null,
      customDomain: company?.customDomain || "",
    },
  });
};

// PUT /api/company/profile  (and PUT /api/settings)
export const updateMyProfile = async (req, res) => {
  try {
    const companyId = getCompanyId();
    if (!companyId) return bad(res, "Open a company first.", 400, { code: "COMPANY_REQUIRED" });
    if (!canEditProfile(req)) {
      return bad(res, "You don't have permission to change the company profile", 403, { code: "TAB_FORBIDDEN" });
    }
    const current = getRegisteredCompany(companyId) || {};
    const body = req.body || {};
    const { set, unset, error } = readProfile(body, current);
    if (error) return bad(res, error);
    if (!Object.keys(set).length && !Object.keys(unset).length) return bad(res, "Nothing to save");

    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    await runUnscoped(() => Company.updateOne({ _id: companyId }, update, { runValidators: true }));

    clearCompanyAssetCache(companyId);
    const fresh = await refreshCompanyInRegistry(companyId);
    res.json({
      success: true,
      message: "Company profile saved",
      data: buildProfile(fresh, { baseUrl: baseUrlOf(req) }),
    });
  } catch (err) {
    console.error("updateMyProfile failed:", err.message);
    bad(res, err.name === "ValidationError" ? err.message : "Could not save the company profile", err.name === "ValidationError" ? 400 : 500);
  }
};

// ── Super admin: company management ──────────────────────────────────────

// GET /api/company
export const listCompanies = async (req, res) => {
  try {
    const { companies, staffCounts, adminCounts, networks } = await runUnscoped(async () => {
      const [companies, networks, staffCounts, adminCounts] = await Promise.all([
        Company.find().sort({ createdAt: 1 }).lean(),
        OfficeNetwork.find({ enabled: { $ne: false }, learned: { $ne: true } }).select("ip company").lean(),
        Staff.aggregate([{ $group: { _id: "$company", n: { $sum: 1 } } }]),
        User.aggregate([{ $match: { role: "admin", branch: null } }, { $group: { _id: "$company", n: { $sum: 1 } } }]),
      ]);
      return { companies, staffCounts, adminCounts, networks };
    });
    const netBy = new Map();
    for (const n of networks) {
      const k = String(n.company);
      if (!netBy.has(k)) netBy.set(k, []);
      netBy.get(k).push(n.ip);
    }
    const staffBy = new Map(staffCounts.map((r) => [String(r._id), r.n]));
    const adminBy = new Map(adminCounts.map((r) => [String(r._id), r.n]));
    res.json({
      success: true,
      tabTree: TAB_TREE,
      companyTabs: COMPANY_TABS,
      countries: countryList(),
      data: companies.map((c) =>
        listShape(
          c,
          {
            staff: staffBy.get(String(c._id)) || 0,
            admin: adminBy.get(String(c._id)) || 0,
            officeNetworks: netBy.get(String(c._id)) || [],
          },
          req,
        ),
      ),
    });
  } catch (err) {
    console.error("listCompanies failed:", err.message);
    bad(res, "Could not load companies", 500);
  }
};

// POST /api/company  { name, country, slug?, inviteAdmin?: true, ...profile }
// The company's admin is NOT created here with a typed password any more: tick
// `inviteAdmin` (or use POST /:id/admin-invites later) to get a one-time link
// that the future admin opens to create their own login.
export const createCompany = async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name) return bad(res, "Company name is required");
    if (name.length > 80) return bad(res, "Company name must be at most 80 characters");
    const slug = slugify(body.slug || name);
    if (!slug) return bad(res, "Could not make a link name from this company name");
    if (listRegisteredCompanies().some((c) => c.slug === slug)) {
      return bad(res, `The link name "${slug}" is already used by another company`, 409);
    }
    // A new company can never take the owner company's name (it would get the
    // super admin's full edit access that only ZAP Solutionz has).
    if (slugTakesOwnerIdentity(slug) && listRegisteredCompanies().some(isOwnerCompany)) {
      return bad(res, `The link name "${slug}" is reserved for the owner company. Choose another one.`, 400);
    }

    const country = findCountry(body.country || DEFAULT_COUNTRY);
    if (!country) return bad(res, `Country "${body.country}" is not supported`);

    // The super admin only sets the basics (name, country, link name) and the
    // plan (tabs / staff limit / domain). Logo, address, legal numbers, Wi-Fi
    // and the rest are filled in later by the company's own admin.
    const { name: _n, slug: _s, country: _c, ...rest } = body;
    const prof = { set: {}, unset: {} };
    const adm = readAdminFields({ ...rest, slug: undefined });
    if (adm.error) return bad(res, adm.error);

    // Office Wi-Fi is the company's own business — only the owner company's
    // can be set here.
    const ownerNew = isOwnerCompany({ slug }) && !listRegisteredCompanies().some(isOwnerCompany);
    const wifi =
      !ownerNew || body.officeNetworks === undefined
        ? { entries: undefined }
        : parseOfficeEntries(body.officeNetworks);
    if (wifi.error) return bad(res, wifi.error);

    const company = await runUnscoped(() =>
      Company.create({
        // country preset first, then whatever the form sent
        currencyCode: country.currencyCode,
        numberLocale: country.numberLocale,
        timeZone: country.timeZone,
        weeklyOffDays: country.weeklyOffDays,
        ...prof.set,
        ...adm.set,
        name,
        slug,
        country: country.code,
        createdBy: req.user._id,
      }),
    );

    let inviteResult = null;
    try {
      if (body.inviteAdmin) {
        inviteResult = await issueInvite({
          type: "company-admin",
          company: company._id,
          email: body.inviteEmail,
          days: body.inviteDays,
          createdBy: req.user._id,
        });
      }
      if (wifi.entries?.length) await syncOfficeNetworks(company._id, wifi.entries, req.user._id);
    } catch (err) {
      // Never leave half a company behind.
      await runUnscoped(() => Company.deleteOne({ _id: company._id }));
      await AdminInvite.deleteMany({ company: company._id });
      throw err;
    }

    await refreshCompanyInRegistry(company._id);
    res.status(201).json({
      success: true,
      message: inviteResult ? "Company created. Send the admin invite link to its admin." : "Company created",
      data: listShape(company.toObject(), { admin: 0, officeNetworks: wifi.entries || [] }, req),
      // Shown once — the plain token is not stored.
      invite: inviteResult ? { token: inviteResult.token, ...inviteShape(inviteResult.invite) } : null,
    });
  } catch (err) {
    if (err instanceof InviteError) return bad(res, err.message, err.status);
    if (err.code === 11000) return bad(res, "A company with this link name or domain already exists", 409);
    console.error("createCompany failed:", err.message);
    bad(res, err.name === "ValidationError" ? err.message : "Could not create the company", err.name === "ValidationError" ? 400 : 500);
  }
};

// PUT /api/company/:id  — any profile field + slug / active / tabs / limits / domain.
export const updateCompany = async (req, res) => {
  try {
    const current = await runUnscoped(() => Company.findById(req.params.id).lean());
    if (!current) return bad(res, "Company not found", 404);
    const body = req.body || {};
    const owner = isOwnerCompany(current);
    // A client company can not be renamed into the owner company's link name.
    if (!owner && body.slug !== undefined && slugTakesOwnerIdentity(slugify(body.slug))) {
      return bad(res, "This link name is reserved for the owner company. Choose another one.", 400);
    }

    let prof = { set: {}, unset: {} };
    let wifi = { entries: undefined };
    if (owner) {
      prof = readProfile(body, current);
      if (prof.error) return bad(res, prof.error);
      wifi = body.officeNetworks === undefined ? { entries: undefined } : parseOfficeEntries(body.officeNetworks);
      if (wifi.error) return bad(res, wifi.error);
    } else {
      // CLIENT company: the super admin may only change the plan side
      // (link name, active, tabs, staff limit, domain). Any real change to the
      // company's own details is refused — its admin does that.
      const sameText = (k) => String(body[k] ?? "").trim() === String(current[k] ?? "").trim();
      const touched = [...PROFILE_FIELDS.filter((k) => body[k] !== undefined && !sameText(k))];
      for (const k of ["legalIds", "weeklyOffDays", "workStartTime", "workEndTime", "shortSaturday", "saturdayStartTime", "saturdayEndTime", "signatureData", "stampData"]) {
        if (body[k] !== undefined) touched.push(k);
      }
      if (touched.length) {
        return bad(
          res,
          "Only this company's admin can change its details (logo, address, registration numbers, staff...). Send the admin an invite link instead.",
          403,
          { code: "OWNER_COMPANY_ONLY", fields: touched },
        );
      }
    }
    const adm = readAdminFields(body);
    if (adm.error) return bad(res, adm.error);
    // The owner company can never be switched off from here.
    if (owner && adm.set.isActive === false) return bad(res, "The owner company cannot be deactivated", 400);

    const set = { ...prof.set, ...adm.set };
    const unset = { ...prof.unset, ...adm.unset };
    for (const k of Object.keys(set)) delete unset[k];
    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (Object.keys(update).length) {
      await runUnscoped(() => Company.updateOne({ _id: current._id }, update, { runValidators: true }));
    }
    if (wifi.entries) await syncOfficeNetworks(current._id, wifi.entries, req.user._id);

    // Internship & Probation switched OFF: confirm everyone still in
    // Internship / Probation from their joining date right away.
    if (set.probationEnabled === false && current.probationEnabled !== false) {
      await runWithCompany(current._id, () =>
        Staff.updateMany({ status: { $in: ["Internship", "Probation"] } }, [
          {
            $set: {
              status: "Confirmation",
              confirmationDate: "$date",
              internshipEndDate: null,
              probationEndDate: null,
            },
          },
        ]),
      );
    }

    clearCompanyAssetCache(current._id);
    clearAuthUserCache();
    const fresh = await refreshCompanyInRegistry(current._id);
    const officeNetworks = (
      await runWithCompany(current._id, () =>
        OfficeNetwork.find({ enabled: { $ne: false }, learned: { $ne: true } }).select("ip").lean(),
      )
    ).map((r) => r.ip);
    res.json({ success: true, message: "Company updated", data: listShape(fresh, { officeNetworks }, req) });
  } catch (err) {
    if (err.code === 11000) return bad(res, "A company with this link name or domain already exists", 409);
    console.error("updateCompany failed:", err.message);
    bad(res, err.name === "ValidationError" ? err.message : "Could not update the company", err.name === "ValidationError" ? 400 : 500);
  }
};

// GET /api/company/:id/admins — the company's admin and its branch admins.
export const listCompanyAdmins = async (req, res) => {
  try {
    const rows = await runUnscoped(() =>
      User.find({ company: req.params.id, role: "admin" })
        .select("name firstName lastName email isActive lastLogin createdAt branch")
        .sort({ createdAt: 1 })
        .lean(),
    );
    const branchIds = rows.map((r) => r.branch).filter(Boolean);
    const branches = branchIds.length
      ? await runUnscoped(() => Branch.find({ _id: { $in: branchIds } }).select("name").lean())
      : [];
    const nameBy = new Map(branches.map((b) => [String(b._id), b.name]));
    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, scope: r.branch ? "branch" : "company", branchName: r.branch ? nameBy.get(String(r.branch)) || "" : "" })),
    });
  } catch {
    bad(res, "Could not load admins", 500);
  }
};

// GET /api/company/:id/admin-invites — recent links for the company's admin.
export const listCompanyAdminInvites = async (req, res) => {
  try {
    const rows = await listInvites({ type: "company-admin", company: req.params.id });
    res.json({ success: true, data: rows.map(inviteShape), hasAdmin: !!(await findCompanyAdmin(req.params.id)) });
  } catch {
    bad(res, "Could not load invite links", 500);
  }
};

// POST /api/company/:id/admin-invites  { email?, days? }
// One-time link: whoever opens it creates THE admin login of this company.
// Refused while the company already has an admin.
export const createCompanyAdminInvite = async (req, res) => {
  try {
    const company = getRegisteredCompany(req.params.id) || (await refreshCompanyInRegistry(req.params.id));
    if (!company) return bad(res, "Company not found", 404);
    const { token, invite } = await issueInvite({
      type: "company-admin",
      company: company._id,
      email: req.body?.email,
      days: req.body?.days,
      note: req.body?.note,
      createdBy: req.user._id,
    });
    res.status(201).json({
      success: true,
      message: `Invite link created for ${company.name}. Send it to its admin.`,
      token, // shown once — only the hash is stored
      data: inviteShape(invite),
    });
  } catch (err) {
    if (err instanceof InviteError) return bad(res, err.message, err.status);
    console.error("createCompanyAdminInvite failed:", err.message);
    bad(res, "Could not create the invite link", 500);
  }
};

// DELETE /api/company/:id/admin-invites/:inviteId
export const cancelCompanyAdminInvite = async (req, res) => {
  try {
    const ok = await revokeInvite({ inviteId: req.params.inviteId, type: "company-admin", company: req.params.id });
    if (!ok) return bad(res, "That link is already used or cancelled", 404);
    res.json({ success: true, message: "Invite link cancelled" });
  } catch {
    bad(res, "Could not cancel the link", 500);
  }
};

// DELETE /api/company/:id — only a company with no staff and no logins.
export const deleteCompany = async (req, res) => {
  try {
    const result = await runUnscoped(async () => {
      const company = await Company.findById(req.params.id).lean();
      if (!company) return { notFound: true };
      if (isOwnerCompany(company)) return { owner: true };
      const [staff, users] = await Promise.all([
        Staff.countDocuments({ company: company._id }),
        User.countDocuments({ company: company._id }),
      ]);
      if (staff || users) return { staff, users };
      await OfficeNetwork.deleteMany({ company: company._id });
      await AdminInvite.deleteMany({ company: company._id });
      await Branch.deleteMany({ company: company._id });
      await Company.deleteOne({ _id: company._id });
      return { ok: true };
    });
    if (result.notFound) return bad(res, "Company not found", 404);
    if (result.owner) return bad(res, "The owner company cannot be deleted", 400);
    if (!result.ok) {
      return bad(
        res,
        `This company still has ${result.staff} staff and ${result.users} logins. Deactivate it instead, or remove its data first.`,
        409,
      );
    }
    await reloadCompanyRegistry();
    await reloadOfficeNetworks();
    res.json({ success: true, message: "Company deleted" });
  } catch {
    bad(res, "Could not delete company", 500);
  }
};

// GET /api/company/my-network  (super admin) — this computer's network
// address, so "Add company" can fill in the office Wi-Fi.
export const getMyNetwork = (req, res) => {
  const ip = getClientIp(req);
  const onServerPc = isLoopbackIp(ip);
  res.json({ success: true, ip, entries: onServerPc ? serverLanEntries() : [officeEntryForIp(ip)] });
};


// POST /api/company/:id/login-link  (super admin)
// Makes a short-lived signed link for THE company's admin. Opening it fills
// that admin's e-mail and password in on the login page (see
// GET /api/auth/login-link/:token). Valid for LOGIN_LINK_TTL (default 24h).
export const createCompanyLoginLink = async (req, res) => {
  try {
    const company = await runUnscoped(() => Company.findById(req.params.id).select("slug isActive name").lean());
    if (!company) return bad(res, "Company not found", 404);
    const admin = await runUnscoped(() =>
      User.findOne({ company: company._id, role: "admin", branch: null })
        .select("+passwordEncrypted email isActive")
        .lean(),
    );
    if (!admin) {
      return bad(res, "This company has no admin yet. Send the admin invite link first.", 404, {
        code: "NO_COMPANY_ADMIN",
      });
    }
    const ttl = process.env.LOGIN_LINK_TTL || "24h";
    const token = jwt.sign(
      { purpose: "company-admin-login-link", uid: String(admin._id), cid: String(company._id) },
      process.env.JWT_SECRET,
      { expiresIn: ttl },
    );
    const { exp } = jwt.decode(token);
    res.json({
      success: true,
      data: {
        token,
        slug: company.slug,
        adminEmail: admin.email,
        hasPassword: Boolean(admin.passwordEncrypted),
        expiresAt: new Date(exp * 1000).toISOString(),
      },
    });
  } catch (err) {
    console.error("createCompanyLoginLink failed:", err.message);
    bad(res, "Could not make the login link", 500);
  }
};
