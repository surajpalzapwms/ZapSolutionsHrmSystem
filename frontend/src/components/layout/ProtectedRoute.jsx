// src/components/layout/ProtectedRoute.jsx
import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getCurrentUser, isSuperAdminUser } from "../../utils/authUser";
import api from "../../utils/api";

// An admin's role / permissions can change after
// someone logged in. Once per page load, ask the server what is true now and
// update the saved login, so the sidebar / routes / dashboard follow it.
// Returns true when something changed.
const refreshSession = async () => {
  const before = getCurrentUser();
  if (!before || isSuperAdminUser(before)) return false; // super admin always has every tab
  try {
    const res = await api.get("/api/auth/me");
    const me = res.data?.data;
    if (!me) return false;
    const next = {
      ...before,
      role: me.role ?? before.role,
      permissions: me.permissions ?? before.permissions,
    };
    // Left over from the old multi-company version.
    delete next.company;
    if (JSON.stringify(next) === JSON.stringify(before)) return false;
    localStorage.setItem("user", JSON.stringify(next));
    return true;
  } catch {
    return false; // keep what we have; a real auth failure is handled by api.js
  }
};

/**
 * Guards nested routes behind a valid auth token.
 * Matches the storage keys already used by utils/api.js and App.jsx's
 * readUserFromStorage() ("token" for the JWT, "user" for the profile).
 */
const ProtectedRoute = ({ children }) => {
  const location = useLocation();
  const token = localStorage.getItem("token");
  const [, bump] = useState(0);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    refreshSession().then((changed) => {
      if (!alive || !changed) return;
      window.dispatchEvent(new Event("userLoggedIn")); // App re-reads the user
      bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [token]);

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
};

export default ProtectedRoute;
