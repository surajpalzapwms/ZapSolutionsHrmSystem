// routes/staffBasicPayrollRoutes.js
import express from "express";
import { protect, allowAdminOnly } from "../middleware/auth.js";
import {
  getAllStaffBasicPayrolls,
  getAvailableStaff,
  getStaffBasicPayrollById,
  getSalaryHistory,
  createStaffBasicPayroll,
  addSalaryRevision,
  updateStaffBasicPayroll,
  deleteStaffBasicPayroll,
  deleteManyStaffBasicPayrolls,
  importStaffBasicPayrolls,
} from "../controllers/staffBasicPayrollController.js";

const router = express.Router();

router.use(protect);

// NOTE: static/specific paths must be declared before "/:id" so they
// aren't swallowed by the dynamic id route.
router.get("/staff/available", getAvailableStaff);

router.get("/", getAllStaffBasicPayrolls);
router.post("/", allowAdminOnly, createStaffBasicPayroll);
router.post("/import", allowAdminOnly, importStaffBasicPayrolls);
router.delete("/", allowAdminOnly, deleteManyStaffBasicPayrolls);

router.get("/:id", getStaffBasicPayrollById);
router.put("/:id", allowAdminOnly, updateStaffBasicPayroll);
router.delete("/:id", allowAdminOnly, deleteStaffBasicPayroll);

router.get("/:id/history", getSalaryHistory);
router.post("/:id/salary", allowAdminOnly, addSalaryRevision);

export default router;
