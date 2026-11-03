// src/utils/permissionTabs.js
//
// Frontend mirror of backend/config/permissions.js — kept as a static
// fallback so the Sidebar/Permissions screen render immediately, but the
// Permissions page also fetches the live version from
// GET /api/auth/permission-tabs so backend and frontend never drift for
// long even if one side is redeployed first.

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

// Every tab of the website, in sidebar order — what the super admin ticks per
// company (Companies → Plan, tabs & domain). Mirror of COMPANY_TABS in
// backend/config/permissions.js. `alwaysOn` tabs cannot be switched off.
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
export const ALWAYS_ON_COMPANY_TABS = COMPANY_TABS.filter((t) => t.alwaysOn).map((t) => t.key);
// Tabs added to the list later: a company whose tabs were saved before
// (tabsVersion < 2) keeps them ON until the super admin saves its tabs again.
export const TABS_ADDED_IN_V2 = ["dashboard", "holidays", "branches", "permissions"];

export const ALL_TAB_KEYS = TAB_TREE.flatMap((tab) => [
  tab.key,
  ...(tab.subTabs || []).map((sub) => sub.key),
]);

// Page address -> company tab, so a page the company doesn't have can't be
// opened by typing its address either. First path segment after /hrmlayout.
const TAB_BY_SEGMENT = {
  staff: "staff",
  staffbasicpayroll: "staffbasicpayroll",
  payroll: "payroll",
  "my-payslips": "payroll",
  finalsettlement: "finalsettlement",
  advance: "advance",
  leaveattendance: "attendance",
  "my-attendance": "attendance",
  leave: "leave",
  "my-leave-requests": "leave",
  resignations: "resignations",
  "my-resignation": "resignations",
  holidays: "holidays",
  expenses: "expenses",
  settings: "settings",
  branches: "branches",
  permissions: "permissions",
};
export const companyTabForPath = (pathname = "") => {
  const m = /^\/hrmlayout\/([^/?#]+)/.exec(String(pathname));
  return m ? TAB_BY_SEGMENT[m[1]] || null : null;
};
