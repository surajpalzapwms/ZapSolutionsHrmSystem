// services/adminRules.js
//
// The "who may be an admin" rules in ONE place:
//
//   * a COMPANY has exactly ONE admin   (role "admin", no branch)
//   * a BRANCH  has exactly ONE admin   (role "admin", with a branch)
//
// Admin logins are only ever created from an invite link (see
// services/adminInvites.js). The checks here give friendly messages; the
// partial unique indexes on the User model make the rule hold even when two
// people open a link at the same moment.
import User from "../models/User.js";
import Branch from "../models/Branch.js";
import { runUnscoped } from "../utils/tenant.js";

export const ONE_COMPANY_ADMIN_MESSAGE =
  "This company already has an admin. Only one admin is allowed per company — create branch admins from the Branches page.";
export const ONE_BRANCH_ADMIN_MESSAGE = "This branch already has an admin. Only one admin is allowed per branch.";

/** The company's admin login (not a branch admin), or null. */
export const findCompanyAdmin = (companyId) =>
  runUnscoped(() =>
    User.findOne({ company: companyId, role: "admin", branch: null }).select("name firstName lastName email isActive lastLogin").lean(),
  );

/** The branch's admin login, or null. */
export const findBranchAdmin = (branchId) =>
  runUnscoped(() =>
    User.findOne({ role: "admin", branch: branchId }).select("name firstName lastName email isActive lastLogin").lean(),
  );

/** { _id, name } of a branch — shown next to the logged-in user. */
export const branchSummary = async (branchId) => {
  if (!branchId) return null;
  const b = await runUnscoped(() => Branch.findById(branchId).select("name code isActive").lean());
  return b ? { _id: String(b._id), name: b.name, code: b.code || "", isActive: b.isActive !== false } : null;
};

/** Super admin, or the company's own (non-branch) admin. */
export const isCompanyLevelUser = (user) => {
  const role = (user?.role || "").toLowerCase();
  if (role === "super-admin") return true;
  return role === "admin" && !user.branch;
};
