// src/components/attendance/hooks/useMRCalendar.js
import { useState, useEffect, useCallback } from "react";
import { attendanceService } from "../../../services/attendanceService";
import { showToast } from "../../../utils/toast";

export const useMRCalendar = (staffId, defaultDate) => {
  // Defaults to today, but a relieved staff member's calendar should open
  // on the month they actually left instead — landing on "today" would
  // usually show a blank month with nothing to see.
  const initial = defaultDate ? new Date(defaultDate) : new Date();
  const [viewMode, setViewMode] = useState("monthly"); // "monthly" | "annual"
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());
  const [calendar, setCalendar] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);

  const fetchCalendar = useCallback(async () => {
    if (!staffId) return;
    try {
      setLoading(true);
      const params = viewMode === "annual" ? { year, mode: "annual" } : { year, month };
      const res = await attendanceService.getStaffCalendar(staffId, params);
      setCalendar(res.data?.data || null);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [staffId, year, month, viewMode]);

  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);

  useEffect(() => {
    setSelectedDay(null);
  }, [year, month, viewMode]);

  const goToPrevMonth = useCallback(() => {
    setMonth((m) => {
      if (m === 0) {
        setYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const goToNextMonth = useCallback(() => {
    setMonth((m) => {
      if (m === 11) {
        setYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, []);

  const goToPrevYear = useCallback(() => setYear((y) => y - 1), []);
  const goToNextYear = useCallback(() => setYear((y) => y + 1), []);

  // Jump straight to a chosen month/year from a quick-pick dropdown,
  // instead of clicking the prev/next arrows one step at a time to reach a
  // date months or years back (e.g. a staff member's June 2025 history).
  const goToMonth = useCallback((newYear, newMonth) => {
    setYear(newYear);
    setMonth(newMonth);
  }, []);
  const goToYear = useCallback((newYear) => setYear(newYear), []);

  return {
    viewMode,
    setViewMode,
    year,
    month,
    calendar,
    loading,
    selectedDay,
    setSelectedDay,
    goToPrevMonth,
    goToNextMonth,
    goToPrevYear,
    goToNextYear,
    goToMonth,
    goToYear,
    fetchCalendar,
  };
};
