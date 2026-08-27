// routes/advanceRoutes.js
import express from "express";
import { body, param } from "express-validator";
import { protect, allowAdminOnly, validateRequest } from "../middleware/auth.js";
import { requireTabAccess } from "../middleware/permission.js";
import { bulkOperationLimiter, writeOperationLimiter } from "../middleware/rateLimiter.js";
import {
  getAllAdvances,
  getAdvanceById,
  createAdvance,
  updateAdvance,
  updateAdvanceStatus,
  recordRepayment,
  deleteAdvance,
  deleteManyAdvances,
} from "../controllers/advanceController.js";

const router = express.Router();

// Every route requires a valid session; writes additionally require admin.
router.use(protect);

const advanceBodyRules = [
  body("employeeId").isMongoId().withMessage("A valid employeeId is required"),
  body("employeeName").trim().notEmpty().withMessage("employeeName is required").isLength({ max: 120 }),
  body("amount").isFloat({ gt: 0 }).withMessage("amount must be a positive number"),
  body("date").isISO8601().withMessage("A valid date is required"),
  body("reason").optional().trim().isLength({ max: 250 }),
  body("remarks").optional().trim().isLength({ max: 500 }),
  body("sourceAccountId").optional().isMongoId().withMessage("Invalid sourceAccountId"),
];

router.get("/", getAllAdvances);

router.get(
  "/:id",
  [param("id").isMongoId().withMessage("Invalid advance ID")],
  validateRequest,
  getAdvanceById,
);

router.post(
  "/",
  allowAdminOnly,
  requireTabAccess("advance"),
  writeOperationLimiter,
  advanceBodyRules,
  validateRequest,
  createAdvance,
);

router.put(
  "/:id/status",
  allowAdminOnly,
  requireTabAccess("advance"),
  [
    param("id").isMongoId(),
    body("status").isIn(["pending", "approved", "rejected", "repaid"]).withMessage("Invalid status"),
  ],
  validateRequest,
  updateAdvanceStatus,
);

router.post(
  "/:id/repay",
  allowAdminOnly,
  requireTabAccess("advance"),
  writeOperationLimiter,
  [param("id").isMongoId(), body("amount").isFloat({ gt: 0 }).withMessage("A positive amount is required")],
  validateRequest,
  recordRepayment,
);

router.put(
  "/:id",
  allowAdminOnly,
  requireTabAccess("advance"),
  writeOperationLimiter,
  [
    param("id").isMongoId().withMessage("Invalid advance ID"),
    body("employeeId").optional().isMongoId(),
    body("employeeName").optional().trim().isLength({ max: 120 }),
    body("amount").optional().isFloat({ gt: 0 }),
    body("date").optional().isISO8601(),
    body("reason").optional().trim().isLength({ max: 250 }),
    body("remarks").optional().trim().isLength({ max: 500 }),
  ],
  validateRequest,
  updateAdvance,
);

router.delete(
  "/",
  allowAdminOnly,
  requireTabAccess("advance"),
  bulkOperationLimiter,
  [body("ids").isArray({ min: 1 }).withMessage("ids must be a non-empty array")],
  validateRequest,
  deleteManyAdvances,
);

router.delete(
  "/:id",
  allowAdminOnly,
  requireTabAccess("advance"),
  writeOperationLimiter,
  [param("id").isMongoId().withMessage("Invalid advance ID")],
  validateRequest,
  deleteAdvance,
);

export default router;

// server.js:
//   import advanceRoutes from "./routes/advanceRoutes.js";
//   app.use("/api/hrm/advances", advanceRoutes);
