// routes/officeExpenseRoutes.js
import express from "express";
import { body, param } from "express-validator";
import { protect, allowAdminOnly, validateRequest } from "../middleware/auth.js";
import { bulkOperationLimiter, writeOperationLimiter } from "../middleware/rateLimiter.js";
import {
  getAllOfficeExpenses,
  getOfficeExpenseById,
  createOfficeExpense,
  updateOfficeExpense,
  deleteOfficeExpense,
  deleteManyOfficeExpenses,
  getOfficeExpenseSummary,
} from "../controllers/officeExpenseController.js";

const router = express.Router();

// Every route requires a valid session; writes additionally require admin.
router.use(protect);

const expenseBodyRules = [
  body("category").isMongoId().withMessage("A valid category is required"),
  body("amount").isFloat({ gt: 0 }).withMessage("amount must be a positive number"),
  body("date").isISO8601().withMessage("A valid date is required"),
  body("note").optional().trim().isLength({ max: 250 }),
  body("remarks").optional().trim().isLength({ max: 500 }),
];

router.get("/", getAllOfficeExpenses);
router.get("/summary", getOfficeExpenseSummary);

router.get(
  "/:id",
  [param("id").isMongoId().withMessage("Invalid expense ID")],
  validateRequest,
  getOfficeExpenseById,
);

router.post(
  "/",
  allowAdminOnly,
  writeOperationLimiter,
  expenseBodyRules,
  validateRequest,
  createOfficeExpense,
);

router.put(
  "/:id",
  allowAdminOnly,
  writeOperationLimiter,
  [
    param("id").isMongoId().withMessage("Invalid expense ID"),
    body("category").optional().isMongoId(),
    body("amount").optional().isFloat({ gt: 0 }),
    body("date").optional().isISO8601(),
    body("note").optional().trim().isLength({ max: 250 }),
    body("remarks").optional().trim().isLength({ max: 500 }),
  ],
  validateRequest,
  updateOfficeExpense,
);

router.delete(
  "/",
  allowAdminOnly,
  bulkOperationLimiter,
  [body("ids").isArray({ min: 1 }).withMessage("ids must be a non-empty array")],
  validateRequest,
  deleteManyOfficeExpenses,
);

router.delete(
  "/:id",
  allowAdminOnly,
  writeOperationLimiter,
  [param("id").isMongoId().withMessage("Invalid expense ID")],
  validateRequest,
  deleteOfficeExpense,
);

export default router;

// server.js:
//   import officeExpenseRoutes from "./routes/officeExpenseRoutes.js";
//   app.use("/api/hrm/office-expenses", officeExpenseRoutes);
