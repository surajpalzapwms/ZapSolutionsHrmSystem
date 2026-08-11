// middleware/authorize.js
//
// Generic replacement for allowAdminOnly.js. Use it like:
//   router.delete("/staff/:id", authenticate, authorize("admin", "super admin"), controller.remove)
//
// Always place authenticate() before authorize() on the route so req.user exists.

export const authorize = (...allowedRoles) => {
  const normalized = allowedRoles.map((r) => r.toLowerCase());

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!normalized.includes(req.user.role.toLowerCase())) {
      return res.status(403).json({
        success: false,
        message: "Access denied: insufficient permissions",
      });
    }

    next();
  };
};
