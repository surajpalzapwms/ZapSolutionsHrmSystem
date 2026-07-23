import express from "express";
import {
  getPayrolls,
  getPayroll,
  previewPayroll,
  createPayroll,
  updatePayroll,
  deletePayroll,
  exportPayrollsCSV,
} from "../controllers/payrollController.js";
import { protect, allowAdminOnly } from "../middleware/auth.js";

const router = express.Router();

router.get("/calculate/:employeeId/:period", protect, previewPayroll);
router.get("/export/csv", protect, exportPayrollsCSV);
router.get("/", protect, getPayrolls);
router.get("/:id", protect, getPayroll);
router.post("/", protect, allowAdminOnly, createPayroll);
router.put("/:id", protect, allowAdminOnly, updatePayroll);
router.delete("/:id", protect, allowAdminOnly, deletePayroll);

export default router;
