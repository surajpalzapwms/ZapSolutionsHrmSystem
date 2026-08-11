// src/components/attendance/hooks/useMRCalendar.js
import { useState, useEffect, useCallback } from "react";
import { attendanceService } from "../../../services/attendanceService";
import { showToast } from "../../../utils/toast";

export const useMRCalendar = (staffId) => {
  const now = new Date();
  const [viewMode, setViewMode] = useState("monthly"); // "monthly" | "annual"
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
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
    fetchCalendar,
  };
};
