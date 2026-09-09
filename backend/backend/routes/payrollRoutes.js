import express from "express";
import {
  getPayrolls,
  getPayroll,
  previewPayroll,
  createPayroll,
  updatePayroll,
  deletePayroll,
  exportPayrollsCSV,
  exportPayslipPdf,
} from "../controllers/payrollController.js";
import { protect, allowAdminOnly } from "../middleware/auth.js";
import { requireTabAccess } from "../middleware/permission.js";

const router = express.Router();

router.get("/calculate/:employeeId/:period", protect, previewPayroll);
router.get("/export/csv", protect, exportPayrollsCSV);
router.get("/", protect, getPayrolls);
router.get("/:id/payslip-export", protect, exportPayslipPdf);
router.get("/:id", protect, getPayroll);
router.post("/", protect, allowAdminOnly, requireTabAccess("payroll.add"), createPayroll);
router.put("/:id", protect, allowAdminOnly, requireTabAccess("payroll"), updatePayroll);
router.delete("/:id", protect, allowAdminOnly, requireTabAccess("payroll"), deletePayroll);

export default router;
