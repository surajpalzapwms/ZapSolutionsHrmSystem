// routes/staffBasicPayrollRoutes.js
import express from "express";
import { protect, allowAdminOnly } from "../middleware/auth.js";
import { requireTabAccess } from "../middleware/permission.js";
import {
  getAllStaffBasicPayrolls,
  getAvailableStaff,
  getStaffBasicPayrollById,
  getSalaryHistory,
  createStaffBasicPayroll,
  addSalaryRevision,
  updateSalaryRevision,
  deleteSalaryRevision,
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
router.post("/", allowAdminOnly, requireTabAccess("staffbasicpayroll.add"), createStaffBasicPayroll);
router.post("/import", allowAdminOnly, requireTabAccess("staffbasicpayroll.add"), importStaffBasicPayrolls);
router.delete("/", allowAdminOnly, requireTabAccess("staffbasicpayroll"), deleteManyStaffBasicPayrolls);

router.get("/:id", getStaffBasicPayrollById);
router.put("/:id", allowAdminOnly, requireTabAccess("staffbasicpayroll"), updateStaffBasicPayroll);
router.delete("/:id", allowAdminOnly, requireTabAccess("staffbasicpayroll"), deleteStaffBasicPayroll);

router.get("/:id/history", getSalaryHistory);
router.post("/:id/salary", allowAdminOnly, requireTabAccess("staffbasicpayroll.add"), addSalaryRevision);
router.put("/:id/salary/:historyId", allowAdminOnly, requireTabAccess("staffbasicpayroll"), updateSalaryRevision);
router.delete("/:id/salary/:historyId", allowAdminOnly, requireTabAccess("staffbasicpayroll"), deleteSalaryRevision);

export default router;