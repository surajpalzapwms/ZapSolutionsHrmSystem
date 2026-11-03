// src/components/layout/ProtectedRoute.jsx
import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getCurrentUser, isSuperAdminUser } from "../../utils/authUser";
import api from "../../utils/api";
import { getSelectedCompany, setSelectedCompany } from "../../utils/company";

// An admin's role / permissions can change after
// someone logged in. Once per page load, ask the server what is true now and
// update the saved login, so the sidebar / routes / dashboard follow it.
// Returns true when something changed.
// The same call also brings the account's profile photo (photoUrl), so the
// header shows the photo uploaded from the app / website.
const refreshSession = async () => {
  const before = getCurrentUser();
  if (!before) return false;
  try {
    const res = await api.get("/api/auth/me");
    const me = res.data?.data;
    if (!me) return false;
    const superAdmin = isSuperAdminUser(before); // always has every tab
    const next = {
      ...before,
      role: superAdmin ? before.role : (me.role ?? before.role),
      permissions: superAdmin ? before.permissions : (me.permissions ?? before.permissions),
      photoUrl: me.photoUrl || null,
      // White label: the company this login works on (name, country, tabs).
      company: me.company || null,
    };
    // Super admin: keep the opened company's tabs / logo up to date.
    if (superAdmin && me.company && getSelectedCompany()?._id === me.company._id) {
      const before = JSON.stringify(getSelectedCompany());
      setSelectedCompany(me.company);
      if (JSON.stringify(getSelectedCompany()) !== before) return true;
    }
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

  // Super admin with several companies: open one first.
  const user = getCurrentUser();
  if (
    isSuperAdminUser(user) &&
    !getSelectedCompany() &&
    !user?.company &&
    !location.pathname.startsWith("/companies")
  ) {
    return <Navigate to="/companies" replace />;
  }

  return children;
};

export default ProtectedRoute;
