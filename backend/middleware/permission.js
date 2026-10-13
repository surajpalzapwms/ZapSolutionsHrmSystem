// middleware/permission.js
//
// Gate a route behind a specific tab/sub-tab key (see config/permissions.js).
// Superadmin always passes. An admin passes only if they were granted
// "Show All" or that specific tab/sub-tab on the Permissions screen. Any
// other role (plain "user") is denied outright — this middleware is only
// ever used on management routes.
//
// Must run after `protect` / `authenticate` so req.user is populated.

import { hasTabAccess } from "../config/permissions.js";

export const requireTabAccess = (tabKey) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  if (hasTabAccess(req.user, tabKey)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "You don't have permission to access this section",
    code: "TAB_FORBIDDEN",
  });
};
