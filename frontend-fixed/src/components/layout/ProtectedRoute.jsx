// src/components/layout/ProtectedRoute.jsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";

/**
 * Guards nested routes behind a valid auth token.
 * Matches the storage keys already used by utils/api.js and App.jsx's
 * readUserFromStorage() ("token" for the JWT, "user" for the profile).
 */
const ProtectedRoute = ({ children }) => {
  const location = useLocation();
  const token = localStorage.getItem("token");

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
};

export default ProtectedRoute;
