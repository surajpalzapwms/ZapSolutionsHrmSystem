// controllers/inviteController.js — PUBLIC pages behind an admin invite link.
//
//   GET  /api/invites/:token          what the link is for (company / branch)
//   POST /api/invites/:token/accept   the invited person creates their login
//
// A link works ONCE: the accept step "claims" it with a single atomic update
// (usedAt: null -> now). If the account cannot be created afterwards the claim
// is given back, so a typo'd e-mail does not burn the link.
import AdminInvite, { inviteStatus } from "../models/AdminInvite.js";
import Branch from "../models/Branch.js";
import User from "../models/User.js";
import { hashToken } from "../services/adminInvites.js";
import {
  findCompanyAdmin,
  findBranchAdmin,
  ONE_COMPANY_ADMIN_MESSAGE,
  ONE_BRANCH_ADMIN_MESSAGE,
} from "../services/adminRules.js";
import { getRegisteredCompany } from "../utils/companyContext.js";
import { refreshCompanyInRegistry } from "../services/companyRegistry.js";
import { clearAuthUserCache } from "../middleware/auth.js";
import { BRANCH_ADMIN_DEFAULT_TABS } from "../config/permissions.js";
import { runUnscoped } from "../utils/tenant.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9\s-]{7,22}$/;
const MIN_PASSWORD = 8;

const bad = (res, message, status = 400, extra = {}) => res.status(status).json({ success: false, message, ...extra });

const STATUS_MESSAGE = {
  invalid: "This invite link is not valid.",
  used: "This invite link has already been used.",
  revoked: "This invite link was cancelled. Please ask for a new one.",
  expired: "This invite link has expired. Please ask for a new one.",
};

// Looks the link up and checks everything that can be checked without writing.
const loadInvite = async (token) => {
  if (!/^[a-f0-9]{64}$/.test(String(token || ""))) return { problem: "invalid" };
  const invite = await AdminInvite.findOne({ tokenHash: hashToken(token) }).lean();
  const status = inviteStatus(invite);
  if (status !== "pending") return { problem: status };

  const company = getRegisteredCompany(invite.company) || (await refreshCompanyInRegistry(invite.company));
  if (!company) return { problem: "invalid" };
  if (company.isActive === false) return { problem: "inactive" };

  let branch = null;
  if (invite.type === "branch-admin") {
    branch = await runUnscoped(() => Branch.findOne({ _id: invite.branch, company: invite.company }).lean());
    if (!branch || branch.isActive === false) return { problem: "invalid" };
    if (await findBranchAdmin(branch._id)) return { problem: "taken", message: ONE_BRANCH_ADMIN_MESSAGE };
  } else if (await findCompanyAdmin(company._id)) {
    return { problem: "taken", message: ONE_COMPANY_ADMIN_MESSAGE };
  }
  return { invite, company, branch };
};

const problemResponse = (res, p) =>
  bad(res, p.message || STATUS_MESSAGE[p.problem] || "This invite link cannot be used.", p.problem === "invalid" ? 404 : 410, {
    code: `INVITE_${String(p.problem).toUpperCase()}`,
  });

// GET /api/invites/:token
export const getInvite = async (req, res) => {
  try {
    const r = await loadInvite(req.params.token);
    if (r.problem) return problemResponse(res, r);
    res.json({
      success: true,
      data: {
        type: r.invite.type,
        companyName: r.company.name,
        companySlug: r.company.slug,
        branchName: r.branch?.name || null,
        // When the link is locked to an e-mail address the form shows it fixed.
        email: r.invite.email || "",
        expiresAt: r.invite.expiresAt,
      },
    });
  } catch (err) {
    console.error("getInvite failed:", err.message);
    bad(res, "Could not check this invite link", 500);
  }
};

// POST /api/invites/:token/accept  { firstName, lastName?, email, password, contactNumber? }
export const acceptInvite = async (req, res) => {
  let claimed = null;
  try {
    const r = await loadInvite(req.params.token);
    if (r.problem) return problemResponse(res, r);
    const { invite, company, branch } = r;

    // ── validate everything BEFORE using up the link ──
    const body = req.body || {};
    const firstName = String(body.firstName || "").trim();
    const lastName = String(body.lastName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const contactNumber = String(body.contactNumber || "").trim() || "0000000000";
    if (!firstName) return bad(res, "First name is required");
    if (!EMAIL.test(email)) return bad(res, "Please enter a valid e-mail address");
    if (invite.email && invite.email !== email) {
      return bad(res, `This link was made for ${invite.email}. Please use that e-mail address.`);
    }
    if (password.length < MIN_PASSWORD) return bad(res, `Password must be at least ${MIN_PASSWORD} characters`);
    if (!PHONE.test(contactNumber)) return bad(res, "Please enter a valid contact number");
    if (await runUnscoped(() => User.exists({ email }))) {
      return bad(res, "A login with this e-mail already exists. Please use a different e-mail.", 409);
    }

    // ── claim the link: only ONE request can ever flip usedAt from null ──
    claimed = await AdminInvite.findOneAndUpdate(
      { _id: invite._id, usedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true },
    );
    if (!claimed) return problemResponse(res, { problem: "used" });

    const isBranch = invite.type === "branch-admin";
    const user = await runUnscoped(() =>
      User.create({
        firstName,
        lastName,
        email,
        password, // hashed by the model
        contactNumber,
        company: company._id,
        role: "admin",
        branch: isBranch ? branch._id : null,
        adminScope: isBranch ? "branch" : "company",
        // Company admin: every tab. Branch admin: staff only (see permissions.js).
        permissions: isBranch
          ? { allTabs: false, tabs: BRANCH_ADMIN_DEFAULT_TABS }
          : { allTabs: true, tabs: [] },
      }),
    );

    await AdminInvite.updateOne({ _id: invite._id }, { $set: { usedBy: user._id } });
    clearAuthUserCache();
    res.status(201).json({
      success: true,
      message: isBranch ? "Your branch admin account is ready" : "Your admin account is ready",
      data: {
        email: user.email,
        companyName: company.name,
        companySlug: company.slug,
        branchName: branch?.name || null,
      },
    });
  } catch (err) {
    // Give the link back so the person can fix the problem and try again.
    if (claimed) await AdminInvite.updateOne({ _id: claimed._id }, { $set: { usedAt: null } }).catch(() => {});
    if (err.code === 11000) {
      const key = Object.keys(err.keyPattern || {})[0];
      if (key === "email") return bad(res, "A login with this e-mail already exists.", 409);
      return bad(res, key === "branch" ? ONE_BRANCH_ADMIN_MESSAGE : ONE_COMPANY_ADMIN_MESSAGE, 409);
    }
    if (err.name === "ValidationError") return bad(res, err.message, 400);
    console.error("acceptInvite failed:", err.message);
    bad(res, "Could not create your account", 500);
  }
};
