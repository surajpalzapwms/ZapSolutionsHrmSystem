
import express from "express";
import { body, param, query } from "express-validator";
import { protect,allowAdminOnly } from "../middleware/auth.js";
import { validateRequest } from "../middleware/auth.js";
import { bulkOperationLimiter, writeOperationLimiter } from "../middleware/rateLimiter.js";

import {
  getAllAttendance,
  getTodayAttendance,
  getYesterdayAttendance,
  getAttendanceById,
  recordAttendance,
  updateAttendance,
  deleteAttendance,
  importAttendance,
  getAttendanceSummary,
} from "../controllers/attendance.js";

const router = express.Router();

// Attendance is HR-sensitive data end-to-end: every route requires a
// valid session, and every WRITE additionally requires admin. Read routes
// (list/today/yesterday/summary) are open to any authenticated staff
// member; lock these down further with a "self or admin" check in
// getAllAttendance if employees should only see their own records.
router.use(protect);

router.get(
  "/",
  [
    query("userId").optional().isMongoId(),
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 200 }),
  ],
  validateRequest,
  getAllAttendance,
);

router.get("/today", getTodayAttendance);
router.get("/yesterday", getYesterdayAttendance);

router.get(
  "/summary/:userId",
  [param("userId").isMongoId().withMessage("Invalid user ID")],
  validateRequest,
  getAttendanceSummary,
);

router.get(
  "/:id",
  [param("id").isMongoId().withMessage("Invalid attendance record ID")],
  validateRequest,
  getAttendanceById,
);

router.post(
  "/",
  allowAdminOnly,
  writeOperationLimiter,
  [
    body("userId").isMongoId().withMessage("Valid userId is required"),
    body("loginTime").isISO8601().withMessage("Valid loginTime is required"),
    body("logoutTime").isISO8601().withMessage("Valid logoutTime is required"),
    body("workingHoursPerDay").optional().isInt({ min: 1, max: 24 }),
  ],
  validateRequest,
  recordAttendance,
);

router.put(
  "/:id",
  allowAdminOnly,
  writeOperationLimiter,
  [
    param("id").isMongoId().withMessage("Invalid attendance record ID"),
    body("loginTime").optional().isISO8601(),
    body("logoutTime").optional().isISO8601(),
    body("workingHoursPerDay").optional().isInt({ min: 1, max: 24 }),
    body("remarks").optional().trim().isLength({ max: 500 }),
  ],
  validateRequest,
  updateAttendance,
);

router.delete(
  "/:id",
  allowAdminOnly,
  writeOperationLimiter,
  [param("id").isMongoId().withMessage("Invalid attendance record ID")],
  validateRequest,
  deleteAttendance,
);

router.post(
  "/import",
  allowAdminOnly,
  bulkOperationLimiter,
  [body().isArray({ min: 1 }).withMessage("Request body must be a non-empty array")],
  validateRequest,
  importAttendance,
);

export default router;

// server.js:
//   import attendanceRoutes from "./routers/hrm/attendanceRoutes.js";
//   app.use("/api/hrm/attendance", attendanceRoutes);
