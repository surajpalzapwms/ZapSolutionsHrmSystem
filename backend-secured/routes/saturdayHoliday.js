// routers/hrm/saturdayHolidayRoutes.js
import express from "express";
import { body, query } from "express-validator";
import { protect, allowAdminOnly, validateRequest } from "../middleware/auth.js";
import { writeOperationLimiter } from "../middleware/rateLimiter.js";
import {
  getSaturdayRules,
  saveSaturdayRules,
  getComputedSaturdayHolidays,
} from "../controllers/saturdayHoliday.js";

const router = express.Router();

// Every route requires a valid session; only saving rules requires admin -
// any staff member can view which Saturdays are holidays.
router.use(protect);

router.get(
  "/",
  [query("year").optional().isInt({ min: 2000, max: 2100 })],
  validateRequest,
  getSaturdayRules,
);

router.get(
  "/dates",
  [query("year").optional().isInt({ min: 2000, max: 2100 })],
  validateRequest,
  getComputedSaturdayHolidays,
);

router.put(
  "/",
  allowAdminOnly,
  writeOperationLimiter,
  [
    body("year").isInt({ min: 2000, max: 2100 }).withMessage("Valid year is required"),
    body("rules").isArray({ min: 1 }).withMessage("rules must be a non-empty array"),
    body("rules.*.month").isInt({ min: 1, max: 12 }).withMessage("Each rule needs a valid month"),
    body("rules.*.occurrences").optional().isArray().withMessage("occurrences must be an array"),
    body("rules.*.occurrences.*").optional().isInt({ min: 1, max: 5 }),
  ],
  validateRequest,
  saveSaturdayRules,
);

export default router;

// server.js:
//   import saturdayHolidayRoutes from "./routers/hrm/saturdayHolidayRoutes.js";
//   app.use("/api/hrm/saturday-holidays", saturdayHolidayRoutes);
