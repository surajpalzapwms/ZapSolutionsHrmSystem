// src/utils/authUser.js
// Single source of truth for "who is logged in / what role are they" so
// Sidebar, DashboardLayout, HrmDashboard, App, etc. all agree.
//
// Mirrors the same fallback logic already duplicated in App.jsx and
// DashboardLayout.jsx: prefer the JSON "user" blob written by Login.jsx,
// but fall back to the older flat "email"/"role"/"username" keys.

export const getCurrentUser = () => {
  try {
    const raw = localStorage.getItem("user");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed._id || parsed.id || parsed.name || parsed.email)
      ) {
        return parsed;
      }
    }
  } catch {
    /* ignore parse errors, fall through to flat-key lookup */
  }

  const email = localStorage.getItem("email");
  const role = localStorage.getItem("role");
  const username = localStorage.getItem("username");

  if (email || role || username) {
    return {
      id: null,
      name: username || email || "User",
      email: email || null,
      role: role || null,
      username: username || email || null,
    };
  }

  return null;
};

// Backend's User model only ever assigns role "admin" or "user"
// (see backend/models/User.js), so "not admin" === "staff / regular user".
export const isAdminUser = (user = getCurrentUser()) =>
  (user?.role || "").toLowerCase() === "admin";
