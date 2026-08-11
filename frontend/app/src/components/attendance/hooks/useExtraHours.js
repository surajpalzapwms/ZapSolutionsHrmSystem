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
      const data = res.data?.data || res.data || [];
      setExtraHours(data);
      setTotalMinutes(
        Array.isArray(data)
          ? data.reduce((sum, r) => sum + (r.extraHoursInMinutes || 0), 0)
          : res.data?.totalMinutes || 0
      );
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
