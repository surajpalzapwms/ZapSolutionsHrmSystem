// src/components/attendance/hooks/useMyCalendar.js
import { useState, useEffect, useCallback, useRef } from "react";
import { attendanceService } from "../../../services/attendanceService";
import { showToast } from "../../../utils/toast";

/**
 * Staff self-service version of useMRCalendar: same monthly/annual
 * navigation, but always calls getMyCalendar (no staffId param to pass or
 * swap out) so it can only ever return the logged-in account's own
 * attendance.
 */
export const useMyCalendar = () => {
  const today = new Date();
  const [viewMode, setViewMode] = useState("monthly"); // "monthly" | "annual"
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [calendar, setCalendar] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notLinked, setNotLinked] = useState(false);

  // PERFORMANCE: months already viewed render instantly from this cache
  // (then refresh quietly), and a slow response for a month the user has
  // already navigated away from can no longer overwrite the current one.
  const cacheRef = useRef(new Map());
  const reqIdRef = useRef(0);

  const fetchCalendar = useCallback(async () => {
    const key = viewMode === "annual" ? `annual:${year}` : `monthly:${year}:${month}`;
    const reqId = ++reqIdRef.current;
    const cached = cacheRef.current.get(key);
    if (cached !== undefined) {
      setCalendar(cached);
      setNotLinked(!cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const params = viewMode === "annual" ? { year, mode: "annual" } : { year, month };
      const res = await attendanceService.getMyCalendar(params);
      const data = res.data?.data || null;
      cacheRef.current.set(key, data);
      if (reqId !== reqIdRef.current) return;
      setCalendar(data);
      setNotLinked(!data);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      showToast("error", err.response?.data?.message || "Failed to load your attendance");
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [year, month, viewMode]);

  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);

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
    notLinked,
    goToPrevMonth,
    goToNextMonth,
    goToPrevYear,
    goToNextYear,
    goToMonth,
    goToYear,
  };
};
