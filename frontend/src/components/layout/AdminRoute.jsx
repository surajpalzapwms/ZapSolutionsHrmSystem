// src/components/layout/AdminRoute.jsx
import React from "react";
import { Navigate } from "react-router-dom";
import {
  getCurrentUser,
  isAdminUser,
  isSuperAdminUser,
  hasTabAccess,
} from "../../utils/authUser";

/**
 * Guards admin-only nested routes (Staff, Attendance, Payroll, Staff Basic
 * Payroll, Advance, Expenses, Admin Permissions). Non-admin ("user" role)
 * staff are bounced back to the dashboard — mirrors what's already hidden
 * from them in the Sidebar / MobileDashboard, so a typed-in URL can't be
 * used to reach the same pages.
 *
 * Pass `requiredTab` (see utils/permissionTabs.js) to also gate a promoted
 * admin by their granted permissions — a super admin always passes.
 * Omit it for routes any admin can reach
 * (e.g. the Permissions screen itself is superAdminOnly instead).
 */
const AdminRoute = ({ children, requiredTab, superAdminOnly = false }) => {
  const user = getCurrentUser();
  const admin = isAdminUser(user);
  const superAdmin = isSuperAdminUser(user);

  if (!admin) {
    return <Navigate to="/hrmlayout" replace />;
  }
  if (superAdminOnly && !superAdmin) {
    return <Navigate to="/hrmlayout" replace />;
  }
  if (requiredTab && !hasTabAccess(requiredTab, user)) {
    return <Navigate to="/hrmlayout" replace />;
  }
  return children;
};

export default AdminRoute;
