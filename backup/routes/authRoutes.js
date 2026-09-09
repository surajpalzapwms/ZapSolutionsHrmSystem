import express from "express";
import {
  register,
  login,
  getMe,
  logout,
  changePassword,
  checkAdminExists,
  getPermissionTabs,
  listAdmins,
  updateAdminPermissions,
} from "../controllers/authController.js";
import { protect, allowSuperAdminOnly } from "../middleware/auth.js";
import {
  loginRateLimiter,
  generalAuthRateLimiter,
} from "../middleware/rateLimiter.js";

const router = express.Router();

router.get("/admin-exists", generalAuthRateLimiter, checkAdminExists);
// Register can only ever create one (the bootstrap super admin) account in
// practice, but it's still unauthenticated and hits the DB + bcrypt, so it
// gets the same throttling as login rather than being left wide open.
router.post("/register", loginRateLimiter, register);
router.post("/login", loginRateLimiter, login);
router.get("/me", protect, getMe);
router.post("/logout", protect, logout);
router.put("/change-password", protect, changePassword);

// Permissions management — only the super admin can view every account
// (staff + admin), promote staff to admin, and edit which tabs an admin
// account can see.
router.get("/permission-tabs", protect, getPermissionTabs);
router.get("/admins", protect, allowSuperAdminOnly, listAdmins);
router.put(
  "/admins/:id/permissions",
  protect,
  allowSuperAdminOnly,
  updateAdminPermissions,
);

export default router;