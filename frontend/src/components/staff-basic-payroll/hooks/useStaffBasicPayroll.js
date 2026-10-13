// src/components/staff-basic-payroll/hooks/useStaffBasicPayroll.js
import { useState, useEffect, useCallback, useMemo } from "react";
import { staffBasicPayrollService } from "../../../services/staffBasicPayrollService";
import { useModal } from "../../../hooks/useModal";
import { usePagination } from "../../../hooks/usePagination";
import { useSearch } from "../../../hooks/useSearch";
import { showToast } from "../../../utils/toast";
import { ITEMS_PER_PAGE } from "../../../utils/constants";
import {
  useCurrentStaffOnly,
  useLeftStaffIds,
} from "../../../hooks/useCurrentStaffFilter";

export const useStaffBasicPayroll = () => {
  const [records, setRecords] = useState([]);
  const [availableStaff, setAvailableStaff] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);

  const addModal = useModal();
  const editModal = useModal();
  const viewModal = useModal();
  const importModal = useModal();

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      const res = await staffBasicPayrollService.getAll();
      setRecords(res.data?.data || res.data || []);
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to load staff basic payroll",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAvailableStaff = useCallback(async () => {
    try {
      const res = await staffBasicPayrollService.getAvailableStaff();
      setAvailableStaff(res.data?.data || res.data || []);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchRecords();
    fetchAvailableStaff();
  }, [fetchRecords, fetchAvailableStaff]);

  // "Current staff only" toggle: hide records of staff who have left.
  const [currentOnly, setCurrentOnly] = useCurrentStaffOnly();
  const leftStaffIds = useLeftStaffIds();
  const visibleRecords = useMemo(
    () =>
      currentOnly
        ? records.filter(
            (r) => !leftStaffIds.has(String(r.employeeId?._id ?? r.employeeId)),
          )
        : records,
    [records, currentOnly, leftStaffIds],
  );

  const { searchTerm, setSearchTerm, filteredData } = useSearch(visibleRecords, [
    "staffName",
    "staffId",
  ]);

  const { currentPage, setCurrentPage, totalPages, currentData } =
    usePagination(filteredData, ITEMS_PER_PAGE.STAFF_BASIC_PAYROLL);

  useEffect(() => {
    setCurrentPage(1);
  }, [currentOnly, setCurrentPage]);

  const toggleSelect = useCallback((row) => {
    setSelected((prev) =>
      prev.some((s) => s.id === row._id)
        ? prev.filter((s) => s.id !== row._id)
        : [...prev, { id: row._id }],
    );
  }, []);

  const toggleSelectAll = useCallback(
    (checked) => {
      setSelected(checked ? currentData.map((r) => ({ id: r._id })) : []);
    },
    [currentData],
  );

  const deleteRecord = useCallback(
    async (id, name) => {
      try {
        await staffBasicPayrollService.delete(id);
        showToast("success", `${name || "Record"} deleted successfully`);
        setSelected((prev) => prev.filter((s) => s.id !== id));
        await fetchRecords();
        await fetchAvailableStaff();
      } catch (err) {
        showToast(
          "error",
          err.response?.data?.message || "Failed to delete record",
        );
      }
    },
    [fetchRecords, fetchAvailableStaff],
  );

  const deleteSelected = useCallback(async () => {
    try {
      await staffBasicPayrollService.deleteMany(selected.map((s) => s.id));
      showToast("success", "Selected records deleted successfully");
      setSelected([]);
      await fetchRecords();
      await fetchAvailableStaff();
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to delete records",
      );
    }
  }, [selected, fetchRecords, fetchAvailableStaff]);

  return {
    loading,
    availableStaff,
    currentData,
    totalPages,
    currentPage,
    setCurrentPage,
    selected,
    searchTerm,
    setSearchTerm,
    toggleSelect,
    toggleSelectAll,
    deleteRecord,
    deleteSelected,
    fetchRecords,
    fetchAvailableStaff,
    editModal,
    viewModal,
    addModal,
    importModal,
    currentOnly,
    setCurrentOnly,
    visibleCount: visibleRecords.length,
    totalCount: records.length,
    filteredCount: filteredData.length,
  };
};
