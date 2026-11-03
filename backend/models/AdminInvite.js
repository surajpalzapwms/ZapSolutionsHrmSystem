import mongoose from "mongoose";
import "../utils/tenant.js";

// A ONE-TIME link that lets somebody create their own admin login.
//
//   type "company-admin"  created by the SUPER ADMIN  -> the company's admin
//   type "branch-admin"   created by the COMPANY ADMIN -> one branch's admin
//
// Only a SHA-256 hash of the token is stored, so a database leak does not
// leak working links. The link itself is shown once, when it is created.
//
// Not filtered by company (skipTenant): the public accept page only knows
// the token, not the company.
const adminInviteSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    type: { type: String, enum: ["company-admin", "branch-admin"], required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null },
    // Optional: lock the link to one e-mail address.
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 200 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    usedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, skipTenant: true },
);

export const inviteStatus = (inv, now = new Date()) => {
  if (!inv) return "invalid";
  if (inv.usedAt) return "used";
  if (inv.revokedAt) return "revoked";
  if (new Date(inv.expiresAt) <= now) return "expired";
  return "pending";
};

export default mongoose.model("AdminInvite", adminInviteSchema);
