// src/utils/authUser.js
// Single source of truth for "who is logged in / what role are they" so
// Sidebar, DashboardLayout, HrmDashboard, App, etc. all agree.
//
// Prefers the JSON "user" blob written by Login.jsx, but falls back to the
// older flat "email"/"role"/"username" keys.

import { ALWAYS_ON_COMPANY_TABS, TABS_ADDED_IN_V2 } from "./permissionTabs";
import { isOwnerCompany } from "./company";

export const getCurrentUser = () => {
  try {
    const raw = localStorage.getItem("user");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed._id ||
          parsed.id ||
          parsed.name ||
          parsed.firstName ||
          parsed.email)
      ) {
        return parsed;
      }
    }
  } catch {
    /* ignore parse errors, fall through to flat-key lookup */
  }

  const email = localStorage.getItem("email");
  const role = localStorage.getItem("role");
  const username = localStorage.getItem("username");

  if (email || role || username) {
    return {
      id: null,
      name: username || email || "User",
      email: email || null,
      role: role || null,
      username: username || email || null,
    };
  }

  return null;
};

// Backend's User model assigns one of three roles (see backend/models/User.js):
// "superadmin" (the first account ever created — always full access),
// "admin" (a staff member promoted by the super admin — sees only the
// tabs/sub-tabs granted in `permissions`), or "user" (regular staff, no
// management access). "Admin-ish" here means either admin or superadmin,
// matching what the backend's allowAdminOnly middleware accepts.
export const isSuperAdminUser = (user = getCurrentUser()) =>
  (user?.role || "").toLowerCase() === "super-admin";

export const isAdminUser = (user = getCurrentUser()) =>
  ["admin", "super-admin"].includes((user?.role || "").toLowerCase());

// Does this user have access to a given tab/sub-tab key (see
// utils/permissionTabs.js)? Superadmin always does. An admin only does if
// they were granted "Show All" or that specific key. A plain "user" never
// does — this helper is only meant for management-tab gating.
// White label: tabs the COMPANY has. null / missing = every tab. Staff list
// and the company profile (settings) are always on.
const ALWAYS_ON = ALWAYS_ON_COMPANY_TABS; // Dashboard, Staff, Company Profile
// The company in use: the login's own, or the one the super admin opened.
export const activeCompanyOf = (user = getCurrentUser()) => {
  let company = user?.company || null;
  if ((user?.role || "").toLowerCase() === "super-admin") {
    try {
      company = JSON.parse(localStorage.getItem("selectedCompany") || "null") || company;
    } catch {
      /* ignore */
    }
  }
  return company;
};
// false = this company has no Internship / Probation (set by the super admin).
export const companyUsesProbation = (user = getCurrentUser()) =>
  activeCompanyOf(user)?.probationEnabled !== false;

export const companyHasTab = (tabKey, user = getCurrentUser()) => {
  let company = user?.company || null;
  if ((user?.role || "").toLowerCase() === "super-admin") {
    try {
      company = JSON.parse(localStorage.getItem("selectedCompany") || "null") || company;
    } catch {
      /* ignore */
    }
  }
  const tabs = company?.enabledTabs;
  if (!Array.isArray(tabs)) return true;
  const top = String(tabKey || "").split(".")[0];
  if (ALWAYS_ON.includes(top)) return true;
  // Tabs added later stay ON for a company saved before they existed.
  if ((company?.tabsVersion || 1) < 2 && TABS_ADDED_IN_V2.includes(top)) return true;
  return tabs.includes(top);
};

// Super admin looking at a CLIENT company (not the owner company): view only.
// That company's own admin adds / edits its records, so every add / import /
// delete button is hidden for the super admin there (the server refuses
// those writes too — see backend middleware/auth.js).
export const isCompanyViewOnly = (user = getCurrentUser()) => {
  if ((user?.role || "").toLowerCase() !== "super-admin") return false;
  try {
    const company = JSON.parse(localStorage.getItem("selectedCompany") || "null");
    return !!company?._id && !isOwnerCompany(company);
  } catch {
    return false;
  }
};

export const hasTabAccess = (tabKey, user = getCurrentUser()) => {
  if (!companyHasTab(tabKey, user)) return false;
  // "staff.add", "payroll.add" ... are write actions: not for view-only.
  if (String(tabKey || "").includes(".") && isCompanyViewOnly(user)) return false;
  const role = (user?.role || "").toLowerCase();
  if (role === "super-admin") return true;
  if (role !== "admin") return false;
  const perms = user?.permissions || {};
  if (perms.allTabs) return true;
  return Array.isArray(perms.tabs) && perms.tabs.includes(tabKey);
};

// A BRANCH admin is an admin that belongs to one branch of the company. They
// only see that branch's staff and cannot manage branches, invite admins or
// edit the company profile.
export const isBranchAdminUser = (user = getCurrentUser()) =>
  (user?.role || "").toLowerCase() === "admin" && !!user?.branch;

// The super admin, or THE admin of a company (not a branch admin). These can
// manage branches.
export const isCompanyLevelUser = (user = getCurrentUser()) =>
  isSuperAdminUser(user) ||
  ((user?.role || "").toLowerCase() === "admin" && !user?.branch);
