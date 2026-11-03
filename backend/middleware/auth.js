import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Staff from "../models/Staff.js";
import { validationResult } from "express-validator";
import { isAdminRole, companyTabForPath, companyHasTab } from "../config/permissions.js";
import Branch from "../models/Branch.js";
import { runWithCompany, runUnscoped } from "../utils/tenant.js";
import { findCompanyCached } from "../services/companyRegistry.js";
import { listRegisteredCompanies } from "../utils/companyContext.js";
import { isOwnerCompany } from "../utils/ownerCompany.js";

// PERFORMANCE: every API request runs protect(), which looked the user up in
// the database (plus a Staff lookup for plain staff logins). The dashboard
// fires ~9 requests at once, so that was ~9-18 extra database round trips
// per page load. The result is now kept for a short time per user id.
// It is cleared on any write to auth/staff/HRM routes (see server.js), so a
// role change, permission change or a staff member being relieved still
// takes effect immediately; the TTL is only a safety net.
const AUTH_CACHE_TTL_MS = 30 * 1000;
const authUserCache = new Map(); // userId -> { user, blocked, expiresAt }

export const clearAuthUserCache = () => authUserCache.clear();

const loadAuthUser = async (userId) => {
  const hit = authUserCache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit;

  const user = await runUnscoped(() => User.findById(userId).select("-password"));
  if (user && user.role !== "super-admin" && user.company) {
    // Staff lookups below must only see this user's company.
    return runWithCompany(user.company, () => finishAuthUser(userId, user));
  }
  return finishAuthUser(userId, user);
};

const finishAuthUser = async (userId, user) => {
  let blocked = false;
  let inactive = false;
  if (user && user.role !== "super-admin" && user.isActive === false) {
    inactive = true;
  }
  // A branch admin is locked out while their branch is inactive / deleted.
  if (user && user.role === "admin" && user.branch) {
    const branch = await runUnscoped(() => Branch.findById(user.branch).select("isActive").lean());
    if (!branch || branch.isActive === false) inactive = true;
  }
  if (user && user.role !== "super-admin" && user.email) {
    const staffInactive = await Staff.findOne({ email: user.email.toLowerCase().trim() })
      .select("enabled")
      .lean();
    if (staffInactive && staffInactive.enabled === false) inactive = true;
  }
  if (user && user.role === "user" && user.email) {
    const staff = await Staff.findOne({ email: user.email.toLowerCase().trim() })
      .select("status relievingDate enabled")
      .lean();
    // Active toggle wins: an explicitly Active staff is never "relieved-blocked".
    if (
      staff?.enabled !== true &&
      staff?.status === "Relieved" &&
      staff.relievingDate
    ) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const relievingDate = new Date(staff.relievingDate);
      relievingDate.setHours(0, 0, 0, 0);
      blocked = relievingDate <= today;
    }
  }
  const entry = { user, blocked, inactive, expiresAt: Date.now() + AUTH_CACHE_TTL_MS };
  if (authUserCache.size > 1000) authUserCache.clear();
  authUserCache.set(userId, entry);
  return entry;
};

export const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, no token provided",
        code: "NO_TOKEN",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { user, blocked, inactive } = await loadAuthUser(
      String(decoded.id),
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, user not found",
        code: "TOKEN_INVALID",
      });
    }

    // A plain staff login (role "user") that has since been marked
    // "Relieved" (past relieving date) can't keep using an already-issued
    // token either.
    // Set Inactive by an admin after the token was issued — stop it too.
    if (inactive) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to login because admin has deactivated you.",
        code: "STAFF_INACTIVE",
      });
    }

    if (blocked) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to login because admin has deactivated you.",
        code: "STAFF_RELIEVED",
      });
    }

    const ctx = await resolveRequestCompany(req, user);
    if (ctx.error) return res.status(ctx.error.status).json(ctx.error.body);

    req.user = user;
    req.company = ctx.company; // null only for the super admin's own screens
    // Everything after this point (controllers, services, every mongoose
    // query) runs limited to this company — see utils/tenant.js.
    // A BRANCH admin is additionally limited to their own branch's staff.
    const branchId = user.role === "admin" && user.branch ? user.branch : null;
    return runWithCompany(ctx.company?._id || null, () => next(), { branchId });
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
        code: "TOKEN_INVALID",
      });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired",
        code: "TOKEN_EXPIRED",
      });
    }
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// ── Which company does this request work on? ──────────────────────────────
// - admin / staff: always their own company (from their login).
// - super admin: the company opened on the website, sent as the
//   X-Company-Id header. With only ONE company it is used automatically
//   (so the mobile app / old clients keep working). Without a company the
//   super admin can only reach the company management screens.
const SUPER_ADMIN_GLOBAL_PATHS = [
  "/api/company",
  "/api/auth/me",
  "/api/auth/logout",
  "/api/auth/change-password",
  "/api/auth/permission-tabs",
  "/api/documents/me",
];

const fail = (status, message, code, extra = {}) => ({
  error: { status, body: { success: false, message, code, ...extra } },
});

export const resolveRequestCompany = async (req, user) => {
  const path = (req.originalUrl || req.url || "").split("?")[0];
  const isSuper = (user.role || "").toLowerCase() === "super-admin";
  let company = null;

  if (isSuper) {
    const wanted = String(req.get("x-company-id") || "").trim();
    if (wanted && wanted !== "null" && wanted !== "undefined") {
      if (!/^[a-f0-9]{24}$/i.test(wanted)) return fail(400, "Invalid company", "COMPANY_INVALID");
      company = await findCompanyCached(wanted);
      if (!company) return fail(404, "This company no longer exists", "COMPANY_NOT_FOUND");
    } else {
      const all = listRegisteredCompanies();
      if (all.length === 1) company = all[0];
    }
    const onGlobalPath = SUPER_ADMIN_GLOBAL_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
    if (!company) {
      if (onGlobalPath) return { company: null };
      return fail(400, "Open a company first.", "COMPANY_REQUIRED");
    }
    // The super admin can VIEW every company, but can add / edit / delete
    // only inside the owner company (ZAP Solutionz). A client company's data
    // belongs to its own admin: every write (POST / PUT / PATCH / DELETE) on it
    // is refused. Company-list management (/api/company/:id ...) is separate.
    if (!isOwnerCompany(company)) {
      const readOnly = ["GET", "HEAD", "OPTIONS"].includes((req.method || "GET").toUpperCase());
      if (!readOnly) {
        if (onGlobalPath && !path.startsWith("/api/company/profile")) return { company: null };
        return fail(
          403,
          "View only. This company's admin adds and edits its own details.",
          "CLIENT_COMPANY_READ_ONLY",
        );
      }
    }
  } else {
    if (user.company) company = await findCompanyCached(user.company);
    if (!company) {
      // Older account saved before companies existed: only safe with one company.
      const all = listRegisteredCompanies();
      if (!user.company && all.length === 1) company = all[0];
    }
    if (!company) {
      return fail(403, "Your account is not linked to a company. Contact your administrator.", "COMPANY_MISSING");
    }
    if (company.isActive === false) {
      return fail(
        403,
        "Your company's account is inactive. Please contact the service provider.",
        "COMPANY_INACTIVE",
      );
    }
  }

  // Tabs the company does not have are closed for everyone (also the API,
  // so the mobile app is covered too).
  const tab = companyTabForPath(path);
  if (tab && !companyHasTab(company, tab)) {
    return fail(403, "This feature is not enabled for your company.", "TAB_DISABLED", { tab });
  }
  return { company };
};

// API areas a BRANCH admin may use as an admin. Only the Staff area is
// filtered per branch (see utils/tenant.js), so it is the only one open.
// Attendance, leave, payroll, letters, documents, holidays, office Wi-Fi ...
// are company-wide: letting a branch admin in would show them every branch's
// data, so they are closed (403 BRANCH_ADMIN_FORBIDDEN) until those modules
// are made per-branch. Add a prefix here once a module is.
const BRANCH_ADMIN_ALLOWED_PREFIXES = ["/api/staff"];

// Accepts both "admin" and "superadmin" — a super admin should never be
// blocked from anything an admin can do. A branch admin is an admin too, but
// limited to BRANCH_ADMIN_ALLOWED_PREFIXES.
export const allowAdminOnly = async (req, res, next) => {
  if (!(req.user && isAdminRole(req.user.role))) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin only.",
    });
  }
  if ((req.user.role || "").toLowerCase() === "admin" && req.user.branch) {
    const path = (req.originalUrl || req.url || "").split("?")[0];
    const allowed = BRANCH_ADMIN_ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: "Branch admins can only manage their own branch's staff.",
        code: "BRANCH_ADMIN_FORBIDDEN",
      });
    }
  }
  next();
};

// The company's own admin (no branch) or the super admin. Branch admins are
// refused: they cannot manage branches, invite admins or edit the company.
export const allowCompanyAdminOnly = async (req, res, next) => {
  const role = (req.user?.role || "").toLowerCase();
  if (role === "super-admin" || (role === "admin" && !req.user.branch)) return next();
  res.status(403).json({
    success: false,
    message: "Access denied. Only the company admin can do this.",
  });
};

// Strict: super admin only (used for admin-management/permissions routes).
export const allowSuperAdminOnly = async (req, res, next) => {
  if (req.user && (req.user.role || "").toLowerCase() === "super-admin") {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: "Access denied. Super admin only.",
    });
  }
};

export const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log("Validation errors:", errors.array()); // temp debug
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};