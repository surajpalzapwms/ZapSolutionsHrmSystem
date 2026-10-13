// src/components/layout/StaffOnlyRoute.jsx
import React from "react";
import { Navigate } from "react-router-dom";
import { getCurrentUser, isAdminUser } from "../../utils/authUser";

/**
 * Inverse of AdminRoute: guards routes meant only for plain staff (role
 * "user"), not admin or super-admin. Used for self-service screens like
 * "Apply My Leave" that should be a staff-only workflow rather than
 * something every role can also use for themselves.
 *
 * Admin/super-admin accounts are bounced back to the HRM dashboard, where
 * they already have the full "Apply Leave" flow (LeaveModal) for any staff
 * member, including themselves if they're also on the staff list.
 */
const StaffOnlyRoute = ({ children }) => {
  const user = getCurrentUser();

  if (isAdminUser(user)) {
    return <Navigate to="/hrmlayout" replace />;
  }

  return children;
};

export default StaffOnlyRoute;
