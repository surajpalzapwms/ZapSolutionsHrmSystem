// src/components/holidays/hooks/useHolidays.js
import { useState, useEffect, useCallback } from "react";
import { holidayService } from "../../../services/holidayService";
import { useModal } from "../../../hooks/useModal";
import { usePagination } from "../../../hooks/usePagination";
import { useSearch } from "../../../hooks/useSearch";
import { showToast } from "../../../utils/toast";
import { ITEMS_PER_PAGE } from "../../../utils/constants";

export const useHolidays = () => {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);

  const addModal = useModal();
  const editModal = useModal();
  const viewModal = useModal();
  const importModal = useModal();

  const fetchHolidays = useCallback(async () => {
    try {
      setLoading(true);
      const res = await holidayService.getAll();
      setHolidays(res.data?.holidays || res.data?.data || []);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load holidays");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  const { searchTerm, setSearchTerm, filteredData } = useSearch(holidays, ["name", "description"]);

  const {
    currentPage,
    setCurrentPage,
    totalPages,
    currentData,
  } = usePagination(filteredData, ITEMS_PER_PAGE.HOLIDAYS);

  const toggleSelect = useCallback((holiday) => {
    setSelected((prev) =>
      prev.some((s) => s.id === holiday._id)
        ? prev.filter((s) => s.id !== holiday._id)
        : [...prev, { id: holiday._id }]
    );
  }, []);

  const toggleSelectAll = useCallback(
    (checked) => {
      setSelected(checked ? currentData.map((h) => ({ id: h._id })) : []);
    },
    [currentData]
  );

  const deleteHoliday = useCallback(
    async (id, name) => {
      try {
        await holidayService.delete(id);
        showToast("success", `${name || "Holiday"} deleted successfully`);
        setSelected((prev) => prev.filter((s) => s.id !== id));
        await fetchHolidays();
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to delete holiday");
      }
    },
    [fetchHolidays]
  );

  const deleteSelected = useCallback(async () => {
    try {
      await holidayService.deleteMany(selected.map((s) => s.id));
      showToast("success", "Selected holidays deleted successfully");
      setSelected([]);
      await fetchHolidays();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to delete holidays");
    }
  }, [selected, fetchHolidays]);

  return {
    loading,
    currentData,
    allHolidays: holidays,
    totalPages,
    currentPage,
    setCurrentPage,
    selected,
    searchTerm,
    setSearchTerm,
    toggleSelect,
    toggleSelectAll,
    deleteHoliday,
    deleteSelected,
    fetchHolidays,
    editModal,
    viewModal,
    addModal,
    importModal,
  };
};
