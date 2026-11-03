// services/companyMigration.js
//
// Safe-to-repeat upgrade, run on every start BEFORE indexes are synced
// (see utils/db.js):
//
// 1. Records saved by the single-company version have no `company`. If
//    there are any, they all go to ONE company: the first existing one, or
//    a new one made from the old Settings page values (collection
//    "companyprofiles", key "main") / COMPANY_NAME in .env.
//    The super admin login stays company-less.
// 2. The old Settings row (logo, colours, address, currency) is copied onto
//    that company where the company has no value yet.
// 3. Logos stored inline in `logoUrl` (data:image/...) move to `logoData`,
//    which is served from /api/company/logo/:id with long browser caching.
//
// Run twice = nothing happens the second time. BACK UP THE DATABASE before
// the first start of this version.
import mongoose from "mongoose";
import Company from "../models/Company.js";
import { runUnscoped } from "../utils/tenant.js";
import { findCountry, DEFAULT_COUNTRY } from "../config/countries.js";

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

const OLD_PROFILE_FIELDS = [
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

const oldSettingsRow = async () => {
  try {
    const db = mongoose.connection.db;
    const has = await db.listCollections({ name: "companyprofiles" }, { nameOnly: true }).toArray();
    if (!has.length) return null;
    return await db.collection("companyprofiles").findOne({ key: "main" });
  } catch {
    return null;
  }
};

export const migrateToMultiCompany = async () => {
  const tenantModels = Object.values(mongoose.models).filter(
    (m) => m.modelName !== "Company" && !m.schema.options.skipTenant,
  );

  let legacyTotal = 0;
  const counts = {};
  for (const m of tenantModels) {
    const n = await m.collection.countDocuments(legacyFilter(m.modelName));
    if (n) {
      counts[m.modelName] = n;
      legacyTotal += n;
    }
  }

  const old = await oldSettingsRow();
  let company = null;

  if (legacyTotal) {
    company = await runUnscoped(() => Company.findOne().sort({ createdAt: 1 }));
    if (!company) {
      const name = (old?.name || process.env.COMPANY_NAME || "My Company").trim().slice(0, 80);
      const country = findCountry(process.env.DEFAULT_COUNTRY || DEFAULT_COUNTRY);
      let slug = slugify(process.env.COMPANY_SHORT_NAME || name);
      if (await runUnscoped(() => Company.exists({ slug }))) slug = `${slug}-${Date.now().toString(36)}`;
      company = await runUnscoped(() =>
        Company.create({
          name,
          slug,
          country: country.code,
          currencyCode: country.currencyCode,
          numberLocale: country.numberLocale,
          timeZone: process.env.DEFAULT_TIMEZONE || country.timeZone,
          weeklyOffDays: country.weeklyOffDays,
        }),
      );
      console.log(`🏢 Migration: created company "${company.name}" for the existing data`);
    }
    for (const m of tenantModels) {
      if (!counts[m.modelName]) continue;
      const r = await m.collection.updateMany(legacyFilter(m.modelName), { $set: { company: company._id } });
      console.log(`🏢 Migration: ${m.modelName}: ${r.modifiedCount} record(s) -> ${company.name}`);
    }
  }

  // Old Settings page values -> the first company (only empty fields).
  if (old && !old.migratedToCompany) {
    company = company || (await runUnscoped(() => Company.findOne().sort({ createdAt: 1 })));
    if (company) {
      const set = {};
      for (const f of OLD_PROFILE_FIELDS) {
        const v = typeof old[f] === "string" ? old[f].trim() : "";
        if (!v || company[f]) continue;
        if (f === "logoUrl" && /^data:image\//i.test(v)) {
          if (!company.logoUpdatedAt) {
            set.logoData = v;
            set.logoUpdatedAt = new Date();
          }
        } else set[f] = v;
      }
      if (Object.keys(set).length) {
        await Company.collection.updateOne({ _id: company._id }, { $set: set });
        console.log(`🏢 Migration: copied old Settings (${Object.keys(set).join(", ")}) to "${company.name}"`);
      }
      await mongoose.connection.db
        .collection("companyprofiles")
        .updateOne({ _id: old._id }, { $set: { migratedToCompany: company._id } });
    }
  }

  // Inline data: logos -> logoData (served + cached separately).
  const inline = await Company.collection
    .find({ logoUrl: { $regex: "^data:image/" } }, { projection: { logoUrl: 1 } })
    .toArray();
  for (const c of inline) {
    await Company.collection.updateOne(
      { _id: c._id },
      { $set: { logoData: c.logoUrl, logoUpdatedAt: new Date() }, $unset: { logoUrl: 1 } },
    );
  }

  // Companies from older versions without a country: fill the preset in.
  const noCountry = await Company.collection.find({ country: { $exists: false } }).toArray();
  for (const c of noCountry) {
    const preset = findCountry(DEFAULT_COUNTRY);
    await Company.collection.updateOne(
      { _id: c._id },
      {
        $set: {
          country: preset.code,
          ...(c.timeZone ? {} : { timeZone: process.env.DEFAULT_TIMEZONE || preset.timeZone }),
          ...(c.weeklyOffDays ? {} : { weeklyOffDays: preset.weeklyOffDays }),
        },
      },
    );
  }

  return { migrated: legacyTotal > 0, companyId: company ? String(company._id) : null, counts };
};
