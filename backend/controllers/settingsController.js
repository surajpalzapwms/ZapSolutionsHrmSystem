// controllers/settingsController.js
//
// The Settings page: logo, company name / details and payroll currency.
//   GET /api/settings  (public)   — the login page and every logged-in user
//                                    need the logo and currency.
//   PUT /api/settings  (admin with the "settings" tab, or super admin)
import CompanyProfile from "../models/CompanyProfile.js";
import {
  BRANDING_FIELDS,
  clearCompanyProfileCache,
  getCompanyProfile,
} from "../services/companyProfile.js";
import { findCurrency, NUMBER_FORMATS } from "../config/currencies.js";

const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LOGO_CHARS = 600000; // ~450 KB image once base64 encoded

const LIMITS = {
  name: 80,
  shortName: 30,
  tagline: 160,
  loginTitle: 80,
  loginSubtitle: 200,
  financeTitle: 60,
  address: 300,
  phone: 40,
  email: 120,
  website: 120,
};

// Checks the settings present in `body`. Returns { update } or { error }.
// An empty value means "clear it" (the default is used again).
export const readSettings = (body) => {
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
        const okData = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(value);
        if (!okUrl && !okData) {
          return { error: "Logo must be an https:// image URL or an uploaded PNG / JPG / WebP image" };
        }
        if (value.length > MAX_LOGO_CHARS) {
          return { error: "Logo image is too large (max about 400 KB)" };
        }
      }
    } else if (field === "currencyCode") {
      if (!value) return { error: "Please choose a currency" };
      const cur = findCurrency(value);
      if (!cur) return { error: `Currency "${value}" is not supported` };
      update.currencyCode = cur.code;
      continue;
    } else if (field === "numberLocale") {
      if (value && !NUMBER_FORMATS.some((f) => f.locale === value)) {
        return { error: "Unknown number format" };
      }
    } else if (field === "email") {
      if (value && !EMAIL.test(value)) return { error: "Email address is not valid" };
    } else if (field === "name") {
      if (!value) return { error: "Company name is required" };
    }

    if (LIMITS[field] && value.length > LIMITS[field]) {
      return { error: `${field} must be at most ${LIMITS[field]} characters` };
    }
    update[field] = value;
  }
  return { update };
};

export const getSettings = async (req, res) => {
  try {
    const data = await getCompanyProfile();
    // Short browser cache so the login page paints fast.
    res.set("Cache-Control", "no-cache");
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not load settings" });
  }
};

export const updateSettings = async (req, res) => {
  try {
    const { update, error } = readSettings(req.body || {});
    if (error) return res.status(400).json({ success: false, message: error });
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, message: "Nothing to save" });
    }
    await CompanyProfile.findOneAndUpdate(
      { key: "main" },
      { $set: update, $setOnInsert: { key: "main" } },
      { upsert: true, runValidators: true },
    );
    clearCompanyProfileCache();
    const data = await getCompanyProfile();
    res.json({ success: true, message: "Settings saved", data });
  } catch (err) {
    console.error("updateSettings failed:", err.message);
    res.status(500).json({ success: false, message: "Could not save settings" });
  }
};
