import User from "../models/User.js";
import { performSelfCheckIn } from "./leave.js";
import jwt from "jsonwebtoken";

// Generate JWT Token
const generateToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });
};

// @desc    Check whether an admin account already exists
// @route   GET /api/auth/admin-exists
// @access  Public
export const checkAdminExists = async (req, res) => {
  try {
    const adminCount = await User.countDocuments({ role: "admin" });
    res.status(200).json({
      success: true,
      exists: adminCount > 0,
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

    // Public sign-up is only meant to bootstrap the very first admin
    // account. Once one exists, block further sign-ups here — additional
    // staff/user accounts must be created by an admin from the Staff page.
    const adminAlreadyExists = await User.exists({ role: "admin" });
    if (adminAlreadyExists) {
      return res.status(403).json({
        success: false,
        message:
          "An admin account already exists. Please ask your administrator to create your account.",
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

    // Create user — sign-up always creates the admin account. Any role
    // passed in the request body is intentionally ignored so a caller
    // can never elevate themselves any other way through this endpoint.
    const user = await User.create({
      firstName,
      lastName,
      email: normalizedEmail,
      contactNumber: finalContactNumber,
      password,
      role: "admin",
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
    console.log('values of  email', email);
    console.log('value of password', password);
    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password",
      });
    }

    // The User schema normalizes email to lowercase + trimmed on save
    // (see models/User.js: `lowercase: true, trim: true`), but Mongo string
    // matches are case-sensitive. Without normalizing here too, a correct
    // password would still fail with 401 "Invalid credentials" any time the
    // email was typed with different casing or stray whitespace than it was
    // registered with — so always normalize the lookup the same way.
    const normalizedEmail = String(email).trim().toLowerCase();

    // Find user with password
    const user = await User.findOne({ email: normalizedEmail }).select("+password");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }
    console.log('value of user 132', user);
    console.log('values of 133 password', password);
    // Check password
    const isMatch = await user.comparePassword(password);
    console.log('value of ismatch', isMatch);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Auto sign-in for attendance the moment a non-admin user logs in, so
    // the dashboard's Attendance card shows "Sign Out" right away instead of
    // requiring a separate manual "Sign In" click immediately after login.
    // Failures here (e.g. it's a Sunday/holiday) must never block login itself.
    if (user.role !== "admin") {
      try {
        await performSelfCheckIn(user._id);
      } catch (attErr) {
        console.error("Auto check-in on login failed:", attErr.message);
      }
    }

    // Generate token
    const token = generateToken(user);
    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        token,
      },
      
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: error.message,
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
