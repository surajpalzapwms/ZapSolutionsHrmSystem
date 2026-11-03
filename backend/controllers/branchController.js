// controllers/branchController.js — branches of the current company.
//
// Who: the COMPANY admin (or the super admin while a company is open).
// A BRANCH admin cannot reach these routes.
//
//   GET    /api/branches                         branches + staff count + admin + live invite
//   POST   /api/branches                         add a branch
//   PUT    /api/branches/:id                     edit / activate / deactivate
//   DELETE /api/branches/:id                     only when it has no staff and no admin
//   POST   /api/branches/:id/admin-invites       one-time link for THE branch admin
//   DELETE /api/branches/:id/admin-invites/:inviteId   cancel an unused link
import mongoose from "mongoose";
import Branch from "../models/Branch.js";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import AdminInvite from "../models/AdminInvite.js";
import { getCompanyId, runUnscoped } from "../utils/tenant.js";
import { clearAuthUserCache } from "../middleware/auth.js";
import { findBranchAdmin } from "../services/adminRules.js";
import { issueInvite, revokeInvite, inviteShape, InviteError } from "../services/adminInvites.js";

const bad = (res, message, status = 400, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const isId = (v) => mongoose.isValidObjectId(v);

const readFields = (body, { partial = false } = {}) => {
  const set = {};
  const text = (key, max) => {
    if (body[key] === undefined) return null;
    const v = String(body[key] ?? "").trim();
    if (v.length > max) return `${key} must be at most ${max} characters`;
    set[key] = v;
    return null;
  };
  if (!partial || body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return { error: "Branch name is required" };
    if (name.length > 80) return { error: "Branch name must be at most 80 characters" };
    set.name = name;
  }
  for (const [k, max] of [["address", 300], ["city", 80], ["state", 80], ["phone", 40]]) {
    const err = text(k, max);
    if (err) return { error: err };
  }
  if (body.code !== undefined) {
    const code = String(body.code || "").trim().toUpperCase();
    if (code.length > 20) return { error: "Branch code must be at most 20 characters" };
    // An empty code is stored as "no code" so blank codes never collide.
    set.code = code || undefined;
  }
  if (body.isActive !== undefined) set.isActive = Boolean(body.isActive);
  return { set };
};

const dupMessage = (err) =>
  err.keyPattern?.code ? "Another branch already uses this code" : "A branch with this name already exists in your company";

// GET /api/branches
export const listBranches = async (req, res) => {
  try {
    const companyId = getCompanyId();
    const branches = await Branch.find().sort({ name: 1 }).lean();
    const ids = branches.map((b) => b._id);
    const [staffCounts, admins, invites] = await Promise.all([
      Staff.aggregate([{ $match: { branch: { $in: ids } } }, { $group: { _id: "$branch", n: { $sum: 1 } } }]),
      runUnscoped(() =>
        User.find({ company: companyId, role: "admin", branch: { $in: ids } })
          .select("name firstName lastName email isActive lastLogin branch")
          .lean(),
      ),
      AdminInvite.find({ company: companyId, type: "branch-admin", branch: { $in: ids } })
        .sort({ createdAt: -1 })
        .lean(),
    ]);
    const staffBy = new Map(staffCounts.map((r) => [String(r._id), r.n]));
    const adminBy = new Map(admins.map((a) => [String(a.branch), a]));
    const liveInviteBy = new Map();
    for (const inv of invites) {
      const key = String(inv.branch);
      if (liveInviteBy.has(key)) continue;
      const shaped = inviteShape(inv);
      if (shaped.status === "pending") liveInviteBy.set(key, shaped);
    }
    res.json({
      success: true,
      data: branches.map((b) => ({
        ...b,
        isActive: b.isActive !== false,
        staffCount: staffBy.get(String(b._id)) || 0,
        admin: adminBy.get(String(b._id)) || null,
        pendingInvite: liveInviteBy.get(String(b._id)) || null,
      })),
    });
  } catch (err) {
    console.error("listBranches failed:", err.message);
    bad(res, "Could not load branches", 500);
  }
};

// POST /api/branches
export const createBranch = async (req, res) => {
  try {
    const { set, error } = readFields(req.body || {});
    if (error) return bad(res, error);
    const branch = await Branch.create({ ...set, createdBy: req.user._id });
    res.status(201).json({ success: true, message: "Branch created", data: branch });
  } catch (err) {
    if (err.code === 11000) return bad(res, dupMessage(err), 409);
    if (err.name === "ValidationError") return bad(res, err.message);
    console.error("createBranch failed:", err.message);
    bad(res, "Could not create the branch", 500);
  }
};

// PUT /api/branches/:id
export const updateBranch = async (req, res) => {
  try {
    const { set, error } = readFields(req.body || {}, { partial: true });
    if (error) return bad(res, error);
    const update = {};
    const unset = {};
    for (const [k, v] of Object.entries(set)) (v === undefined ? unset : update)[k] = v === undefined ? 1 : v;
    const op = {};
    if (Object.keys(update).length) op.$set = update;
    if (Object.keys(unset).length) op.$unset = unset;
    if (!Object.keys(op).length) return bad(res, "Nothing to update");
    const branch = await Branch.findOneAndUpdate({ _id: req.params.id }, op, { new: true, runValidators: true }).lean();
    if (!branch) return bad(res, "Branch not found", 404);
    clearAuthUserCache(); // a deactivated branch must lock out its admin right away
    res.json({ success: true, message: "Branch updated", data: branch });
  } catch (err) {
    if (err.code === 11000) return bad(res, dupMessage(err), 409);
    if (err.name === "ValidationError") return bad(res, err.message);
    console.error("updateBranch failed:", err.message);
    bad(res, "Could not update the branch", 500);
  }
};

// DELETE /api/branches/:id
export const deleteBranch = async (req, res) => {
  try {
    const branch = await Branch.findById(req.params.id).lean();
    if (!branch) return bad(res, "Branch not found", 404);
    const [staff, admin] = await Promise.all([Staff.countDocuments({ branch: branch._id }), findBranchAdmin(branch._id)]);
    if (staff || admin) {
      return bad(
        res,
        `This branch still has ${staff} staff${admin ? " and a branch admin" : ""}. Deactivate it instead, or move/remove them first.`,
        409,
      );
    }
    await AdminInvite.updateMany(
      { branch: branch._id, usedAt: null, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    await Branch.deleteOne({ _id: branch._id });
    res.json({ success: true, message: "Branch deleted" });
  } catch (err) {
    console.error("deleteBranch failed:", err.message);
    bad(res, "Could not delete the branch", 500);
  }
};

// POST /api/branches/:id/admin-invites  { email?, days? }
export const createBranchAdminInvite = async (req, res) => {
  try {
    const branch = await Branch.findById(req.params.id).select("_id").lean();
    if (!branch) return bad(res, "Branch not found", 404);
    const { token, invite } = await issueInvite({
      type: "branch-admin",
      company: getCompanyId(),
      branch: branch._id,
      email: req.body?.email,
      days: req.body?.days,
      note: req.body?.note,
      createdBy: req.user._id,
    });
    res.status(201).json({
      success: true,
      message: "Invite link created. Send it to the person who will manage this branch.",
      // The only time the plain token exists — the website builds the link from it.
      token,
      data: inviteShape(invite),
    });
  } catch (err) {
    if (err instanceof InviteError) return bad(res, err.message, err.status);
    console.error("createBranchAdminInvite failed:", err.message);
    bad(res, "Could not create the invite link", 500);
  }
};

// DELETE /api/branches/:id/admin-invites/:inviteId
export const cancelBranchAdminInvite = async (req, res) => {
  try {
    const ok = await revokeInvite({
      inviteId: req.params.inviteId,
      type: "branch-admin",
      company: getCompanyId(),
      branch: req.params.id,
    });
    if (!ok) return bad(res, "That link is already used or cancelled", 404);
    res.json({ success: true, message: "Invite link cancelled" });
  } catch (err) {
    console.error("cancelBranchAdminInvite failed:", err.message);
    bad(res, "Could not cancel the link", 500);
  }
};

export const validateBranchIds = (req, res, next) => {
  if (!isId(req.params.id) || (req.params.inviteId && !isId(req.params.inviteId))) {
    return bad(res, "Invalid id", 400);
  }
  next();
};
