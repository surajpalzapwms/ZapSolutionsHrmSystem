// src/components/expenses/hooks/useOfficeExpense.js
import { useState, useEffect, useCallback } from "react";
import { officeExpenseService } from "../../../services/officeExpenseService";
import { useModal } from "../../../hooks/useModal";
import { usePagination } from "../../../hooks/usePagination";
import { useSearch } from "../../../hooks/useSearch";
import { showToast } from "../../../utils/toast";
import { ITEMS_PER_PAGE } from "../../../utils/constants";

export const useOfficeExpense = () => {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);

  const addModal = useModal();
  const editModal = useModal();
  const categoryModal = useModal();

  const fetchExpenses = useCallback(async () => {
    try {
      setLoading(true);
      const res = await officeExpenseService.getAll();
      setExpenses(res.data?.data || res.data || []);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load expenses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  const { searchTerm, setSearchTerm, filteredData } = useSearch(expenses, [
    "categoryName",
    "note",
  ]);

  const { currentPage, setCurrentPage, totalPages, currentData } = usePagination(
    filteredData,
    ITEMS_PER_PAGE.OFFICE_EXPENSE
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

  const deleteExpense = useCallback(
    async (id, label) => {
      try {
        await officeExpenseService.delete(id);
        showToast("success", `${label || "Expense"} deleted successfully`);
        setSelected((prev) => prev.filter((s) => s.id !== id));
        await fetchExpenses();
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to delete expense");
      }
    },
    [fetchExpenses]
  );

  const deleteSelected = useCallback(async () => {
    try {
      await officeExpenseService.deleteMany(selected.map((s) => s.id));
      showToast("success", "Selected expenses deleted successfully");
      setSelected([]);
      await fetchExpenses();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to delete expenses");
    }
  }, [selected, fetchExpenses]);

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
    deleteExpense,
    deleteSelected,
    fetchExpenses,
    editModal,
    addModal,
    categoryModal,
  };
};
