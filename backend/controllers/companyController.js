import mongoose from "mongoose";
import Company from "../models/Company.js";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import {
  BRANDING_FIELDS,
  clearCompanyProfileCache,
  getCompanyProfile,
} from "../services/companyProfile.js";
import { clearCompanyCache } from "../middleware/auth.js";
import { TAB_TREE, normalizeEnabledTabs } from "../config/permissions.js";
import OfficeNetwork from "../models/OfficeNetwork.js";
import { runUnscoped, runWithCompany, getCompanyId } from "../utils/tenant.js";
import {
  parseOfficeEntries,
  reloadOfficeNetworks,
  getClientIp,
  officeEntryForIp,
  isLoopbackIp,
  serverLanEntries,
} from "../utils/officeNetwork.js";

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_LOGO_CHARS = 600000; // ~450 KB image once base64 encoded

const LIMITS = {
  name: 80,
  shortName: 30,
  tagline: 160,
  loginTitle: 80,
  loginSubtitle: 200,
  financeTitle: 60,
};

const slugify = (v) =>
  String(v || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

// Validates the branding fields present in `body` and returns { update } or
// { error }. Shared by create, edit and the "my branding" endpoint.
const readBranding = (body) => {
  const update = {};
  for (const field of BRANDING_FIELDS) {
    if (body[field] === undefined) continue;
    const value = String(body[field] ?? "").trim();

    if (field === "primaryColor" || field === "sidebarColor") {
      if (value && !HEX.test(value)) {
        return { error: `${field} must be a hex colour like #2563eb` };
      }
    } else if (field === "logoUrl") {
      if (value) {
        const okUrl = /^https:\/\/\S+$/i.test(value);
        const okData = /^data:image\/(png|jpe?g|webp|svg\+xml|gif);base64,/i.test(value);
        if (!okUrl && !okData) {
          return { error: "Logo must be an https:// image URL or an uploaded image" };
        }
        if (value.length > MAX_LOGO_CHARS) {
          return { error: "Logo image is too large (max about 400 KB)" };
        }
      }
    } else if (LIMITS[field] && value.length > LIMITS[field]) {
      return { error: `${field} must be at most ${LIMITS[field]} characters` };
    }
    update[field] = value;
  }
  return { update };
};

// Makes the company's office Wi-Fi list exactly `entries` (add new, remove
// the ones no longer listed). Runs inside the company, so rows are stamped
// with it and can never touch another company's list.
const syncOfficeNetworks = (companyId, entries, userId) =>
  runWithCompany(companyId, async () => {
    const existing = await OfficeNetwork.find().lean();
    const keep = new Set(entries);
    const stale = existing.filter((r) => !keep.has(r.ip)).map((r) => r._id);
    if (stale.length) await OfficeNetwork.deleteMany({ _id: { $in: stale } });
    const have = new Set(existing.map((r) => r.ip));
    const kept = entries.filter((e) => have.has(e));
    if (kept.length) {
      await OfficeNetwork.updateMany({ ip: { $in: kept } }, { $set: { enabled: true } });
    }
    for (const ip of entries) {
      if (!have.has(ip)) {
        await OfficeNetwork.create({ ip, name: "Office Wi-Fi", enabled: true, addedBy: userId });
      }
    }
    await reloadOfficeNetworks();
  });

// Reads `officeNetworks` (array or comma / newline separated text) from the
// body. Returns { entries } (undefined = not sent, leave as is) or { error }.
const readOfficeNetworks = (body) => {
  if (body?.officeNetworks === undefined) return { entries: undefined };
  return parseOfficeEntries(body.officeNetworks);
};

// Reads `enabledTabs` from the body: an array of tab keys, or null / "all"
// for every tab. Returns { tabs } where tabs is undefined (not sent), null
// (all tabs) or a clean array.
const readEnabledTabs = (body) => {
  const v = body?.enabledTabs;
  if (v === undefined) return { tabs: undefined };
  if (v === null || v === "all") return { tabs: null };
  if (!Array.isArray(v)) return { error: "enabledTabs must be a list of tab keys" };
  return { tabs: normalizeEnabledTabs(v) };
};

const shape = (c, counts) => ({
  _id: c._id,
  name: c.name,
  slug: c.slug,
  isActive: c.isActive !== false,
  shortName: c.shortName || "",
  tagline: c.tagline || "",
  logoUrl: c.logoUrl || "",
  primaryColor: c.primaryColor || "",
  sidebarColor: c.sidebarColor || "",
  loginTitle: c.loginTitle || "",
  loginSubtitle: c.loginSubtitle || "",
  financeTitle: c.financeTitle || "",
  createdAt: c.createdAt,
  staffCount: counts?.staff ?? 0,
  adminCount: counts?.admin ?? 0,
  officeNetworks: counts?.officeNetworks ?? [],
  // null = this company has every tab
  enabledTabs: Array.isArray(c.enabledTabs) ? c.enabledTabs : null,
});

// GET /api/company/branding?slug=acme  (public — the login page needs it before login)
// Which company: ?slug=, ?id= or the X-Company-Id header. With none of them
// the .env defaults are returned.
export const getBranding = async (req, res) => {
  try {
    let companyId = null;
    const slug = String(req.query.slug || "").toLowerCase().trim();
    const id = String(req.query.id || req.headers["x-company-id"] || "").trim();
    if (slug) {
      const c = await runUnscoped(() => Company.findOne({ slug }).select("_id").lean());
      companyId = c?._id || null;
    } else if (mongoose.isValidObjectId(id)) {
      companyId = id;
    }
    const profile = await getCompanyProfile(companyId);
    // Short browser cache so the login page paints fast; edits show up within a minute.
    res.set("Cache-Control", "public, max-age=60");
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not load branding" });
  }
};

// PUT /api/company/branding   (super admin, with a company selected)
export const updateBranding = async (req, res) => {
  try {
    const companyId = getCompanyId();
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "Select a company first.",
        code: "COMPANY_REQUIRED",
      });
    }
    const { update, error } = readBranding(req.body || {});
    if (error) return res.status(400).json({ success: false, message: error });
    // The company name is edited through PUT /api/company/:id; branding
    // "name" is the same field.
    if (update.name === "") delete update.name;
    await runUnscoped(() => Company.findByIdAndUpdate(companyId, { $set: update }));
    clearCompanyProfileCache();
    clearCompanyCache();
    const profile = await getCompanyProfile(companyId);
    res.json({ success: true, message: "Branding updated", data: profile });
  } catch (err) {
    console.error("updateBranding failed:", err.message);
    res.status(500).json({ success: false, message: "Could not save branding" });
  }
};

// GET /api/company   (super admin) — every company with its staff count.
export const listCompanies = async (req, res) => {
  try {
    const { companies, staffCounts, adminCounts, networks } = await runUnscoped(async () => {
      const companies = await Company.find().sort({ createdAt: 1 }).lean();
      const networks = await OfficeNetwork.find({ enabled: { $ne: false } })
        .sort({ createdAt: 1 })
        .select("ip company")
        .lean();
      const staffCounts = await Staff.aggregate([{ $group: { _id: "$company", n: { $sum: 1 } } }]);
      const adminCounts = await User.aggregate([
        { $match: { role: "admin" } },
        { $group: { _id: "$company", n: { $sum: 1 } } },
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
      data: companies.map((c) =>
        shape(c, {
          staff: staffBy.get(String(c._id)) || 0,
          admin: adminBy.get(String(c._id)) || 0,
          officeNetworks: netBy.get(String(c._id)) || [],
        }),
      ),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not load companies" });
  }
};

// POST /api/company   (super admin) { name, slug?, ...branding }
export const createCompany = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Company name is required" });
    if (name.length > 80) {
      return res.status(400).json({ success: false, message: "Company name must be at most 80 characters" });
    }
    const slug = slugify(req.body?.slug || name);
    if (!slug) return res.status(400).json({ success: false, message: "Could not make a link name from this company name" });

    const { update, error } = readBranding(req.body || {});
    if (error) return res.status(400).json({ success: false, message: error });
    delete update.name;

    const wifi = readOfficeNetworks(req.body);
    if (wifi.error) return res.status(400).json({ success: false, message: wifi.error });
    const tabs = readEnabledTabs(req.body);
    if (tabs.error) return res.status(400).json({ success: false, message: tabs.error });
    if (Array.isArray(tabs.tabs)) update.enabledTabs = tabs.tabs;

    const company = await runUnscoped(() => Company.create({ ...update, name, slug }));
    if (wifi.entries?.length) await syncOfficeNetworks(company._id, wifi.entries, req.user._id);
    clearCompanyProfileCache();
    res.status(201).json({
      success: true,
      message: "Company added",
      data: shape(company.toObject(), { officeNetworks: wifi.entries || [] }),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A company with this link name already exists" });
    }
    console.error("createCompany failed:", err.message);
    res.status(500).json({ success: false, message: "Could not add company" });
  }
};

// PUT /api/company/:id   (super admin) — name, link name, active flag, branding.
export const updateCompany = async (req, res) => {
  try {
    const { update, error } = readBranding(req.body || {});
    if (error) return res.status(400).json({ success: false, message: error });
    delete update.name;

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name || name.length > 80) {
        return res.status(400).json({ success: false, message: "Company name is required (max 80 characters)" });
      }
      update.name = name;
    }
    if (req.body?.slug !== undefined) {
      const slug = slugify(req.body.slug);
      if (!slug) return res.status(400).json({ success: false, message: "Invalid link name" });
      update.slug = slug;
    }
    if (req.body?.isActive !== undefined) update.isActive = Boolean(req.body.isActive);

    const wifi = readOfficeNetworks(req.body);
    if (wifi.error) return res.status(400).json({ success: false, message: wifi.error });
    const tabs = readEnabledTabs(req.body);
    if (tabs.error) return res.status(400).json({ success: false, message: tabs.error });

    const change = { $set: update };
    if (Array.isArray(tabs.tabs)) update.enabledTabs = tabs.tabs;
    else if (tabs.tabs === null) change.$unset = { enabledTabs: 1 }; // back to "all tabs"

    const company = await runUnscoped(() =>
      Company.findByIdAndUpdate(req.params.id, change, { new: true, runValidators: true }).lean(),
    );
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });
    if (wifi.entries) await syncOfficeNetworks(company._id, wifi.entries, req.user._id);
    const officeNetworks = (
      await runWithCompany(company._id, () =>
        OfficeNetwork.find({ enabled: { $ne: false } }).sort({ createdAt: 1 }).select("ip").lean(),
      )
    ).map((r) => r.ip);
    clearCompanyProfileCache();
    clearCompanyCache();
    res.json({ success: true, message: "Company updated", data: shape(company, { officeNetworks }) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A company with this link name already exists" });
    }
    console.error("updateCompany failed:", err.message);
    res.status(500).json({ success: false, message: "Could not update company" });
  }
};

// DELETE /api/company/:id  (super admin) — only a company with no staff and
// no logins; use "deactivate" for one that has data.
export const deleteCompany = async (req, res) => {
  try {
    const result = await runUnscoped(async () => {
      const company = await Company.findById(req.params.id).lean();
      if (!company) return { notFound: true };
      const [staff, users] = await Promise.all([
        Staff.countDocuments({ company: company._id }),
        User.countDocuments({ company: company._id }),
      ]);
      if (staff || users) return { staff, users };
      await OfficeNetwork.deleteMany({ company: company._id });
      await Company.deleteOne({ _id: company._id });
      return { ok: true };
    });
    if (result.notFound) return res.status(404).json({ success: false, message: "Company not found" });
    if (!result.ok) {
      return res.status(409).json({
        success: false,
        message: `This company still has ${result.staff} staff and ${result.users} logins. Deactivate it instead, or remove its data first.`,
      });
    }
    await reloadOfficeNetworks();
    clearCompanyProfileCache();
    clearCompanyCache();
    res.json({ success: true, message: "Company deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not delete company" });
  }
};

// GET /api/company/my-network   (super admin)
// The network address this request comes from, in the form that is saved as
// an office address — lets the "Add company" form fill in the Wi-Fi of the
// router the super admin is on right now.
export const getMyNetwork = (req, res) => {
  const ip = getClientIp(req);
  const onServerPc = isLoopbackIp(ip);
  res.json({
    success: true,
    ip,
    entries: onServerPc ? serverLanEntries() : [officeEntryForIp(ip)],
  });
};
