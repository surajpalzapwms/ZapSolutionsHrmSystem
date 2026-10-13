import mongoose from "mongoose";
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
      match: [/^[0-9+\-\s]{7,15}$/, "Please enter a valid contact number"],
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
  },
  {
    timestamps: true,
  },
);

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
