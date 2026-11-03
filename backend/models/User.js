import mongoose from "mongoose";
import "../utils/tenant.js"; // registers the per-company plugin first
import { encryptPassword } from "../utils/passwordVault.js";
import bcrypt from "bcryptjs";
import { hasTabAccess } from "../config/permissions.js";

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
    },
    lastName: {
      type: String,
      required: false, // optional — e.g. a one-word name like "Zac"
      trim: true,
    },
    name: {
      type: String,
      trim: true,
    },
    contactNumber: {
      type: String,
      required: [true, "Contact number is required"],
      trim: true,
      // "+<country code> <number>", e.g. "+91 9876543210" (old plain digits still pass).
      match: [/^\+?[0-9\s\-]{7,22}$/, "Please enter a valid contact number"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false,
    },
    // Company ADMIN logins only: an encrypted (AES-GCM, utils/passwordVault)
    // copy of the password, so the super admin's "copy login link" can fill
    // it in on the login page. Never sent in normal API responses.
    passwordEncrypted: { type: String, select: false },
    // "superadmin" — the very first account ever registered; always has
    // full access to every tab, can create staff/admins and manage admin
    // permissions. "admin" — a staff member promoted by a super admin;
    // sees only the tabs/sub-tabs granted in `permissions`. "user" — a
    // regular staff login with no management access at all.
    role: {
      type: String,
      enum: ["super-admin", "admin", "user"],
      default: "user",
    },
    // Only meaningful for role "admin" (ignored for superadmin, which is
    // always full-access, and for "user", which never sees these tabs).
    // `allTabs: true` is the "Show All" master checkbox on the Permissions
    // screen — it overrides `tabs` and grants every current and future tab.
    permissions: {
      allTabs: { type: Boolean, default: false },
      tabs: { type: [String], default: [] },
    },
    // Branch of the company this login belongs to (null = whole company).
    // An admin WITH a branch is a BRANCH ADMIN: they only see that branch's
    // staff (see utils/tenant.js) and cannot create branches or other admins.
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
    },
    // Set only on admins created through an invite link:
    //   "company" -> THE admin of the company (one per company)
    //   "branch"  -> THE admin of one branch  (one per branch)
    // The partial unique indexes below make "one admin" a database rule, so
    // two people opening links at the same moment still cannot both win.
    adminScope: {
      type: String,
      enum: ["company", "branch"],
      default: undefined,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    // Per-user shift window, "HH:mm" 24-hour format. Defaults to the
    // general office timing (10:00 AM – 6:30 PM). Staff who come in early
    // (e.g. 9:00 AM – 5:30 PM) can have these overridden by an admin. Both
    // shifts span 8.5 hours, so after the 45-minute lunch break is
    // subtracted, either shift requires the same 7h 45m of net working time.
    shiftStartTime: {
      type: String,
      default: "10:00",
    },
    shiftEndTime: {
      type: String,
      default: "18:30",
    },
    // Set when this ACCOUNT (no Staff record, e.g. the super admin) has its
    // own profile photo — see models/UserPhoto.js.
    photoUpdatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    // Users belong to one company, except the super admin (no company) who
    // must stay visible inside every company (see utils/tenant.js).
    tenantMode: "user",
  },
);

userSchema.index({ company: 1 }, { unique: true, partialFilterExpression: { adminScope: "company" } });
userSchema.index({ branch: 1 }, { unique: true, partialFilterExpression: { adminScope: "branch" } });

// Keep `name` in sync with firstName + lastName for any code that still reads it
userSchema.pre("validate", function (next) {
  if (this.firstName || this.lastName) {
    this.name = `${this.firstName || ""} ${this.lastName || ""}`.trim();
  }
  next();
});

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  if (this.role === "admin") this.passwordEncrypted = encryptPassword(this.password);
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Does this user have access to the given tab/sub-tab key? Superadmin is
// always true; admin depends on permissions.allTabs / permissions.tabs;
// a plain "user" is always false.
userSchema.methods.hasTabAccess = function (tabKey) {
  return hasTabAccess(this, tabKey);
};

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", userSchema);
export default User;
