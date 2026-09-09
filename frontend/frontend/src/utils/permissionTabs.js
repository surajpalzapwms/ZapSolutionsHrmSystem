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
  { key: "advance", label: "Advance" },
  { key: "expenses", label: "Expenses" },
  { key: "resignations", label: "Resignations" },
];

export const ALL_TAB_KEYS = TAB_TREE.flatMap((tab) => [
  tab.key,
  ...(tab.subTabs || []).map((sub) => sub.key),
]);
