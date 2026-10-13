import express from "express";
import { protect, allowAdminOnly } from "../middleware/auth.js";
import {
  getLeavePolicy,
  updateLeavePolicy,
  getAllStaffLeaveBalances,
  getMyLeaveBalance,
  getStaffLeaveBalanceMonthly,
} from "../controllers/leavePolicyController.js";

const router = express.Router();

// The logged-in staff member's own balances (any authenticated account).
router.get("/balances/me", protect, getMyLeaveBalance);

// Admin: view balances for everyone.
router.get("/balances", protect, allowAdminOnly, getAllStaffLeaveBalances);

// Admin: one staff member's balances + month-by-month statement.
router.get("/balances/staff/:staffId", protect, allowAdminOnly, getStaffLeaveBalanceMonthly);

// Policy: readable by any authenticated account, editable by admins only.
router.get("/", protect, getLeavePolicy);
router.put("/", protect, allowAdminOnly, updateLeavePolicy);

export default router;
