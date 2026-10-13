// src/utils/authUser.js
// Single source of truth for "who is logged in / what role are they" so
// Sidebar, DashboardLayout, HrmDashboard, App, etc. all agree.
//
// Prefers the JSON "user" blob written by Login.jsx, but falls back to the
// older flat "email"/"role"/"username" keys.

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
export const hasTabAccess = (tabKey, user = getCurrentUser()) => {
  const role = (user?.role || "").toLowerCase();
  if (role === "super-admin") return true;
  if (role !== "admin") return false;
  const perms = user?.permissions || {};
  if (perms.allTabs) return true;
  return Array.isArray(perms.tabs) && perms.tabs.includes(tabKey);
};
