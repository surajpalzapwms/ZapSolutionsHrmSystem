// scripts/migrateRelievingToRelieved.js
//
// One-off migration: updates any Staff record still holding the OLD status
// value "Relieving" to the new value "Relieved". Needed because renaming
// the enum in code (models/Staff.js) does NOT touch documents that were
// already saved in the database — those still have the literal string
// "Relieving" sitting in their `status` field until this is run.
//
// Safe to run more than once (it only ever matches documents still on the
// old value, so a second run simply updates 0 documents).
//
// Usage (from the backend/ folder):
//   node scripts/migrateRelievingToRelieved.js
//
// Requires the same MONGO_URI your server already uses — reads it from
// .env via dotenv, exactly like server.js does.

import "dotenv/config";
import mongoose from "mongoose";
import Staff from "../models/Staff.js";

const run = async () => {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("❌ Missing MONGO_URI in .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log("✅ MongoDB connected");

  const result = await Staff.updateMany(
    { status: "Relieving" },
    { $set: { status: "Relieved" } },
  );

  console.log(
    `Matched ${result.matchedCount} staff record(s), updated ${result.modifiedCount}.`,
  );

  await mongoose.disconnect();
  console.log("Done.");
  process.exit(0);
};

run().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
