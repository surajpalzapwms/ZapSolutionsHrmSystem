// src/components/staff/hooks/useStaff.js
import { useState, useEffect, useCallback } from "react";
import { staffService } from "../../../services/staffService";
import { useModal } from "../../../hooks/useModal";
import { usePagination } from "../../../hooks/usePagination";
import { useSearch } from "../../../hooks/useSearch";
import { showToast } from "../../../utils/toast";
import { ITEMS_PER_PAGE } from "../../../utils/constants";

export const useStaff = () => {
  const [staff, setStaff] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);

  const addModal = useModal();
  const editModal = useModal();
  const viewModal = useModal();
  const importModal = useModal();

  const fetchStaff = useCallback(async () => {
    try {
      setLoading(true);
      const res = await staffService.getAll();
      setStaff(res.data?.data || res.data || []);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load staff");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTeams = useCallback(async () => {
    try {
      const res = await staffService.getTeams();
      setTeams(res.data?.data || res.data || []);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchStaff();
    fetchTeams();
  }, [fetchStaff, fetchTeams]);

  const { searchTerm, setSearchTerm, filteredData } = useSearch(staff, [
    "staffName",
    "staffId",
    "projectName",
    "email",
    "contactNo",
  ]);

  const { currentPage, setCurrentPage, totalPages, currentData } = usePagination(
    filteredData,
    ITEMS_PER_PAGE.STAFF
  );

  const toggleSelect = useCallback((member) => {
    setSelected((prev) =>
      prev.some((s) => s.id === member._id)
        ? prev.filter((s) => s.id !== member._id)
        : [...prev, { id: member._id }]
    );
  }, []);

  const toggleSelectAll = useCallback(
    (checked) => {
      setSelected(checked ? currentData.map((m) => ({ id: m._id })) : []);
    },
    [currentData]
  );

  const deleteStaff = useCallback(
    async (id, name) => {
      try {
        await staffService.delete(id);
        showToast("success", `${name || "Staff member"} deleted successfully`);
        setSelected((prev) => prev.filter((s) => s.id !== id));
        await fetchStaff();
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to delete staff member");
      }
    },
    [fetchStaff]
  );

  const deleteSelected = useCallback(async () => {
    try {
      await staffService.deleteMany(selected.map((s) => s.id));
      showToast("success", "Selected staff deleted successfully");
      setSelected([]);
      await fetchStaff();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to delete staff");
    }
  }, [selected, fetchStaff]);

  const toggleStatus = useCallback(
    async (id, isActive) => {
      try {
        await staffService.toggleStatus(id, !isActive);
        showToast("success", `Staff ${!isActive ? "activated" : "deactivated"}`);
        await fetchStaff();
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to update status");
      }
    },
    [fetchStaff]
  );

  return {
    loading,
    teams,
    currentData,
    totalPages,
    currentPage,
    setCurrentPage,
    selected,
    searchTerm,
    setSearchTerm,
    toggleSelect,
    toggleSelectAll,
    deleteStaff,
    deleteSelected,
    toggleStatus,
    fetchStaff,
    editModal,
    viewModal,
    addModal,
    importModal,
    allStaff: staff,
  };
};
