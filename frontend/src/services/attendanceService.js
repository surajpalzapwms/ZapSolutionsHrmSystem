// src/services/attendanceService.js
import api from "../utils/api";

export const attendanceService = {
  getAttendance: (params) => api.get("/api/hrm/leaves/attendance", { params }),
  recordAttendance: (data) =>
    api.post("/api/hrm/leaves/attendance/record", data),
  // Self sign-in / sign-out (shift window per user, lunch break excluded;
  // sign-out unlocks after 7h45m worked, or once an admin approves early).
  getMyTodayAttendance: () => api.get("/api/hrm/leaves/attendance/me/today"),
  signIn: () => api.post("/api/hrm/leaves/attendance/checkin"),
  signOut: () => api.post("/api/hrm/leaves/attendance/checkout"),
  // Admin: view who's currently signed in today, and approve/revoke an
  // early sign-out for a specific user.
  getOpenAttendanceToday: () =>
    api.get("/api/hrm/leaves/attendance/open-today"),
  setEarlySignOutPermission: (userId, allow = true) =>
    api.post("/api/hrm/leaves/attendance/allow-early-signout", {
      userId,
      allow,
    }),
  importAttendance: (rows) =>
    api.post("/api/hrm/leaves/attendance/import", rows),
  importLeaves: (rows) => api.post("/api/hrm/leaves/leave/import", rows),
  deleteAttendance: (id) => api.delete(`/api/hrm/leaves/attendance/${id}`),
  deleteByDate: (userId, date) =>
    api.delete(`/api/hrm/leaves/attendance/date/${userId}/${date}`),
  getExtraHours: (userId, params) =>
    api.get(`/api/hrm/leaves/attendance/extra-hours/${userId}`, { params }),
  convertToLeave: (data) =>
    api.post("/api/hrm/leaves/attendance/convert-to-leave", data),
  getLeaves: (params) => api.get("/api/hrm/leaves", { params }),
  applyLeave: (data) => api.post("/api/hrm/leaves", data),
  // Admin only: change one calendar day (present/half/paid/sick/casual/unpaid)
  // in a single safe step on the server.
  changeDayStatus: (data) => api.put("/api/hrm/leaves/day-status", data),
  // Backend route is DELETE /api/hrm/leaves/leave/:id (the old
  // /api/hrm/leaves/:id path doesn't exist and always returned 404).
  deleteLeave: (id) => api.delete(`/api/hrm/leaves/leave/${id}`),
  getStaffSummary: () => api.get("/api/hrm/leaves/staff-summary"),
  // The backend runs several sequential self-heal passes (sandwich-leave
  // reconciliation, stray-leave cleanup, etc.) over the whole requested
  // year before responding — on a staff member with a lot of leave
  // history that can genuinely take longer than the default 30s axios
  // timeout, which was silently aborting the request and leaving the
  // calendar blank until the next (now-idempotent, so fast) retry. Give
  // these two calendar endpoints more headroom instead.
  getStaffCalendar: (staffId, params) =>
    api.get(`/api/hrm/leaves/staff-summary/${staffId}/calendar`, {
      params,
      timeout: 60000,
    }),
  // Staff self-service: the same monthly/annual calendar as above, but
  // scoped server-side to the logged-in account's own staff record — no
  // staffId to pass, so there's nothing to swap out to view someone else's.
  getMyCalendar: (params) =>
    api.get("/api/hrm/leaves/my-attendance/calendar", {
      params,
      timeout: 60000,
    }),

  // ── Leave requests: staff self-service + admin approval ─────────────────
  // Staff member: submit a request / see their own requests + status.
  getMyLeaveRequests: () => api.get("/api/hrm/leaves/requests/my"),
  submitLeaveRequest: (data) => api.post("/api/hrm/leaves/requests/my", data),
  // Admin: review pending requests (or all, filtered by status) and decide.
  getPendingLeaveRequests: () => api.get("/api/hrm/leaves/requests/pending"),
  getAllLeaveRequests: (params) =>
    api.get("/api/hrm/leaves/requests/all", { params }),
  approveLeaveRequest: (id) =>
    api.put(`/api/hrm/leaves/requests/${id}/approve`),
  rejectLeaveRequest: (id, remarks) =>
    api.put(`/api/hrm/leaves/requests/${id}/reject`, { remarks }),
};