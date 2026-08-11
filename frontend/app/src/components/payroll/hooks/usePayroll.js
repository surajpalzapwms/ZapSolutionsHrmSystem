// src/components/payroll/hooks/usePayroll.js
import { useState, useEffect, useCallback, useMemo } from "react";
import { payrollService } from "../../../services/payrollService";
import { useModal } from "../../../hooks/useModal";
import { usePagination } from "../../../hooks/usePagination";
import { useSearch } from "../../../hooks/useSearch";
import { useExport } from "../../../hooks/useExport";
import { showToast } from "../../../utils/toast";
import { ITEMS_PER_PAGE } from "../../../utils/constants";

export const usePayroll = () => {
  const [payroll, setPayroll] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [periodFrom, setPeriodFromState] = useState(thisMonth);
  const [periodTo, setPeriodToState] = useState(thisMonth);
  const [statusFilter, setStatusFilter] = useState("");

  const addModal = useModal();
  const editModal = useModal();
  const viewModal = useModal();

  const setPeriodRange = useCallback((from, to) => {
    setPeriodFromState(from);
    setPeriodToState(to);
  }, []);

  const clearPeriodRange = useCallback(() => {
    setPeriodFromState("");
    setPeriodToState("");
  }, []);

  const fetchPayroll = useCallback(async () => {
    try {
      setLoading(true);
      const params = { limit: 1000 };
      if (periodFrom) params.periodFrom = periodFrom;
      if (periodTo) params.periodTo = periodTo;
      if (statusFilter) params.status = statusFilter;
      const res = await payrollService.getAll(params);
      const records = res.data?.data || res.data || [];
      setPayroll(
        records.map((r) => ({
          ...r,
          staffName:
            r.employeeId?.staffName || r.employeeName || r.staffName || "",
          contactNo: r.employeeId?.contactNo || r.contactNo || "",
          projectName: r.employeeId?.projectName || r.projectName || "",
        })),
      );
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to load payroll",
      );
    } finally {
      setLoading(false);
    }
  }, [periodFrom, periodTo, statusFilter]);

  useEffect(() => {
    fetchPayroll();
  }, [fetchPayroll]);

  const { searchTerm, setSearchTerm, filteredData } = useSearch(payroll, [
    "staffName",
    "payrollCode",
  ]);

  const { currentPage, setCurrentPage, totalPages, currentData } =
    usePagination(filteredData, ITEMS_PER_PAGE.PAYROLL);

  const summary = useMemo(() => {
    return payroll.reduce(
      (acc, p) => {
        acc.totalNet += p.netSalary || 0;
        acc.count += 1;
        if (p.status === "pending") acc.pending += 1;
        if (p.status === "paid") acc.paid += 1;
        return acc;
      },
      { totalNet: 0, count: 0, pending: 0, paid: 0 },
    );
  }, [payroll]);

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

  const deletePayroll = useCallback(
    async (id, name) => {
      try {
        await payrollService.delete(id);
        showToast("success", `${name || "Payroll"} deleted successfully`);
        setSelected((prev) => prev.filter((s) => s.id !== id));
        await fetchPayroll();
      } catch (err) {
        showToast(
          "error",
          err.response?.data?.message || "Failed to delete payroll",
        );
      }
    },
    [fetchPayroll],
  );

  const deleteSelected = useCallback(async () => {
    try {
      await payrollService.deleteMany(selected.map((s) => s.id));
      showToast("success", "Selected payroll records deleted successfully");
      setSelected([]);
      await fetchPayroll();
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to delete records",
      );
    }
  }, [selected, fetchPayroll]);

  const { exportData, loading: exporting } = useExport(
    payrollService.export,
    "payroll",
  );

  return {
    loading,
    exporting,
    exportData,
    summary,
    currentData,
    totalPages,
    currentPage,
    setCurrentPage,
    selected,
    searchTerm,
    setSearchTerm,
    periodFrom,
    periodTo,
    setPeriodRange,
    clearPeriodRange,
    statusFilter,
    setStatusFilter,
    toggleSelect,
    toggleSelectAll,
    deletePayroll,
    deleteSelected,
    fetchPayroll,
    editModal,
    viewModal,
    addModal,
  };
};
