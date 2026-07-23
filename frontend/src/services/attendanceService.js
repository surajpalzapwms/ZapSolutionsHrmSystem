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
};
