// scripts/checkStaffPassword.js
//
// Shows whether a staff member's password can be displayed in History,
// and if not, why. Read-only — changes nothing.
//
// Usage (from the backend folder):
//   node scripts/checkStaffPassword.js ravi@zapwms.com
import "dotenv/config";
import mongoose from "mongoose";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import { decryptPassword } from "../utils/passwordVault.js";

const looksHashed = (v) => /^\$2[aby]\$\d{2}\$/.test(String(v || ""));

const email = (process.argv[2] || "").toLowerCase().trim();
if (!email) {
  console.error("Usage: node scripts/checkStaffPassword.js <email>");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);

const staff = await Staff.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })
  .select("+password +passwordEncrypted staffName staffId email")
  .lean();
const user = await User.findOne({ email }).select("+password email role").lean();

console.log("Staff record     :", staff ? `${staff.staffName} (${staff.staffId})` : "NOT FOUND");
console.log("Login account    :", user ? `found (role ${user.role})` : "NOT FOUND");
console.log("Saved copy       :", staff?.passwordEncrypted ? "YES" : "NO");

if (staff?.passwordEncrypted) {
  const plain = decryptPassword(staff.passwordEncrypted);
  console.log(
    "Readable         :",
    plain
      ? `YES -> ${plain}`
      : "NO — saved with a different key. Put the old PASSWORD_VIEW_KEY / JWT_SECRET value in PASSWORD_VIEW_KEY_OLD in .env and restart.",
  );
} else {
  const plainStaff = staff?.password && !looksHashed(staff.password);
  const plainUser = user?.password && !looksHashed(user.password);
  if (plainStaff || plainUser) {
    console.log("Readable         : YES (stored as plain text) — History will show it.");
  } else {
    console.log(
      "Readable         : NO — only the one-way login hash exists. The old password cannot be recovered;",
    );
    console.log(
      "                   it will be saved automatically the next time this person logs in, or use Set in History.",
    );
  }
}

await mongoose.disconnect();
