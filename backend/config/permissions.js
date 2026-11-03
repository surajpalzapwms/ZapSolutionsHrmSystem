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
  { key: "finalsettlement", label: "Final Settlement" },
  { key: "advance", label: "Advance" },
  { key: "expenses", label: "Expenses" },
  { key: "resignations", label: "Resignations" },
  { key: "settings", label: "Settings (logo, currency)" },
];

// What a BRANCH ADMIN gets when they accept their invite. Only staff for now:
// staff lists are filtered to the branch, other modules (attendance, payroll,
// ...) are not yet per-branch, so they are NOT opened by default. The super
// admin can widen this on the Permissions screen.
export const BRANCH_ADMIN_DEFAULT_TABS = ["staff", "staff.add"];

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
export const hasTabAccess = (user, tabKey, company = undefined) => {
  if (!user) return false;
  // A tab the COMPANY does not have is closed even for the super admin.
  if (company && !companyHasTab(company, tabKey)) return false;
  const role = (user.role || "").toLowerCase();
  if (role === ROLES.SUPER_ADMIN) return true;
  if (role !== ROLES.ADMIN) return false;
  const perms = user.permissions || {};
  if (perms.allTabs) return true;
  return Array.isArray(perms.tabs) && perms.tabs.includes(tabKey);
};


// ── Tabs per company (white label) ────────────────────────────────────────
// Every tab of the website, in sidebar order. The super admin ticks which of
// these a company has (Companies → Plan, tabs & domain). An unticked tab is
// gone from that company's sidebar, its pages and (where it has its own API)
// its API. This list is wider than TAB_TREE (the per-ADMIN permissions):
// Dashboard, Holidays, Branches and Admin Permissions can be switched off
// per company too.
export const COMPANY_TABS = [
  { key: "dashboard", label: "Dashboard", alwaysOn: true },
  { key: "staff", label: "Staff", alwaysOn: true },
  { key: "staffbasicpayroll", label: "Staff Basic Payroll" },
  { key: "payroll", label: "Payroll" },
  { key: "finalsettlement", label: "Final Settlement" },
  { key: "advance", label: "Advance" },
  { key: "attendance", label: "Attendance" },
  { key: "leave", label: "Leave" },
  { key: "resignations", label: "Resignations" },
  { key: "holidays", label: "Holidays" },
  { key: "expenses", label: "Expenses (office)" },
  { key: "settings", label: "Company Profile", alwaysOn: true },
  { key: "branches", label: "Branches" },
  { key: "permissions", label: "Admin Permissions" },
];
export const COMPANY_TAB_KEYS = COMPANY_TABS.map((t) => t.key);

// company.enabledTabs: unset / null = every tab, else a list of tab keys.
const ALWAYS_ON = new Set(COMPANY_TABS.filter((t) => t.alwaysOn).map((t) => t.key));

// Tabs added to the list later. A company whose tabs were saved before they
// existed (tabsVersion < 2) keeps them switched ON until the super admin
// saves its tabs again — so nothing disappears by surprise after an update.
const TABS_VERSION = 2;
const ADDED_IN_V2 = ["dashboard", "holidays", "branches", "permissions"];

/** The company's tabs with always-on and not-yet-chosen tabs added; null = every tab. */
export const effectiveEnabledTabs = (company) => {
  if (!company || !Array.isArray(company.enabledTabs)) return null;
  const out = new Set(company.enabledTabs);
  for (const k of ALWAYS_ON) out.add(k);
  if ((company.tabsVersion || 1) < TABS_VERSION) for (const k of ADDED_IN_V2) out.add(k);
  return COMPANY_TAB_KEYS.filter((k) => out.has(k));
};
export const CURRENT_TABS_VERSION = TABS_VERSION;

export const companyHasTab = (company, tabKey) => {
  const tabs = effectiveEnabledTabs(company);
  if (!tabs) return true;
  const top = String(tabKey || "").split(".")[0];
  return tabs.includes(top);
};

/** Cleans a list of tab keys sent by the client (top-level tabs only). */
export const normalizeEnabledTabs = (list) => {
  const valid = new Set(COMPANY_TAB_KEYS);
  const out = [];
  for (const raw of list || []) {
    const top = String(raw || "").split(".")[0];
    if (valid.has(top) && !out.includes(top)) out.push(top);
  }
  for (const k of ALWAYS_ON) if (!out.includes(k)) out.push(k);
  return out;
};

// API areas that belong to one tab. protect() refuses them with
// 403 TAB_DISABLED when the company does not have that tab, so the rule
// holds for the website and the mobile app alike.
export const COMPANY_ROUTE_RULES = [
  { prefix: "/api/hrm/payroll", tab: "payroll" },
  { prefix: "/api/hrm/staff-basic-payrolls", tab: "staffbasicpayroll" },
  { prefix: "/api/hrm/advances", tab: "advance" },
  { prefix: "/api/expenses", tab: "expenses" },
  { prefix: "/api/hrm/expense-categories", tab: "expenses" },
  { prefix: "/api/hrm/office-expenses", tab: "expenses" },
  { prefix: "/api/hrm/resignations", tab: "resignations" },
  { prefix: "/api/branches", tab: "branches" },
];

export const companyTabForPath = (path) => {
  const p = String(path || "");
  const rule = COMPANY_ROUTE_RULES.find((r) => p === r.prefix || p.startsWith(`${r.prefix}/`));
  return rule ? rule.tab : null;
};
