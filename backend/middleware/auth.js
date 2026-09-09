import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Staff from "../models/Staff.js";
import { validationResult } from "express-validator";
import { isAdminRole } from "../config/permissions.js";

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
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, user not found",
        code: "TOKEN_INVALID",
      });
    }

    // A plain staff login (role "user") that has since been marked
    // "Relieving" (past relieving date) shouldn't be able to keep using an
    // already-issued token either — otherwise blocking login alone would
    // only stop a *new* sign-in, not someone still signed in from before
    // they left. Scoped to role "user" only, so this extra lookup never
    // runs on admin/super-admin requests.
    if (user.role === "user" && user.email) {
      const staff = await Staff.findOne({ email: user.email.toLowerCase().trim() })
        .select("status relievingDate")
        .lean();
      if (staff?.status === "Relieving" && staff.relievingDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const relievingDate = new Date(staff.relievingDate);
        relievingDate.setHours(0, 0, 0, 0);
        if (relievingDate <= today) {
          return res.status(403).json({
            success: false,
            message: "You are not allowed to login because admin has deactivated you.",
            code: "STAFF_RELIEVED",
          });
        }
      }
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