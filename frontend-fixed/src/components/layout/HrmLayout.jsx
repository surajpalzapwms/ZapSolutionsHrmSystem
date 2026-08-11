// src/components/layout/HrmLayout.jsx
import React from "react";
import { Outlet } from "react-router-dom";

const HrmLayout = () => {
  return (
    <div className="h-full">
      <Outlet />
    </div>
  );
};

export default HrmLayout;
