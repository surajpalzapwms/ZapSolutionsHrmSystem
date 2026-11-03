import User from "../models/User.js";
import Staff from "../models/Staff.js";
import { performSelfCheckIn } from "./leave.js";
import jwt from "jsonwebtoken";
import { effectiveEnabledTabs } from "../config/permissions.js";
import { isOwnerCompany } from "../utils/ownerCompany.js";
import {
  ALL_TAB_KEYS,
  isAdminRole,
  TAB_TREE,
} from "../config/permissions.js";
import { isFromOfficeNetwork } from "../utils/officeNetwork.js";
import { autoAttendanceApplies } from "../services/presence.js";
import { encryptPassword, decryptPassword } from "../utils/passwordVault.js";
import { photoUrlFor, userPhotoUrlFor } from "../utils/fileSigning.js";
import { enterCompany, runUnscoped } from "../utils/tenant.js";
import { findCompanyCached } from "../services/companyRegistry.js";
import { listRegisteredCompanies } from "../utils/companyContext.js";
import { buildProfile } from "../services/companyProfile.js";
import { branchSummary, findCompanyAdmin, ONE_COMPANY_ADMIN_MESSAGE } from "../services/adminRules.js";

// What the website / app need to know about the login's company.
const companyForClient = (company, req) => {
  if (!company) return null;
  const p = buildProfile(company, { baseUrl: `${req.protocol}://${req.get("host")}` });
  return {
    _id: String(company._id),
    name: company.name,
    slug: company.slug,
    country: p.country,
    currencyCode: p.currencyCode,
    timeZone: p.timeZone,
    weeklyOffDays: p.weeklyOffDays,
    workStartTime: p.workStartTime,
    workEndTime: p.workEndTime,
    shortSaturday: p.shortSaturday,
    shortSaturdayActive: p.shortSaturdayActive,
    saturdayStartTime: p.saturdayStartTime,
    saturdayEndTime: p.saturdayEndTime,
    logoUrl: p.logoUrl,
    primaryColor: p.primaryColor,
    sidebarColor: p.sidebarColor,
    rtl: p.rtl,
    // The owner company (ZAP Solutionz): the super admin has full access there.
    isOwner: isOwnerCompany(company),
    // null = every tab
    enabledTabs: effectiveEnabledTabs(company),
    tabsVersion: company.tabsVersion || 1,
    probationEnabled: company.probationEnabled !== false,
  };
};

// The photo shown in the website header / app profile for this login:
// the linked staff member's photo, else the account's own photo (super
// admin and other accounts without a Staff record — see models/UserPhoto.js).
const accountPhotoUrl = async (user) => {
  if (!user) return null;
  if (user.email) {
    const staff = await Staff.findOne({ email: String(user.email).toLowerCase().trim() })
      .select("_id photoUpdatedAt")
      .lean();
    const staffUrl = photoUrlFor(staff);
    if (staffUrl) return staffUrl;
  }
  return userPhotoUrlFor(user);
};

// Keeps the admin-viewable copy of a staff member's password (shown in the
// Staff History view) in step with the password they actually log in with.
// Staff and User are linked only by email. Never throws — a failure here
// must not break login or a password change.
const syncStaffViewablePassword = async (email, plainPassword) => {
  try {
    if (!email || !plainPassword) return;
    const staff = await Staff.findOne({ email: email.toLowerCase().trim() })
      .select("+passwordEncrypted")
      .lean();
    if (!staff) return;
    if (decryptPassword(staff.passwordEncrypted) === plainPassword) return;
    // updateOne skips the model hooks, so only the viewable copy changes —
    // login itself keeps using the User's bcrypt hash.
    await Staff.updateOne(
      { _id: staff._id },
      { $set: { passwordEncrypted: encryptPassword(plainPassword) } },
    );
  } catch (err) {
    console.error("Could not sync staff viewable password:", err.message);
  }
};

// Company admins created before the login link existed only have a bcrypt
// hash. The password just typed is correct, so keep an encrypted copy now —
// from then on the super admin's login link can fill it in. Never throws.
const syncAdminLinkPassword = async (user, plainPassword) => {
  try {
    if (!user || user.role !== "admin" || !plainPassword) return;
    const withEnc = await runUnscoped(() =>
      User.findById(user._id).select("+passwordEncrypted").lean(),
    );
    if (decryptPassword(withEnc?.passwordEncrypted) === plainPassword) return;
    await runUnscoped(() =>
      User.updateOne({ _id: user._id }, { $set: { passwordEncrypted: encryptPassword(plainPassword) } }),
    );
  } catch (err) {
    console.error("Could not store admin login-link password:", err.message);
  }
};

// ── Company login link (made by the super admin) ─────────────────────────
// GET /api/auth/login-link/:token  (public, rate limited)
// The token is a signed, short-lived JWT made by POST /api/company/:id/login-link.
// Answers the company admin's e-mail and password so the login page can fill
// them in. Nothing is returned once the link expires, the admin is removed /
// deactivated, or the company is inactive.
export const LOGIN_LINK_PURPOSE = "company-admin-login-link";

export const getLoginLink = async (req, res) => {
  const gone = (message = "This login link has expired. Ask for a new one.") =>
    res.status(410).json({ success: false, message, code: "LOGIN_LINK_INVALID" });
  try {
    let payload;
    try {
      payload = jwt.verify(String(req.params.token || ""), process.env.JWT_SECRET);
    } catch {
      return gone();
    }
    if (payload?.purpose !== LOGIN_LINK_PURPOSE || !payload.uid || !payload.cid) return gone();

    const company = await findCompanyCached(payload.cid);
    if (!company || company.isActive === false) return gone("This company is not active.");

    const user = await runUnscoped(() =>
      User.findOne({ _id: payload.uid, company: payload.cid, role: "admin" })
        .select("+passwordEncrypted email isActive")
        .lean(),
    );
    if (!user || user.isActive === false) return gone("This admin login is no longer active.");

    const password = decryptPassword(user.passwordEncrypted) || "";
    res.json({
      success: true,
      data: {
        identifier: user.email,
        password,
        // false = admin has not logged in since this feature was added; the
        // e-mail is filled in, the password must be typed once.
        hasPassword: Boolean(password),
        companySlug: company.slug,
      },
    });
  } catch (err) {
    console.error("getLoginLink failed:", err.message);
    res.status(500).json({ success: false, message: "Could not open this login link" });
  }
};

// Staff and User are only linked by email (no stored userId — same pattern
// used everywhere else in this codebase). Returns a short, user-facing
// reason string if this account belongs to a staff member who has already
// left the organization (status "Relieved" with a relieving date that has
// actually passed), or null if login should be allowed to proceed.
const getRelievedLoginBlockReason = async (email) => {
  if (!email) return null;
  const staff = await Staff.findOne({ email: email.toLowerCase().trim() })
    .select("status relievingDate enabled")
    .lean();
  if (!staff) return null;
  // The Active/Inactive toggle on the Staff page is the final word:
  // Active => allowed to log in (even if the status is Relieved);
  // Inactive => blocked (handled by getInactiveLoginBlockReason below).
  if (staff.enabled === true || staff.enabled === false) return null;
  // Old records with no Active flag at all: fall back to the Relieved rule.
  if (staff.status !== "Relieved" || !staff.relievingDate) {
    return null;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const relievingDate = new Date(staff.relievingDate);
  relievingDate.setHours(0, 0, 0, 0);
  if (relievingDate > today) return null; // relieving date hasn't arrived yet
  return "You are not allowed to login because admin has deactivated you.";
};

// Returns a message if this login account has been set Inactive by an admin
// (Staff.enabled === false, or User.isActive === false), else null. The
// super admin is exempt so an admin can never lock everyone out.
const INACTIVE_MESSAGE =
  "You are not allowed to login because admin has deactivated you.";
const getInactiveLoginBlockReason = async (user) => {
  if (!user || user.role === "super-admin") return null;
  if (user.isActive === false) return INACTIVE_MESSAGE;
  if (!user.email) return null;
  const staff = await Staff.findOne({ email: user.email.toLowerCase().trim() })
    .select("enabled")
    .lean();
  if (staff && staff.enabled === false) return INACTIVE_MESSAGE;
  return null;
};

// Generate JWT Token
// The phone app keeps marking attendance in the background (Wi-Fi / GPS)
// without the user opening it, so its session must not run out after a
// week — otherwise attendance silently stops until they log in again.
const generateToken = (user, { client } = {}) => {
  const expiresIn =
    client === "mobile"
      ? process.env.MOBILE_JWT_EXPIRE || "365d"
      : process.env.JWT_EXPIRE || "7d";
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn,
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

// Turns what was typed in the login box into the account's e-mail.
// Anything with an "@" is an e-mail; anything else is treated as a Staff ID
// (case-insensitive, so "zs0019" finds "ZS0019") and mapped to that staff
// member's e-mail — the login account (User) is linked to Staff by e-mail,
// so the password is the same whichever one is used.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Staff IDs are unique per COMPANY only, so a Staff ID login is looked up
// in the company of the login page (?company=slug -> body.company). Without
// it, it only works when that Staff ID exists in exactly one company.
const resolveLoginEmail = async (identifier, companySlug) => {
  const raw = String(identifier || "").trim();
  if (!raw) return { email: null };
  if (raw.includes("@")) return { email: raw.toLowerCase() };
  const filter = { staffId: new RegExp(`^${escapeRegex(raw)}$`, "i") };
  const slug = String(companySlug || "").trim().toLowerCase();
  if (slug) {
    const company = listRegisteredCompanies().find((c) => c.slug === slug);
    if (company) filter.company = company._id;
  }
  const matches = await runUnscoped(() => Staff.find(filter).select("email").limit(2).lean());
  if (matches.length > 1) return { ambiguous: true };
  const staff = matches[0];
  return { email: staff?.email ? String(staff.email).trim().toLowerCase() : null };
};

// @desc    Login user (e-mail OR Staff ID + password)
// @route   POST /api/auth/login
// @access  Public
export const login = async (req, res) => {
  try {
    // `identifier` is either an e-mail ("suraj@zapwms.com") or a Staff ID
    // ("ZS0019"). Older clients send it as `email`, so both keys work.
    const body = req.body || {};
    const identifier = body.identifier ?? body.email ?? body.staffId;
    const { password } = body;
    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide your email or Staff ID and password",
      });
    }

    const resolved = await resolveLoginEmail(identifier, body.company);
    if (resolved.ambiguous) {
      return res.status(400).json({
        success: false,
        message: "This Staff ID is used in more than one company. Please log in with your e-mail.",
        code: "STAFF_ID_AMBIGUOUS",
      });
    }
    const normalizedEmail = resolved.email;
    // Login e-mails are unique across all companies.
    const user = normalizedEmail
      ? await runUnscoped(() => User.findOne({ email: normalizedEmail }).select("+password"))
      : null;
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // From here on every lookup is limited to the user's company.
    let company = null;
    if (user.role !== "super-admin") {
      company = user.company ? await findCompanyCached(user.company) : null;
      if (!company && !user.company && listRegisteredCompanies().length === 1) {
        company = listRegisteredCompanies()[0];
      }
      if (!company) {
        return res.status(403).json({
          success: false,
          message: "Your account is not linked to a company. Contact your administrator.",
          code: "COMPANY_MISSING",
        });
      }
      if (company.isActive === false) {
        return res.status(403).json({
          success: false,
          message: "Your company's account is inactive. Please contact the service provider.",
          code: "COMPANY_INACTIVE",
        });
      }
      enterCompany(company._id);
    } else if (listRegisteredCompanies().length === 1) {
      company = listRegisteredCompanies()[0];
    }

    // Accounts created before passwords were kept viewable only have a
    // bcrypt hash, which can't be reversed. The password just typed is the
    // correct one, so store it now — from then on it shows in History.
    await syncStaffViewablePassword(user.email, password);
    await syncAdminLinkPassword(user, password);

    // Block login for staff who have already left (Relieved + date passed).
    const relievedBlockReason = await getRelievedLoginBlockReason(user.email);
    if (relievedBlockReason) {
      return res.status(403).json({
        success: false,
        message: relievedBlockReason,
        code: "STAFF_RELIEVED",
      });
    }

    // Block login for staff an admin has set to Inactive.
    const inactiveBlockReason = await getInactiveLoginBlockReason(user);
    if (inactiveBlockReason) {
      return res.status(403).json({
        success: false,
        message: inactiveBlockReason,
        code: "STAFF_INACTIVE",
      });
    }

    user.lastLogin = new Date();
    await user.save();

    // Automatic check-in when logging in from the office Wi-Fi. Admins are
    // included unless AUTO_ATTENDANCE_INCLUDE_ADMINS=false; the super admin
    // never is (no staff record).
    if (autoAttendanceApplies(user.role) && isFromOfficeNetwork(req)) {
      try {
        await performSelfCheckIn(user._id, { source: "auto" });
      } catch (attErr) {
        // Attendance must never block a login.
        console.error("Automatic check-in at login failed:", attErr.message);
      }
    }

    const token = generateToken(user, { client: req.body?.client });

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        photoUrl: await accountPhotoUrl(user),
        // The super admin has no company of their own (null) unless the
        // installation has only one.
        company: companyForClient(company, req),
        // null = the whole company; a branch admin (and their staff) has one.
        branch: await branchSummary(user.branch),
        token,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ success: false, message: "Login failed" });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req, res) => {
  try {
    const { company: _companyId, ...user } =
      (await User.findById(req.user.id).select("-password").lean()) || {};
    res.status(200).json({
      success: true,
      data: {
        ...user,
        photoUrl: await accountPhotoUrl(user),
        // The company this request works on (the super admin's open one).
        company: companyForClient(req.company, req),
        branch: await branchSummary(user.branch),
      },
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

    // Without this, the Staff History view keeps showing the old password.
    await syncStaffViewablePassword(user.email, newPassword);
    // (admin's encrypted copy is updated by the User model's save hook)

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
      target.adminScope = undefined; // frees the company's / branch's single admin seat
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
      // Promoting staff to admin would create a second admin for the company.
      // Admins now come only from invite links (one per company / per branch).
      const existing = target.company ? await findCompanyAdmin(target.company) : null;
      return res.status(409).json({
        success: false,
        message: existing
          ? ONE_COMPANY_ADMIN_MESSAGE
          : "Admin logins are created with an invite link now. Open Companies → Admins and generate the company admin link.",
      });
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
