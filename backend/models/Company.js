import mongoose from "mongoose";
import "../utils/tenant.js";

// One document per company (tenant) — the white-label record.
//
// Created by the SUPER ADMIN with just a name + country (the country fills
// in currency, time zone, weekly off days and the list of registration
// numbers — see config/countries.js). After that the super admin OR the
// company's own admin (with the "Settings" tab) completes the profile:
// logo, colours, address, legal numbers, signatory, stamp ...
//
// This is the only collection that is NOT filtered by company (skipTenant),
// because it is what the filter is built from.
const HEX = /^#[0-9a-fA-F]{6}$/;

const companySchema = new mongoose.Schema(
  {
    // ---- identity ----
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // short url-safe id, e.g. "acme" — login page link ?company=acme
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 40 },
    // Optional own domain for the login page, e.g. "hr.acme.sa"
    customDomain: { type: String, trim: true, lowercase: true, maxlength: 120 },
    isActive: { type: Boolean, default: true },
    // The owner company (ZAP Solutionz): the only one the super admin can open
    // and edit. Never set from the API — only in the database / OWNER_COMPANY_SLUG.
    isOwner: { type: Boolean, default: false },
    // Plan limits (null / unset = unlimited)
    maxStaff: { type: Number, min: 0, default: null },
    // Tabs this company has (see config/permissions.js). Unset = every tab.
    enabledTabs: { type: [String], default: undefined },
    // 2 = the tab list was saved with the full list (Dashboard, Holidays,
    // Branches, Admin Permissions included). See config/permissions.js.
    tabsVersion: { type: Number, default: undefined },
    // false = this company has no Internship / Probation: every staff member
    // is confirmed from the joining date (Confirmation Date = Joining Date).
    // Set by the super admin on the company's "Plan, tabs & domain".
    probationEnabled: { type: Boolean, default: true },

    // ---- country & locale ----
    country: { type: String, trim: true, uppercase: true, maxlength: 8, default: "IN" },
    currencyCode: { type: String, trim: true, uppercase: true, maxlength: 3 },
    numberLocale: { type: String, trim: true, maxlength: 12 },
    timeZone: { type: String, trim: true, maxlength: 60 },
    // 0 = Sunday ... 6 = Saturday. India [0], Saudi / Qatar [5, 6].
    weeklyOffDays: { type: [Number], default: undefined },

    // ---- working time (set by the company admin in Settings → Work week & hours) ----
    // "HH:mm" 24-hour. Unset = 10:00 – 18:30. Used as every staff member's shift
    // (unless the staff member has their own shift) and as the default Login /
    // Logout time when attendance is marked or edited.
    workStartTime: { type: String, trim: true, match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Time must look like 09:30"] },
    workEndTime: { type: String, trim: true, match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Time must look like 18:30"] },
    // Short Saturday: Saturday (when it is NOT a weekly off) is a shorter working
    // day with its own hours, and any attendance on it counts as a full day.
    // Unset = on (10:00 – 16:00), which is how it has always worked.
    // false = Saturday is a normal working day with the hours above.
    shortSaturday: { type: Boolean, default: undefined },
    saturdayStartTime: { type: String, trim: true, match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Time must look like 10:00"] },
    saturdayEndTime: { type: String, trim: true, match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Time must look like 16:00"] },

    // ---- names ----
    legalName: { type: String, trim: true, maxlength: 160 },
    nameAr: { type: String, trim: true, maxlength: 160 }, // Arabic name (GCC)
    shortName: { type: String, trim: true, maxlength: 30 },
    tagline: { type: String, trim: true, maxlength: 160 },

    // ---- branding ----
    // https URL of the logo. An uploaded logo is kept in logoData instead
    // and served from GET /api/company/logo/:id (cached by browsers).
    logoUrl: { type: String, trim: true, maxlength: 1000 },
    logoData: { type: String, select: false, maxlength: 700000 },
    logoUpdatedAt: { type: Date },
    primaryColor: { type: String, trim: true, match: [HEX, "Colour must look like #2563eb"] },
    sidebarColor: { type: String, trim: true, match: [HEX, "Colour must look like #0b1220"] },
    loginTitle: { type: String, trim: true, maxlength: 80 },
    loginSubtitle: { type: String, trim: true, maxlength: 200 },

    // ---- contact ----
    address: { type: String, trim: true, maxlength: 300 },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    postalCode: { type: String, trim: true, maxlength: 20 },
    phone: { type: String, trim: true, maxlength: 40 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    website: { type: String, trim: true, maxlength: 120 },

    // ---- registration / tax numbers (keys from config/countries.js) ----
    legalIds: { type: Map, of: String, default: undefined },

    // ---- documents (payslips, letters) ----
    financeTitle: { type: String, trim: true, maxlength: 60 }, // "Finance Manager"
    signatoryName: { type: String, trim: true, maxlength: 80 },
    signatoryTitle: { type: String, trim: true, maxlength: 80 },
    // Small PNG/JPG data URLs, printed on HR letters.
    signatureData: { type: String, select: false, maxlength: 400000 },
    stampData: { type: String, select: false, maxlength: 400000 },
    hasSignature: { type: Boolean, default: false },
    hasStamp: { type: Boolean, default: false },
    assetsUpdatedAt: { type: Date },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, skipTenant: true },
);

companySchema.index(
  { customDomain: 1 },
  { unique: true, partialFilterExpression: { customDomain: { $type: "string", $gt: "" } } },
);

export default mongoose.model("Company", companySchema);
