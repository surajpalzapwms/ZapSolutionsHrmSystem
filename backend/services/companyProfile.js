// services/companyProfile.js
//
// The company's name and details printed on payslips / settlement PDFs.
// This is a single-company app, so they come straight from .env.
const profile = () => ({
  name: process.env.COMPANY_NAME || "HRM Portal",
  shortName: process.env.COMPANY_SHORT_NAME || "",
  tagline:
    process.env.COMPANY_TAGLINE ||
    "Manage staff, payroll, and attendance in one place.",
  logoUrl: process.env.COMPANY_LOGO_URL || "",
  financeTitle: process.env.COMPANY_FINANCE_TITLE || "Finance Manager",
});

export const getCompanyProfile = async () => profile();
