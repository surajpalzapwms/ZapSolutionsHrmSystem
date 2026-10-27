import mongoose from "mongoose";

// One document per deployment (each company has its own database), so this
// collection only ever holds a single row, keyed "main". It stores what the
// admin sets on the Settings page: the white-label branding (name, logo,
// colours), the company's contact details and the payroll currency. They
// are shown on the website, in PDFs and in the mobile app.
const companyProfileSchema = new mongoose.Schema(
  {
    key: { type: String, default: "main", unique: true },
    name: { type: String, trim: true, maxlength: 80 },
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

    // ---- company details ----
    address: { type: String, trim: true, maxlength: 300 },
    phone: { type: String, trim: true, maxlength: 40 },
    email: { type: String, trim: true, maxlength: 120 },
    website: { type: String, trim: true, maxlength: 120 },

    // ---- payroll currency ----
    // ISO 4217 code (INR, USD, AED ...) and the number format used to group
    // digits (en-IN = 1,00,000.00, en-US = 100,000.00).
    currencyCode: { type: String, trim: true, uppercase: true, maxlength: 3 },
    numberLocale: { type: String, trim: true, maxlength: 12 },
  },
  { timestamps: true },
);

export default mongoose.model("CompanyProfile", companyProfileSchema);
