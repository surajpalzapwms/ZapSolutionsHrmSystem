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
  deleteLeave: (id) => api.delete(`/api/hrm/leaves/${id}`),
  getStaffSummary: () => api.get("/api/hrm/leaves/staff-summary"),
  getStaffCalendar: (staffId, params) =>
    api.get(`/api/hrm/leaves/staff-summary/${staffId}/calendar`, { params }),
  // Admin repair tool: re-bridges Sunday/holiday days sitting between two
  // approved leaves that were left un-bridged by data created before the
  // sandwich-leave order-independence fix (e.g. an Excel import whose rows
  // weren't in date order). Safe to call more than once.
  reconcileSandwichLeave: (staffId, params) =>
    api.post(`/api/hrm/leaves/reconcile-sandwich/${staffId}`, null, {
      params,
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
  // Multi-day ("range") requests: approve/reject every day in one action.
  approveLeaveGroup: (groupId) =>
    api.put(`/api/hrm/leaves/requests/group/${groupId}/approve`),
  rejectLeaveGroup: (groupId, remarks) =>
    api.put(`/api/hrm/leaves/requests/group/${groupId}/reject`, { remarks }),
};
