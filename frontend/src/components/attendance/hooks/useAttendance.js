// src/components/attendance/hooks/useAttendance.js
import { useState, useEffect, useCallback } from "react";
import { attendanceService } from "../../../services/attendanceService";
import { holidayService } from "../../../services/holidayService";
import { useModal } from "../../../hooks/useModal";
import { usePagination } from "../../../hooks/usePagination";
import { useSearch } from "../../../hooks/useSearch";
import { showToast } from "../../../utils/toast";
import { ITEMS_PER_PAGE } from "../../../utils/constants";
import { getCurrentMonth } from "../../../utils/dateUtils";

export const useAttendance = () => {
  const [attendance, setAttendance] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);
  const [monthFilter, setMonthFilter] = useState(getCurrentMonth());

  const attendanceModal = useModal();
  const leaveModal = useModal();
  const extraHoursModal = useModal();
  const deleteModal = useModal();

  const fetchAttendance = useCallback(async () => {
    try {
      setLoading(true);
      const res = await attendanceService.getAttendance({ month: monthFilter });
      setAttendance(res.data?.data || res.data || []);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load attendance");
    } finally {
      setLoading(false);
    }
  }, [monthFilter]);

  const fetchLeaves = useCallback(async () => {
    try {
      const res = await attendanceService.getLeaves({ month: monthFilter });
      setLeaves(res.data?.data || res.data || []);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load leaves");
    }
  }, [monthFilter]);

  // Holidays rarely change while this screen is open, and both the
  // attendance and leave forms need the same list to block holiday dates,
  // so we fetch it once here rather than duplicating the call in each modal.
  const fetchHolidays = useCallback(async () => {
    try {
      const res = await holidayService.getAll({ enabled: true });
      setHolidays(res.data?.holidays || res.data?.data || []);
    } catch (err) {
      // Non-fatal: forms fall back to only blocking Sundays if this fails.
      console.error("Failed to load holidays for attendance/leave forms:", err);
    }
  }, []);

  useEffect(() => {
    fetchAttendance();
    fetchLeaves();
    fetchHolidays();
  }, [fetchAttendance, fetchLeaves, fetchHolidays]);

  const { searchTerm, setSearchTerm, filteredData } = useSearch(attendance, [
    "userId",
    "attendanceType",
  ]);

  const { currentPage, setCurrentPage, totalPages, currentData } = usePagination(
    filteredData,
    ITEMS_PER_PAGE.ATTENDANCE
  );

  const toggleSelect = useCallback((row) => {
    setSelected((prev) =>
      prev.some((s) => s.id === row._id)
        ? prev.filter((s) => s.id !== row._id)
        : [...prev, { id: row._id }]
    );
  }, []);

  const toggleSelectAll = useCallback(
    (checked) => {
      setSelected(checked ? currentData.map((r) => ({ id: r._id })) : []);
    },
    [currentData]
  );

  const recordAttendance = useCallback(
    async (data) => {
      try {
        await attendanceService.recordAttendance(data);
        showToast("success", "Attendance recorded successfully");
        await fetchAttendance();
        return true;
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to record attendance");
        return false;
      }
    },
    [fetchAttendance]
  );

  const deleteAttendance = useCallback(
    async (id) => {
      try {
        await attendanceService.deleteAttendance(id);
        showToast("success", "Attendance record deleted");
        setSelected((prev) => prev.filter((s) => s.id !== id));
        await fetchAttendance();
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to delete attendance");
      }
    },
    [fetchAttendance]
  );

  const deleteByDate = useCallback(
    async (userId, date) => {
      try {
        await attendanceService.deleteByDate(userId, date);
        showToast("success", "Attendance record deleted");
        await fetchAttendance();
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to delete attendance");
      }
    },
    [fetchAttendance]
  );

  const applyLeave = useCallback(
    async (data) => {
      try {
        await attendanceService.applyLeave(data);
        showToast("success", "Leave applied successfully");
        await fetchLeaves();
        return true;
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to apply leave");
        return false;
      }
    },
    [fetchLeaves]
  );

  const deleteLeave = useCallback(
    async (id) => {
      try {
        await attendanceService.deleteLeave(id);
        showToast("success", "Leave deleted successfully");
        await fetchLeaves();
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to delete leave");
      }
    },
    [fetchLeaves]
  );

  const convertToLeave = useCallback(
    async (data) => {
      try {
        await attendanceService.convertToLeave(data);
        showToast("success", "Converted to leave successfully");
        await Promise.all([fetchAttendance(), fetchLeaves()]);
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to convert to leave");
      }
    },
    [fetchAttendance, fetchLeaves]
  );

  return {
    loading,
    attendance,
    leaves,
    holidays,
    currentData,
    totalPages,
    currentPage,
    setCurrentPage,
    selected,
    searchTerm,
    setSearchTerm,
    monthFilter,
    setMonthFilter,
    toggleSelect,
    toggleSelectAll,
    recordAttendance,
    deleteAttendance,
    deleteByDate,
    applyLeave,
    deleteLeave,
    convertToLeave,
    fetchAttendance,
    fetchLeaves,
    attendanceModal,
    leaveModal,
    extraHoursModal,
    deleteModal,
  };
};
