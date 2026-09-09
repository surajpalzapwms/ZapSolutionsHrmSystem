// config/permissions.js
//
// Single source of truth for the tabs/sub-tabs that a super admin can grant
// to an admin account. Keep the `key` values in sync with the frontend copy
// at src/utils/permissionTabs.js (same tree, used to render the checkboxes
// on the Admin Permissions screen and to filter the Sidebar).

export const TAB_TREE = [
  {
    key: "staff",
    label: "Staff",
    subTabs: [{ key: "staff.add", label: "Add Staff" }],
  },
  { key: "attendance", label: "Attendance" },
  { key: "leave", label: "Leave" },
  {
    key: "payroll",
    label: "Payroll",
    subTabs: [{ key: "payroll.add", label: "Add Payroll" }],
  },
  {
    key: "staffbasicpayroll",
    label: "Staff Basic Payroll",
    subTabs: [{ key: "staffbasicpayroll.add", label: "Add / Revise Salary" }],
  },
  { key: "advance", label: "Advance" },
  { key: "expenses", label: "Expenses" },
  { key: "resignations", label: "Resignations" },
];

// Flat list of every valid tab + sub-tab key, e.g. ["staff", "staff.add", ...]
// Used to strip out anything invalid/unknown that a client might send.
export const ALL_TAB_KEYS = TAB_TREE.flatMap((tab) => [
  tab.key,
  ...(tab.subTabs || []).map((sub) => sub.key),
]);

// "superadmin" always has full access. "admin" is either granted every tab
// (allTabs) or only the specific tabs/sub-tabs in `permissions.tabs`.
// "user" (regular staff) never gets management tabs regardless of this
// config — that's still gated by role, not permissions.
export const ROLES = {
  SUPER_ADMIN: "super-admin",
  ADMIN: "admin",
  USER: "user",
};

// Treat superadmin the same as admin anywhere the code used to check for
// a single "admin" role (e.g. self-check-in skip, staff-only screens).
export const isAdminRole = (role) =>
  [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes((role || "").toLowerCase());

// Does this user (superadmin, or admin with the right permissions) have
// access to a given tab/sub-tab key?
export const hasTabAccess = (user, tabKey) => {
  if (!user) return false;
  const role = (user.role || "").toLowerCase();
  if (role === ROLES.SUPER_ADMIN) return true;
  if (role !== ROLES.ADMIN) return false;
  const perms = user.permissions || {};
  if (perms.allTabs) return true;
  return Array.isArray(perms.tabs) && perms.tabs.includes(tabKey);
};
