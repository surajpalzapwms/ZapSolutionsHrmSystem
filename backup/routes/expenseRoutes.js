import express from "express";
import {
  getExpenses,
  getExpense,
  getPayrollExpenses,
  getExpenseSummary,
} from "../controllers/expenseController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.get("/", protect, getExpenses);
router.get("/summary", protect, getExpenseSummary);
router.get("/payroll/:payrollId", protect, getPayrollExpenses);
router.get("/:id", protect, getExpense);

export default router;