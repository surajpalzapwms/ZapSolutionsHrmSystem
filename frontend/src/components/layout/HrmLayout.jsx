// src/components/layout/HrmLayout.jsx
import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { companyHasTab, getCurrentUser } from "../../utils/authUser";
import { companyTabForPath } from "../../utils/permissionTabs";

// Pages of a tab the super admin switched off for this company are closed,
// even when the address is typed in directly -> back to the dashboard.
const HrmLayout = () => {
  const { pathname } = useLocation();
  const tab = companyTabForPath(pathname);
  if (tab && !companyHasTab(tab, getCurrentUser())) {
    return <Navigate to="/hrmlayout" replace />;
  }
  return (
    <div className="h-full">
      <Outlet />
    </div>
  );
};

export default HrmLayout;
