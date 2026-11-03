// services/adminInvites.js — create / list / revoke the one-time admin links.
import crypto from "crypto";
import AdminInvite, { inviteStatus } from "../models/AdminInvite.js";
import Branch from "../models/Branch.js";
import { runUnscoped } from "../utils/tenant.js";
import {
  findCompanyAdmin,
  findBranchAdmin,
  ONE_COMPANY_ADMIN_MESSAGE,
  ONE_BRANCH_ADMIN_MESSAGE,
} from "./adminRules.js";

export const DEFAULT_INVITE_DAYS = 7;
export const MAX_INVITE_DAYS = 30;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

class InviteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export { InviteError };

/**
 * Creates the link. Returns { token, invite } — the plain `token` exists only
 * here (the database keeps its hash), so the caller must show it right away.
 *
 *   type "company-admin": { company }            (super admin)
 *   type "branch-admin" : { company, branch }    (company admin / super admin)
 */
export const issueInvite = async ({ type, company, branch = null, email, days, note, createdBy }) => {
  const companyId = company?._id || company;
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (cleanEmail && !EMAIL.test(cleanEmail)) throw new InviteError("That e-mail address is not valid");
  const validDays = days === undefined || days === null || days === "" ? DEFAULT_INVITE_DAYS : Number(days);
  if (!Number.isInteger(validDays) || validDays < 1 || validDays > MAX_INVITE_DAYS) {
    throw new InviteError(`The link can stay valid for 1 to ${MAX_INVITE_DAYS} days`);
  }

  if (type === "company-admin") {
    if (await findCompanyAdmin(companyId)) throw new InviteError(ONE_COMPANY_ADMIN_MESSAGE, 409);
  } else if (type === "branch-admin") {
    const b = await runUnscoped(() => Branch.findOne({ _id: branch, company: companyId }).lean());
    if (!b) throw new InviteError("Branch not found", 404);
    if (b.isActive === false) throw new InviteError("This branch is inactive — activate it first", 409);
    if (await findBranchAdmin(b._id)) throw new InviteError(ONE_BRANCH_ADMIN_MESSAGE, 409);
  } else {
    throw new InviteError("Unknown invite type");
  }

  // Only ONE live link per target: a new link cancels the older unused ones,
  // so an old link that was sent to the wrong person stops working.
  await AdminInvite.updateMany(
    { company: companyId, type, branch: branch || null, usedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  const token = crypto.randomBytes(32).toString("hex"); // 256 bits, unguessable
  const invite = await AdminInvite.create({
    tokenHash: hashToken(token),
    type,
    company: companyId,
    branch: branch || null,
    email: cleanEmail || undefined,
    note: note ? String(note).trim().slice(0, 200) : undefined,
    createdBy,
    expiresAt: new Date(Date.now() + validDays * 24 * 60 * 60 * 1000),
  });
  return { token, invite };
};

/** Shape sent to the website (never includes the token hash). */
export const inviteShape = (inv) => ({
  _id: inv._id,
  type: inv.type,
  company: inv.company,
  branch: inv.branch || null,
  email: inv.email || "",
  note: inv.note || "",
  status: inviteStatus(inv),
  expiresAt: inv.expiresAt,
  usedAt: inv.usedAt || null,
  createdAt: inv.createdAt,
});

/** Recent invites of a target (newest first). */
export const listInvites = ({ type, company, branch = null, limit = 10 }) =>
  AdminInvite.find({ type, company, branch: branch || null })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

/** Cancels an unused link. Returns true when something was revoked. */
export const revokeInvite = async ({ inviteId, type, company, branch = null }) => {
  const res = await AdminInvite.updateOne(
    { _id: inviteId, type, company, branch: branch || null, usedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  return res.modifiedCount > 0;
};
