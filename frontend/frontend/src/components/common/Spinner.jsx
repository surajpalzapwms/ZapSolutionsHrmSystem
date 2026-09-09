// src/components/common/Spinner.jsx
import React from "react";

const Spinner = ({ size = "md", color = "indigo", className = "", fullScreen = false }) => {
  const sizes = {
    sm: "h-6 w-6",
    md: "h-10 w-10",
    lg: "h-16 w-16",
  };

  const colors = {
    indigo: "border-indigo-600",
    blue: "border-blue-600",
    green: "border-green-600",
    red: "border-red-600",
    white: "border-white",
  };

  const spinner = (
    <div className={`flex justify-center items-center ${className}`}>
      <div
        className={`animate-spin rounded-full ${sizes[size] || sizes.md} border-b-2 ${colors[color] || colors.indigo}`}
      />
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-white bg-opacity-75 flex justify-center items-center z-50">
        {spinner}
      </div>
    );
  }

  return spinner;
};

export default Spinner;