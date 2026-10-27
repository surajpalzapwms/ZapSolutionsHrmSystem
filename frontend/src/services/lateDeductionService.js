// src/services/lateDeductionService.js
// Late-coming deduction controls (backend: routes/lateDeduction.js).
// Writes are SUPER ADMIN only — the backend refuses anyone else.
import api from "../utils/api";

export const lateDeductionService = {
  // Month summary (admin). Staff get theirs inside their calendar payload.
  getSummary: (staffId, period) =>
    api.get(`/api/hrm/late-deduction/${staffId}/${period}`),
  // { staffId, period: "YYYY-MM", deductLate: boolean }
  setMonth: (data) => api.put("/api/hrm/late-deduction/month", data),
  // { staffId, date: "YYYY-MM-DD", waived: boolean }
  setDay: (data) => api.put("/api/hrm/late-deduction/day", data),
  // { staffId, date, lunchSkipped: boolean, lunchTakenMinutes?: number | null }
  setLunch: (data) => api.put("/api/hrm/late-deduction/lunch", data),
};
