// src/components/layout/StaffMemberLayout.jsx
import React from "react";
import { Outlet } from "react-router-dom";

const StaffMemberLayout = () => {
  return (
    <div className="h-full">
      <Outlet />
    </div>
  );
};

export default StaffMemberLayout;
