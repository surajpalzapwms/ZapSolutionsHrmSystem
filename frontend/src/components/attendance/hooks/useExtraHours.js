// src/components/attendance/hooks/useExtraHours.js
import { useState, useCallback } from "react";
import { attendanceService } from "../../../services/attendanceService";
import { showToast } from "../../../utils/toast";

export const useExtraHours = () => {
  const [extraHours, setExtraHours] = useState([]);
  const [loading, setLoading] = useState(false);
  const [totalMinutes, setTotalMinutes] = useState(0);

  const fetchExtraHours = useCallback(async (userId, params = {}) => {
    if (!userId) return;
    try {
      setLoading(true);
      const res = await attendanceService.getExtraHours(userId, params);
      const payload = res.data?.data || {};
      // recordsWithExtraHours is the actual per-day array; sort it so the
      // biggest single-day contributors surface first — that's what you
      // need to see to explain an inflated total like "20d 7h 22m".
      const records = [...(payload.recordsWithExtraHours || [])].sort(
        (a, b) => (b.extraHoursInMinutes || 0) - (a.extraHoursInMinutes || 0)
      );
      setExtraHours(records);
      setTotalMinutes(payload.totalExtraMinutes || 0);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load extra hours");
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setExtraHours([]);
    setTotalMinutes(0);
  }, []);

  return { extraHours, totalMinutes, loading, fetchExtraHours, reset };
};