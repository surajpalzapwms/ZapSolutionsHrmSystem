import express from "express";
import { protect } from "../middleware/auth.js";
import { allowAdminOnly } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
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
  autoCheckIn,
  getMyTodayAttendance,
  getMyMonthAttendance,
  setEarlySignOutPermission,
  getOpenAttendanceToday,
  getStaffSummary,
  getStaffCalendar,
  getMyCalendar,
  applyMyLeave,
  getMyLeaves,
  getPendingLeaveRequests,
  getAllLeaveRequests,
  approveLeaveRequest,
  rejectLeaveRequest,
  reconcileAbsences,
  reconcileStaffSandwichLeave,
  changeDayStatus,
} from "../controllers/leave.js";

import { legacyAutoCheckIn } from "../controllers/presenceController.js";

const router = express.Router();

// ── Self sign-in / sign-out ─────────────────────────────────────────────────
// Open to ANY authenticated account (role "user" included) — each call only
// ever touches the caller's own record, so this deliberately does NOT use
// allowAdminOnly.
router.get("/attendance/me/today", protect, getMyTodayAttendance);
router.get("/attendance/me/month", protect, getMyMonthAttendance);
router.post("/attendance/checkin", protect, checkIn);
router.post("/attendance/checkout", protect, checkOut);
// Silent, automatic, fired by the frontend on app load — see autoCheckIn
// in controllers/leave.js for the office-network gating.
// Now also records office presence (services/presence.js).
router.post("/attendance/auto-checkin", protect, legacyAutoCheckIn);
// Same monthly/annual calendar view the admin gets on the Staff → Calendar
// screen, but for whichever staff member is making the request — the
// controller resolves the staffId from the caller's own account, so there's
// no id parameter here for one staff member to swap out to view another's
// attendance. Safe to leave open to any authenticated role.
router.get("/my-attendance/calendar", protect, getMyCalendar);

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
// These show every staff member's data (or, via :staffId, ANY staff member's
// calendar) — must be admin-only, otherwise one staff member could view
// another's attendance simply by changing the staffId in the URL/API call.
router.get("/staff-summary", protect, allowAdminOnly, getStaffSummary);
router.get(
  "/staff-summary/:staffId/calendar",
  protect,
  allowAdminOnly,
  getStaffCalendar,
);

// ── Attendance ──────────────────────────────────────────────────────────────
// Cross-staff attendance views — admin-only for the same reason as above.
router.get("/attendance", protect, allowAdminOnly, listAttendance);
router.get("/attendance/today", protect, allowAdminOnly, getTodayAttendance);
router.get(
  "/attendance/yesterday",
  protect,
  allowAdminOnly,
  getYesterdayAttendance,
);
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
router.get(
  "/attendance/extra-hours/:userId",
  protect,
  allowAdminOnly,
  getExtraHoursSummary,
);

// ── Holidays (scoped under this router → /api/hrm/leaves/holidays) ─────────
// Not staff-specific — same holiday calendar applies to everyone, so this
// one is fine left open to any authenticated request.
router.get("/holidays", listHolidays);

// ── Leaves ───────────────────────────────────────────────────────────────────
// Lists every staff member's leave records — admin-only, same reasoning as
// the attendance list above.
router.get("/", protect, allowAdminOnly, listLeaves);
router.post("/", protect, allowAdminOnly, applyLeave);
router.put("/leave/:id", protect, allowAdminOnly, updateLeave);
router.delete("/leave/:id", protect, allowAdminOnly, deleteLeave);
router.post("/leave/import", protect, allowAdminOnly, importLeaves);
// Admin-only: change what ONE calendar day is marked as (Present / Half Day
// / Paid / Sick / Casual / Unpaid) in a single safe step — see
// changeDayStatus in controllers/leave.js. Staff can never call this.
router.put("/day-status", protect, allowAdminOnly, changeDayStatus);

// ── Leave requests (staff self-service + admin approval) ───────────────────
// Staff member only (role "user") — submit a request / view their own
// requests. Admin/super-admin accounts already apply leave for any staff
// member (including themselves as a staff record, if applicable) via
// POST /leaves above, so this self-service pair is deliberately restricted
// to plain staff — matches the frontend's StaffOnlyRoute on this page.
router.get("/requests/my", protect, authorize("user"), getMyLeaves);
router.post("/requests/my", protect, authorize("user"), applyMyLeave);
// Admin: review + decide on requests. Static paths declared before "/:id"
// routes so they aren't swallowed by them.
router.get("/requests/pending", protect, allowAdminOnly, getPendingLeaveRequests);
router.get("/requests/all", protect, allowAdminOnly, getAllLeaveRequests);
router.put("/requests/:id/approve", protect, allowAdminOnly, approveLeaveRequest);
router.put("/requests/:id/reject", protect, allowAdminOnly, rejectLeaveRequest);

// Admin (or a scheduled job hitting this with a service token) — sweeps
// every staff member for working days with no attendance and no leave
// request, auto-marking them paid/unpaid per balance. Also fine to point
// an OS-level cron / PM2 cron restart hook at this once a day.
router.post("/reconcile-absences", protect, allowAdminOnly, reconcileAbsences);

// Admin repair tool: re-bridges Sunday/holiday blocks inside a staff
// member's EXISTING leave history that were missed before this fix (e.g.
// an Excel import whose rows weren't in date order). See
// reconcileStaffSandwichLeave for details. Optional ?fromDate&toDate query
// params narrow the window; otherwise it covers all leave on file.
router.post(
  "/reconcile-sandwich/:staffId",
  protect,
  allowAdminOnly,
  reconcileStaffSandwichLeave,
);

// ── Misc ─────────────────────────────────────────────────────────────────────
// Both take an arbitrary :userId — without allowAdminOnly, any logged-in
// staff account could read another staff member's hours/attendance by
// swapping the id in the URL, which is exactly the cross-staff leak we're
// closing here.
router.get(
  "/extra-hours/:userId",
  protect,
  allowAdminOnly,
  getExtraHoursSimple,
);
router.get("/user/:userId", protect, allowAdminOnly, getUserAttendance);

export default router;
