// src/components/staff/hooks/useStaff.js
import { useState, useEffect, useCallback, useMemo } from "react";
import { staffService } from "../../../services/staffService";
import { useModal } from "../../../hooks/useModal";
import { usePagination } from "../../../hooks/usePagination";
import { useSearch } from "../../../hooks/useSearch";
import { showToast } from "../../../utils/toast";
import { ITEMS_PER_PAGE } from "../../../utils/constants";
import { useCurrentStaffOnly } from "../../../hooks/useCurrentStaffFilter";
import { hasLeftOrganization, isCurrentStaff } from "../../../utils/staffStatus";

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
      // The Staff tab is the one place that lists EVERYONE, including staff
      // who were disabled (those are hidden from every other screen).
      const res = await staffService.getAllIncludingHidden();
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

  // "Current staff only" toggle: hide staff who have left the organization.
  const [currentOnly, setCurrentOnly] = useCurrentStaffOnly();
  const visibleStaff = useMemo(
    () => (currentOnly ? staff.filter(isCurrentStaff) : staff),
    [staff, currentOnly],
  );

  const { searchTerm, setSearchTerm, filteredData } = useSearch(visibleStaff, [
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

  // Back to page 1 whenever the toggle changes the list.
  useEffect(() => {
    setCurrentPage(1);
  }, [currentOnly, setCurrentPage]);

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
        showToast("success", `${name || "Staff member"} and all related data deleted`);
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
      showToast("success", "Selected staff and all their data deleted");
      setSelected([]);
      await fetchStaff();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to delete staff");
    }
  }, [selected, fetchStaff]);

  // Enable / disable. Updated in place right away (no full reload of the
  // list), and put back if the server refuses.
  const toggleStatus = useCallback(
    async (id, isActive) => {
      const next = !isActive;
      const member = staff.find((s) => s._id === id);
      const left = member ? hasLeftOrganization(member) : false;
      setStaff((prev) => prev.map((s) => (s._id === id ? { ...s, enabled: next } : s)));
      try {
        await staffService.toggleStatus(id, next);
        showToast(
          "success",
          left
            ? next
              ? `${member?.staffName || "Staff"} enabled — shown in every tab and dropdown again`
              : `${member?.staffName || "Staff"} disabled — now shown only in the Staff tab`
            : `Staff ${next ? "activated" : "deactivated"}`,
        );
      } catch (err) {
        setStaff((prev) => prev.map((s) => (s._id === id ? { ...s, enabled: isActive } : s)));
        showToast("error", err.response?.data?.message || "Failed to update status");
      }
    },
    [staff]
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
    currentOnly,
    setCurrentOnly,
    visibleCount: visibleStaff.length,
    filteredCount: filteredData.length,
  };
};
