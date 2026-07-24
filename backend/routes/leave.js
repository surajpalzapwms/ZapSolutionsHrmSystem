import express from "express";
import { protect } from "../middleware/auth.js";
import { allowAdminOnly } from "../middleware/auth.js";
import {
  listAttendance,
  getTodayAttendance,
  getYesterdayAttendance,
  updateAttendance,
  deleteAttendance,
  deleteAttendanceByDate,
  listHolidays,
  listLeaves,
  applyLeave,
  updateLeave,
  deleteLeave,
  recordAttendance,
  importAttendance,
  importLeaves,
  convertExtraHoursToLeave,
  getExtraHoursSummary,
  getExtraHoursSimple,
  getUserAttendance,
  checkIn,
  checkOut,
  getMyTodayAttendance,
  setEarlySignOutPermission,
  getOpenAttendanceToday,
  getStaffSummary,
  getStaffCalendar,
  applyMyLeave,
  getMyLeaves,
  getPendingLeaveRequests,
  getAllLeaveRequests,
  approveLeaveRequest,
  rejectLeaveRequest,
  approveLeaveGroup,
  rejectLeaveGroup,
} from "../controllers/leave.js";

const router = express.Router();

// ── Self sign-in / sign-out ─────────────────────────────────────────────────
// Open to ANY authenticated account (role "user" included) — each call only
// ever touches the caller's own record, so this deliberately does NOT use
// allowAdminOnly.
router.get("/attendance/me/today", protect, getMyTodayAttendance);
router.post("/attendance/checkin", protect, checkIn);
router.post("/attendance/checkout", protect, checkOut);

// ── Admin: early sign-out approval ──────────────────────────────────────────
router.get(
  "/attendance/open-today",
  protect,
  allowAdminOnly,
  getOpenAttendanceToday,
);
router.post(
  "/attendance/allow-early-signout",
  protect,
  allowAdminOnly,
  setEarlySignOutPermission,
);

// ── Staff List + per-Staff Calendar View ─────────────────────────────────────────
router.get("/staff-summary", getStaffSummary);
router.get("/staff-summary/:staffId/calendar", getStaffCalendar);

// ── Attendance ──────────────────────────────────────────────────────────────
router.get("/attendance", listAttendance);
router.get("/attendance/today", getTodayAttendance);
router.get("/attendance/yesterday", getYesterdayAttendance);
router.put("/attendance/:id", protect, allowAdminOnly, updateAttendance);
router.delete("/attendance/:id", protect, allowAdminOnly, deleteAttendance);
router.delete(
  "/attendance/date/:userId/:date",
  protect,
  allowAdminOnly,
  deleteAttendanceByDate,
);
router.post("/attendance/record", protect, allowAdminOnly, recordAttendance);
router.post("/attendance/import", protect, allowAdminOnly, importAttendance);
router.post(
  "/attendance/convert-to-leave",
  protect,
  allowAdminOnly,
  convertExtraHoursToLeave,
);
router.get("/attendance/extra-hours/:userId", getExtraHoursSummary);

// ── Holidays (scoped under this router → /api/hrm/leaves/holidays) ─────────
router.get("/holidays", listHolidays);

// ── Leaves ───────────────────────────────────────────────────────────────────
router.get("/", listLeaves);
router.post("/", protect, allowAdminOnly, applyLeave);
router.put("/leave/:id", protect, allowAdminOnly, updateLeave);
router.delete("/leave/:id", protect, allowAdminOnly, deleteLeave);
router.post("/leave/import", protect, allowAdminOnly, importLeaves);

// ── Leave requests (staff self-service + admin approval) ───────────────────
// Staff member: submit a request / view their own requests.
router.get("/requests/my", protect, getMyLeaves);
router.post("/requests/my", protect, applyMyLeave);
// Admin: review + decide on requests. Static paths declared before "/:id"
// routes so they aren't swallowed by them.
router.get(
  "/requests/pending",
  protect,
  allowAdminOnly,
  getPendingLeaveRequests,
);
router.get("/requests/all", protect, allowAdminOnly, getAllLeaveRequests);
// Multi-day ("range") requests: approve/reject every day in the group at once.
// Declared before "/requests/:id/approve" so "group" is never swallowed as an :id.
router.put(
  "/requests/group/:groupId/approve",
  protect,
  allowAdminOnly,
  approveLeaveGroup,
);
router.put(
  "/requests/group/:groupId/reject",
  protect,
  allowAdminOnly,
  rejectLeaveGroup,
);
router.put(
  "/requests/:id/approve",
  protect,
  allowAdminOnly,
  approveLeaveRequest,
);
router.put("/requests/:id/reject", protect, allowAdminOnly, rejectLeaveRequest);

// ── Misc ─────────────────────────────────────────────────────────────────────
router.get("/extra-hours/:userId", getExtraHoursSimple);
router.get("/user/:userId", getUserAttendance);

export default router;
