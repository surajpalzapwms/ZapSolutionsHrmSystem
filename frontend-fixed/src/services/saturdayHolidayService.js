// src/services/saturdayHolidayService.js
import api from "../utils/api";

export const saturdayHolidayService = {
  // { success, year, rules: [{ month, monthName, occurrences }, ...12 entries] }
  getRules: (year) => api.get("/api/hrm/saturday-holidays", { params: { year } }),

  // Bulk-saves the whole year in one call.
  // rules: [{ month: 1, occurrences: [] }, { month: 2, occurrences: [2, 4] }, ...]
  saveRules: (year, rules) => api.put("/api/hrm/saturday-holidays", { year, rules }),

  // Actual calendar dates the saved rules resolve to, shaped like Holiday
  // records so they can be merged straight into the calendar view.
  getComputedDates: (year) => api.get("/api/hrm/saturday-holidays/dates", { params: { year } }),
};
