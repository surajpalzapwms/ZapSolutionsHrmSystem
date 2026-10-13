// src/components/layout/TabRoute.jsx
import React from "react";
import { Navigate } from "react-router-dom";
import { getCurrentUser, companyHasAnyTab } from "../../utils/authUser";

/**
 * Closes a route (for everyone, any role) when the company does not have the
 * tab — used for staff self-service screens such as My Payslips, which follow
 * the matching company tab. `tab` can be one key or a list (any one is enough).
 */
const TabRoute = ({ tab, children }) => {
  const keys = Array.isArray(tab) ? tab : [tab];
  if (!companyHasAnyTab(keys, getCurrentUser())) {
    return <Navigate to="/hrmlayout" replace />;
  }
  return children;
};

export default TabRoute;
