import mongoose from "mongoose";
import "../utils/tenant.js";

// One document per company (tenant). Holds the company's white-label
// branding too (name, logo, colours) — shown on the website, in PDFs and in
// the mobile app. This is the only collection that is NOT filtered by
// company (skipTenant), because it is what the filter is built from.
const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // short url-safe id, e.g. "acme" — used on the login page link ?company=acme
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 40 },
    isActive: { type: Boolean, default: true },

    // ---- tabs this company has (see config/permissions.js) ----
    // Not set (undefined) = every tab. An array = only those tab keys.
    enabledTabs: { type: [String], default: undefined },

    // ---- white-label branding ----
    shortName: { type: String, trim: true, maxlength: 30 },
    tagline: { type: String, trim: true, maxlength: 160 },
    // https URL or a small data:image/... URL (uploaded from the website)
    logoUrl: { type: String, trim: true, maxlength: 700000 },
    primaryColor: { type: String, trim: true },
    sidebarColor: { type: String, trim: true },
    loginTitle: { type: String, trim: true, maxlength: 80 },
    loginSubtitle: { type: String, trim: true, maxlength: 200 },
    // Printed on payslips / settlement PDFs, e.g. "Finance Manager"
    financeTitle: { type: String, trim: true, maxlength: 60 },
  },
  { timestamps: true, skipTenant: true },
);

export default mongoose.model("Company", companySchema);
