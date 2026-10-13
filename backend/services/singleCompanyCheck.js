// services/singleCompanyCheck.js
//
// The app is single-company again (the multi-company / white-label feature
// was removed). A database used by the multi-company version still has a
// `company` field on its records. With ONE company that is harmless: the
// field is simply ignored and nothing needs to change.
//
// With MORE than one company in the database, starting would merge every
// company's staff, payroll and attendance into one view, and duplicate
// Staff IDs / payroll codes between companies would break the unique
// indexes. So the server refuses to start and explains what to do.
//
// Runs after connecting and BEFORE indexes are synced (see utils/db.js).

import mongoose from "mongoose";

// Collections that carry the most data per company.
const CHECK_COLLECTIONS = ["staffs", "users", "payrolls", "attendances"];

export const checkSingleCompanyData = async () => {
  const db = mongoose.connection.db;
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

  const companyIds = new Set();
  for (const name of CHECK_COLLECTIONS) {
    if (!existing.has(name)) continue;
    const ids = await db.collection(name).distinct("company", { company: { $ne: null } });
    ids.forEach((id) => companyIds.add(String(id)));
  }

  if (companyIds.size <= 1) return { companies: companyIds.size };

  let names = [...companyIds];
  if (existing.has("companies")) {
    const rows = await db
      .collection("companies")
      .find({ _id: { $in: [...companyIds].map((id) => new mongoose.Types.ObjectId(id)) } })
      .project({ name: 1 })
      .toArray();
    const byId = new Map(rows.map((r) => [String(r._id), r.name]));
    names = [...companyIds].map((id) => `${byId.get(id) || "(unknown)"} [${id}]`);
  }

  const err = new Error(
    `This database holds data for ${companyIds.size} companies:\n  - ${names.join("\n  - ")}\n` +
      "This version of the app supports ONE company only. Keep one company with\n" +
      "  node scripts/keepOneCompany.js <companyId>          (preview)\n" +
      "  node scripts/keepOneCompany.js <companyId> --apply  (deletes the other companies' data)\n" +
      "after backing up the database, or point MONGO_URI at a separate database per company.",
  );
  err.fatal = true;
  throw err;
};
