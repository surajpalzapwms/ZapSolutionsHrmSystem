// src/components/attendance/hooks/useMRSummary.js
import { useState, useEffect, useCallback } from "react";
import { attendanceService } from "../../../services/attendanceService";
import { showToast } from "../../../utils/toast";

export const useStaffSummary = () => {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchStaffSummary = useCallback(async () => {
    try {
      setLoading(true);
      const res = await attendanceService.getStaffSummary();
      setStaffList(res.data?.data || []);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load Staff list");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaffSummary();
  }, [fetchStaffSummary]);

  return { staffList, loading, fetchStaffSummary };
};
