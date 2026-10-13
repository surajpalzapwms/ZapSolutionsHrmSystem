// scripts/keepOneCompany.js
//
// Only needed if your database was used by the old multi-company (white
// label) version with MORE than one company. The app is single-company now,
// so it refuses to start until the database holds one company's data.
//
// This keeps the data of ONE company and deletes every record that belongs
// to any other company. Records without a company (e.g. the super admin
// login) are kept. BACK UP THE DATABASE FIRST.
//
//   node scripts/keepOneCompany.js                       -> lists the companies
//   node scripts/keepOneCompany.js <companyId>           -> preview (changes nothing)
//   node scripts/keepOneCompany.js <companyId> --apply   -> deletes the other companies' data

import "dotenv/config";
import mongoose from "mongoose";

const [, , keepId, flag] = process.argv;
const APPLY = flag === "--apply";

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("Missing MONGO_URI in .env");
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system."));

  const companies = collections.includes("companies")
    ? await db.collection("companies").find().project({ name: 1 }).toArray()
    : [];

  if (!keepId) {
    console.log("Companies in this database:");
    for (const c of companies) {
      const staff = await db.collection("staffs").countDocuments({ company: c._id });
      console.log(`  ${c._id}  ${c.name}  (${staff} staff)`);
    }
    console.log("\nRun again with the id of the company to keep.");
    return;
  }

  if (!mongoose.isValidObjectId(keepId)) throw new Error(`Not a valid company id: ${keepId}`);
  const keep = new mongoose.Types.ObjectId(keepId);
  const known = companies.find((c) => String(c._id) === keepId);
  if (companies.length && !known) throw new Error(`No company with id ${keepId}`);

  console.log(`${APPLY ? "Keeping" : "Preview — would keep"}: ${known?.name || keepId}\n`);
  const otherData = { company: { $exists: true, $ne: null, $nin: [keep] } };

  for (const name of collections) {
    if (name === "companies") continue;
    const n = await db.collection(name).countDocuments(otherData);
    if (!n) continue;
    if (APPLY) {
      const r = await db.collection(name).deleteMany(otherData);
      console.log(`  ${name}: deleted ${r.deletedCount}`);
    } else {
      console.log(`  ${name}: would delete ${n}`);
    }
  }

  if (collections.includes("companies")) {
    const others = { _id: { $ne: keep } };
    if (APPLY) {
      const r = await db.collection("companies").deleteMany(others);
      console.log(`  companies: deleted ${r.deletedCount}`);
    } else {
      console.log(`  companies: would delete ${await db.collection("companies").countDocuments(others)}`);
    }
  }

  if (!APPLY) console.log("\nNothing was changed. Add --apply to delete (back up first).");
};

main()
  .catch((err) => {
    console.error("❌", err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
