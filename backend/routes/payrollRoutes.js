import express from "express";
import {
  getPayrolls,
  getPayroll,
  getPendingPayrollSummary,
  previewPayroll,
  createPayroll,
  updatePayroll,
  recalculatePayroll,
  deletePayroll,
  exportPayrollsCSV,
  exportPayslipPdf,
  getMySalarySlips,
} from "../controllers/payrollController.js";
import { protect, allowAdminOnly } from "../middleware/auth.js";
import { requireTabAccess } from "../middleware/permission.js";

const router = express.Router();

router.get("/calculate/:employeeId/:period", protect, previewPayroll);
router.get("/export/csv", protect, exportPayrollsCSV);
router.get("/pending-summary", protect, getPendingPayrollSummary);
// Mobile "Salary Slip" tab: only fully PAID months, newest first.
router.get("/salary-slips", protect, getMySalarySlips);
router.get("/", protect, getPayrolls);
router.get("/:id/payslip-export", protect, exportPayslipPdf);
router.get("/:id", protect, getPayroll);
router.post("/", protect, allowAdminOnly, requireTabAccess("payroll.add"), createPayroll);
router.put("/:id", protect, allowAdminOnly, requireTabAccess("payroll"), updatePayroll);
// Refreshes a still-pending (unpaid) payroll record's attendance-derived
// numbers from current attendance/leave data — see recalculatePayroll for
// why this didn't exist before and why it's restricted to "pending".
router.put(
  "/:id/recalculate",
  protect,
  allowAdminOnly,
  requireTabAccess("payroll"),
  recalculatePayroll,
);
router.delete("/:id", protect, allowAdminOnly, requireTabAccess("payroll"), deletePayroll);

export default router;