// routes/lateDeduction.js — mounted at /api/hrm/late-deduction (server.js)
import express from "express";
import {
  protect,
  allowAdminOnly,
  allowSuperAdminOnly,
} from "../middleware/auth.js";
import {
  getLateSummary,
  setMonthLateDeduction,
  setDayLateDeduction,
  setDayLunch,
} from "../controllers/lateDeductionController.js";

const router = express.Router();

// Only the SUPER ADMIN decides whether late coming is deducted — for a
// whole month, or for one date on the attendance calendar.
router.put("/month", protect, allowSuperAdminOnly, setMonthLateDeduction);
router.put("/day", protect, allowSuperAdminOnly, setDayLateDeduction);
router.put("/lunch", protect, allowSuperAdminOnly, setDayLunch);

// Admins can read the summary (staff see theirs inside their own calendar).
router.get("/:staffId/:period", protect, allowAdminOnly, getLateSummary);

export default router;
