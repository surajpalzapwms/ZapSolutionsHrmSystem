import express from "express";
import {
  register,
  login,
  getMe,
  logout,
  changePassword,
  checkAdminExists,
} from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.get("/admin-exists", checkAdminExists);
router.post("/register", register);
router.post("/login", login);
router.get("/me", protect, getMe);
router.post("/logout", protect, logout);
router.put("/change-password", protect, changePassword);

export default router;