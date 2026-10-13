// services/companyMigration.js
//
// One-time, safe-to-repeat upgrade from "one company per database" to
// "many companies in one database". On startup it looks for records that
// have no company yet (everything saved by the old version). If there are
// any, they are all given to ONE company:
//   - the first existing company, or
//   - a new company made from the old branding (collection
//     "companyprofiles", or the COMPANY_NAME in .env).
// The super admin stays company-less. Run twice = nothing happens the
// second time. BACK UP THE DATABASE before the first start of this version.

import mongoose from "mongoose";
import Company from "../models/Company.js";
import { runUnscoped } from "../utils/tenant.js";

const slugify = (v) =>
  String(v || "company")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "company";

const legacyFilter = (modelName) =>
  modelName === "User"
    ? { company: { $exists: false }, role: { $ne: "super-admin" } }
    : { company: { $exists: false } };

export const migrateToMultiCompany = async () => {
  const tenantModels = Object.values(mongoose.models).filter((m) => m.modelName !== "Company");

  // Is there any record without a company?
  let legacyTotal = 0;
  const counts = {};
  for (const m of tenantModels) {
    const n = await m.collection.countDocuments(legacyFilter(m.modelName));
    if (n) {
      counts[m.modelName] = n;
      legacyTotal += n;
    }
  }
  if (!legacyTotal) return { migrated: false };

  let company = await runUnscoped(() => Company.findOne().sort({ createdAt: 1 }));
  if (!company) {
    // Old single-company branding, if it was ever saved.
    const old = await mongoose.connection
      .collection("companyprofiles")
      .findOne({ key: "main" })
      .catch(() => null);
    const name = (old?.name || process.env.COMPANY_NAME || "My Company").trim();
    const branding = {};
    for (const f of [
      "shortName",
      "tagline",
      "logoUrl",
      "primaryColor",
      "sidebarColor",
      "loginTitle",
      "loginSubtitle",
      "financeTitle",
    ]) {
      if (old && typeof old[f] === "string" && old[f].trim()) branding[f] = old[f];
    }
    company = await runUnscoped(() =>
      Company.create({ name, slug: slugify(process.env.COMPANY_SHORT_NAME || name), ...branding }),
    );
    console.log(`🏢 Migration: created company "${company.name}" for the existing data`);
  }

  for (const m of tenantModels) {
    if (!counts[m.modelName]) continue;
    const r = await m.collection.updateMany(legacyFilter(m.modelName), {
      $set: { company: company._id },
    });
    console.log(`🏢 Migration: ${m.modelName}: ${r.modifiedCount} record(s) -> ${company.name}`);
  }
  return { migrated: true, companyId: String(company._id), counts };
};
