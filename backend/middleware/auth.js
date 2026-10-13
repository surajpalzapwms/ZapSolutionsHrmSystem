import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Staff from "../models/Staff.js";
import { validationResult } from "express-validator";
import { isAdminRole } from "../config/permissions.js";

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

  const user = await User.findById(userId).select("-password");
  let blocked = false;
  let inactive = false;
  if (user && user.role !== "super-admin" && user.isActive === false) {
    inactive = true;
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

    req.user = user;
    next();
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

// Accepts both "admin" and "superadmin" — a super admin should never be
// blocked from anything an admin can do.
export const allowAdminOnly = async (req, res, next) => {
  if (req.user && isAdminRole(req.user.role)) {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: "Access denied. Admin only.",
    });
  }
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