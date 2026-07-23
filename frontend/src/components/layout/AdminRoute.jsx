// src/components/layout/AdminRoute.jsx
import React from "react";
import { Navigate } from "react-router-dom";
import { getCurrentUser, isAdminUser } from "../../utils/authUser";

/**
 * Guards admin-only nested routes (Staff, Attendance, Payroll, Staff Basic
 * Payroll, Advance). Non-admin ("user" role) staff are bounced back to the
 * dashboard — mirrors what's already hidden from them in the Sidebar /
 * MobileDashboard, so a typed-in URL can't be used to reach the same pages.
 */
const AdminRoute = ({ children }) => {
  const admin = isAdminUser(getCurrentUser());
  if (!admin) {
    return <Navigate to="/hrmlayout" replace />;
  }
  return children;
};

export default AdminRoute;
