import User from "../models/User.js";
import { performSelfCheckIn } from "./leave.js";
import jwt from "jsonwebtoken";
import { ALL_TAB_KEYS, TAB_TREE, isAdminRole } from "../config/permissions.js";
import { isFromOfficeNetwork } from "../utils/officeNetwork.js";

// Generate JWT Token
const generateToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });
};

// @desc    Check whether the very first (super admin) account already
//          exists. Public sign-up only ever bootstraps that one account,
//          so this checks for *any* user at all, not just role "admin" —
//          otherwise a second person could still hit /register and create
//          a competing super admin after the first admin/user was made.
// @route   GET /api/auth/admin-exists
// @access  Public
export const checkAdminExists = async (req, res) => {
  try {
    const userCount = await User.countDocuments({});
    res.status(200).json({
      success: true,
      exists: userCount > 0,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to check admin status",
      error: error.message,
    });
  }
};

// Splits a single combined "name" into (firstName, lastName) — used when a
// client sends `name` instead of separate `firstName`/`lastName` fields.
// Single-word names leave lastName blank rather than repeating firstName.
const splitName = (fullName) => {
  const parts = String(fullName).trim().split(/\s+/);
  const firstName = parts[0] || "";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return { firstName, lastName };
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
export const register = async (req, res) => {
  try {
    let { firstName, lastName, name, email, contactNumber, password } =
      req.body;

    // Accept a single combined `name` field as a fallback for clients that
    // don't send firstName/lastName separately (e.g. a simple test form).
    if ((!firstName || !lastName) && name) {
      const split = splitName(name);
      firstName = firstName || split.firstName;
      lastName = lastName || split.lastName;
    }

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        message:
          "First name, last name, email and password are required",
      });
    }

    // Contact number is nice-to-have but not required to sign up — fall
    // back to a placeholder so User's schema validation (which requires
    // one) doesn't block registration when a client omits it.
    const finalContactNumber = contactNumber?.trim() || "0000000000";

    // Public sign-up is only meant to bootstrap the very first account —
    // that account becomes the super admin. Once ANY user exists, block
    // further sign-ups here — additional staff/admin accounts must be
    // created by the super admin from the Staff page.
    const anyUserAlreadyExists = await User.exists({});
    if (anyUserAlreadyExists) {
      return res.status(403).json({
        success: false,
        message:
          "An account already exists. Please ask your administrator to create your account.",
      });
    }

    // Normalize the same way the schema will store it (lowercase + trim),
    // so the duplicate check below actually catches case-variant emails
    // instead of letting "a@b.com" and "A@B.com" both register.
    const normalizedEmail = String(email).trim().toLowerCase();

    // Check if user exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    // Create user — sign-up always creates the FIRST account, and the
    // first account is always the super admin (full access to every tab,
    // and the only role that can promote staff to admin / manage admin
    // permissions). Any role passed in the request body is intentionally
    // ignored so a caller can never elevate themselves any other way
    // through this endpoint.
    const user = await User.create({
      firstName,
      lastName,
      email: normalizedEmail,
      contactNumber: finalContactNumber,
      password,
      role: "super-admin",
      permissions: { allTabs: true, tabs: [] },
    });

    // Generate token
    const token = generateToken(user);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        email: user.email,
        contactNumber: user.contactNumber,
        role: user.role,
        token,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      message: "Registration failed",
      error: error.message,
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password",
      });
    }

    const emailAsString = String(email);
    const trimmedEmail = emailAsString.trim();
    const normalizedEmail = trimmedEmail.toLowerCase();
    const user = await User.findOne({
      email: normalizedEmail,
    }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }
    user.lastLogin = new Date();
    await user.save();

    // Non-admin logins auto check-in for attendance — but only from the
    // office network, same rule as the silent auto-checkin fired on app
    // load (see autoCheckIn in controllers/leave.js). Otherwise logging in
    // from home would mark attendance while opening the app from home
    // wouldn't, which would be an inconsistent (and gameable) rule.
    // Failure here should never block login itself.
    if (!isAdminRole(user.role) && isFromOfficeNetwork(req)) {
      try {
        await performSelfCheckIn(user._id);
      } catch (attErr) {
        console.error("Auto attendance check-in failed:", attErr.message);
      }
    }

    const token = generateToken(user);

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        token,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
};


// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get user",
      error: error.message,
    });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
export const logout = async (req, res) => {
  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
};

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide current and new password",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters",
      });
    }

    const user = await User.findById(req.user.id).select("+password");
    const isMatch = await user.comparePassword(currentPassword);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to change password",
      error: error.message,
    });
  }
};

// @desc    Get the canonical tab/sub-tab tree used to render the
//          Permissions checkboxes (Show All + one row per tab, with
//          sub-tabs nested underneath).
// @route   GET /api/auth/permission-tabs
// @access  Private (any logged-in user — it's just static config)
export const getPermissionTabs = async (req, res) => {
  res.status(200).json({ success: true, data: TAB_TREE });
};

// @desc    List every account (super admin, admin, and plain staff) so the
//          Permissions screen can show one combined table — who's staff,
//          who's an admin, what tabs each admin/staff has, and which
//          staff logins are eligible to be promoted to admin.
// @route   GET /api/auth/admins
// @access  Private (super admin only)
// Sort order: super-admin first, then admin, then staff — alphabetical
// within each group — so the table reads role-grouped rather than by
// creation date.
const ROLE_SORT_RANK = { "super-admin": 0, admin: 1, user: 2 };
export const listAdmins = async (req, res) => {
  try {
    const accounts = await User.find({}).select("-password").lean();
    accounts.sort((a, b) => {
      const rankDiff = (ROLE_SORT_RANK[a.role] ?? 3) - (ROLE_SORT_RANK[b.role] ?? 3);
      if (rankDiff !== 0) return rankDiff;
      return (a.name || a.firstName || "").localeCompare(b.name || b.firstName || "");
    });
    res.status(200).json({ success: true, data: accounts });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to load accounts",
      error: error.message,
    });
  }
};

// @desc    Update which tabs/sub-tabs a given admin can see, promote a
//          plain staff login to admin (with an initial set of tabs), or
//          revoke admin access entirely back to a plain staff login.
// @route   PUT /api/auth/admins/:id/permissions
// @access  Private (super admin only)
// Body: { allTabs?: boolean, tabs?: string[], revoke?: boolean, makeAdmin?: boolean }
export const updateAdminPermissions = async (req, res) => {
  try {
    const { allTabs, tabs, revoke, makeAdmin } = req.body;

    const target = await User.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }
    // Can only manage accounts that are (or are becoming) admins — never
    // another super admin, and never touch role directly here except the
    // explicit "revoke" / "makeAdmin" paths below.
    if (target.role === "super-admin") {
      return res.status(403).json({
        success: false,
        message: "Super admin permissions can't be changed",
      });
    }

    if (revoke) {
      target.role = "user";
      target.permissions = { allTabs: false, tabs: [] };
      await target.save();
      return res.status(200).json({
        success: true,
        message: "Admin access revoked",
        data: target,
      });
    }

    // Promote a plain staff login ("user") to "admin". Falls through to the
    // same tab-assignment logic below, so the caller can grant tabs in the
    // same request that makes the account an admin.
    if (target.role === "user") {
      if (!makeAdmin) {
        return res.status(400).json({
          success: false,
          message: "This account is not an admin",
        });
      }
      target.role = "admin";
    }

    // Filter out anything that isn't a real tab/sub-tab key so a stale or
    // hand-crafted request can't smuggle in junk.
    const safeTabs = Array.isArray(tabs)
      ? tabs.filter((t) => ALL_TAB_KEYS.includes(t))
      : target.permissions?.tabs || [];

    target.permissions = {
      allTabs: Boolean(allTabs),
      tabs: safeTabs,
    };
    await target.save();

    res.status(200).json({
      success: true,
      message: makeAdmin ? "Account promoted to admin" : "Permissions updated",
      data: target,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update permissions",
      error: error.message,
    });
  }
};
