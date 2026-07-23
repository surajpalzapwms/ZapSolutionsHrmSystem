// src/components/advance/hooks/useAdvance.js
import { useState, useEffect, useCallback } from "react";
import { advanceService } from "../../../services/advanceService";
import { useModal } from "../../../hooks/useModal";
import { usePagination } from "../../../hooks/usePagination";
import { useSearch } from "../../../hooks/useSearch";
import { showToast } from "../../../utils/toast";
import { ITEMS_PER_PAGE } from "../../../utils/constants";

export const useAdvance = () => {
  const [advances, setAdvances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);

  const addModal = useModal();
  const editModal = useModal();
  const viewModal = useModal();

  const fetchAdvances = useCallback(async () => {
    try {
      setLoading(true);
      const res = await advanceService.getAll();
      setAdvances(res.data?.data || res.data || []);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load advances");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdvances();
  }, [fetchAdvances]);

  const { searchTerm, setSearchTerm, filteredData } = useSearch(advances, [
    "employeeName",
    "reason",
  ]);

  const { currentPage, setCurrentPage, totalPages, currentData } = usePagination(
    filteredData,
    ITEMS_PER_PAGE.ADVANCE
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

  const deleteAdvance = useCallback(
    async (id, name) => {
      try {
        await advanceService.delete(id);
        showToast("success", `${name || "Advance"} deleted successfully`);
        setSelected((prev) => prev.filter((s) => s.id !== id));
        await fetchAdvances();
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to delete advance");
      }
    },
    [fetchAdvances]
  );

  const deleteSelected = useCallback(async () => {
    try {
      await advanceService.deleteMany(selected.map((s) => s.id));
      showToast("success", "Selected advances deleted successfully");
      setSelected([]);
      await fetchAdvances();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to delete advances");
    }
  }, [selected, fetchAdvances]);

  const updateStatus = useCallback(
    async (id, status) => {
      try {
        await advanceService.updateStatus(id, status);
        showToast("success", `Advance marked as ${status}`);
        await fetchAdvances();
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to update status");
      }
    },
    [fetchAdvances]
  );

  return {
    loading,
    currentData,
    totalPages,
    currentPage,
    setCurrentPage,
    selected,
    searchTerm,
    setSearchTerm,
    toggleSelect,
    toggleSelectAll,
    deleteAdvance,
    deleteSelected,
    updateStatus,
    fetchAdvances,
    editModal,
    viewModal,
    addModal,
  };
};
