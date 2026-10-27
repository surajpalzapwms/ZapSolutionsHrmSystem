import express from "express";
import { getSettings, updateSettings } from "../controllers/settingsController.js";
import { protect } from "../middleware/auth.js";
import { requireTabAccess } from "../middleware/permission.js";
import rateLimit from "express-rate-limit";

const router = express.Router();

// Read on every page load, often by many people behind one office network,
// so this limit is much looser than the login one.
const settingsReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

// Public: the login page needs the logo / name before anyone is logged in,
// and every screen needs the currency.
router.get("/", settingsReadLimiter, getSettings);
// Super admin always; an admin only with the "Settings" tab granted.
router.put("/", protect, requireTabAccess("settings"), updateSettings);

export default router;
