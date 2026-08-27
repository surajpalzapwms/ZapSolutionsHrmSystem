// routers/hrm/holidayRoutes.js
import express from "express";
import { body, param, query } from "express-validator";
import { protect,allowAdminOnly } from "../middleware/auth.js";
import { validateRequest } from "../middleware/auth.js";
import { bulkOperationLimiter, writeOperationLimiter } from "../middleware/rateLimiter.js";
import { HOLIDAY_TYPE_VALUES } from "../models/holiday.js";

import {
  getAllHolidays,
  getHolidayById,
  createHoliday,
  updateHoliday,
  toggleHolidayStatus,
  deleteHoliday,
  importHolidays,
  exportHolidays,
} from "../controllers/holiday.js";

const router = express.Router();

// Every route below requires a valid session; write routes additionally
// require the admin role. Read routes are intentionally open to any
// authenticated staff member so employees can see upcoming holidays.
router.use(protect);

const holidayBodyRules = [
  body("name").trim().notEmpty().withMessage("Holiday name is required").isLength({ max: 120 }),
  body("startDate").isISO8601().withMessage("Valid start date is required"),
  body("endDate").optional().isISO8601().withMessage("Valid end date is required"),
  body("type").optional().isIn(HOLIDAY_TYPE_VALUES).withMessage("Invalid holiday type"),
  body("description").optional().trim().isLength({ max: 500 }),
  body("enabled").optional().isBoolean(),
];

router.get(
  "/",
  [query("year").optional().isInt({ min: 2000, max: 2100 }), query("enabled").optional().isBoolean()],
  validateRequest,
  getAllHolidays,
);

router.get("/export", allowAdminOnly, bulkOperationLimiter, exportHolidays);

router.get(
  "/:id",
  [param("id").isMongoId().withMessage("Invalid holiday ID")],
  validateRequest,
  getHolidayById,
);

router.post(
  "/",
  allowAdminOnly,
  writeOperationLimiter,
  holidayBodyRules,
  validateRequest,
  createHoliday,
);

router.put(
  "/:id",
  allowAdminOnly,
  writeOperationLimiter,
  [param("id").isMongoId().withMessage("Invalid holiday ID"), ...holidayBodyRules],
  validateRequest,
  updateHoliday,
);

router.put(
  "/:id/status",
  allowAdminOnly,
  [param("id").isMongoId(), body("enabled").isBoolean().withMessage("enabled must be true/false")],
  validateRequest,
  toggleHolidayStatus,
);

router.delete(
  "/:id",
  allowAdminOnly,
  writeOperationLimiter,
  [param("id").isMongoId().withMessage("Invalid holiday ID")],
  validateRequest,
  deleteHoliday,
);

router.post(
  "/import",
  allowAdminOnly,
  bulkOperationLimiter,
  [body().isArray({ min: 1 }).withMessage("Request body must be a non-empty array")],
  validateRequest,
  importHolidays,
);

export default router;

// server.js:
//   import holidayRoutes from "./routers/hrm/holidayRoutes.js";
//   app.use("/api/hrm/holidays", holidayRoutes);
