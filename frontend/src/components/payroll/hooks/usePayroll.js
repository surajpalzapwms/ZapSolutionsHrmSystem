// src/components/payroll/hooks/usePayroll.js

import { useCallback, useEffect, useMemo, useState } from "react";

import { payrollService } from "../../../services/payrollService";
import { showToast } from "../../../utils/toast";
import {
  useCurrentStaffOnly,
  useLeftStaffIds,
} from "../../../hooks/useCurrentStaffFilter";

import {
  extractList,
  getStaffInfo,
  getNet,
  getPending,
  getStatus,
  getPeriodTime,
  getPeriodLabel,
  downloadCsv,
} from "../../../utils/payrollHelpers";

const PAGE_SIZE = 10;

// Small open/close helper for modals
const useModalState = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState(null);

  const open = useCallback((payload) => {
    // When used directly as onClick, payload is a click event: ignore it
    const isEvent = payload && typeof payload === "object" && "nativeEvent" in payload;
    setData(isEvent ? null : payload ?? null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setData(null);
  }, []);

  return { isOpen, data, open, close };
};

export const usePayroll = () => {
  const [records, setRecords] = useState([]);
  // From GET /payroll/pending-summary: unpaid balances on saved records
  // PLUS past months that have no payroll record at all.
  const [pendingSummary, setPendingSummary] = useState({
    totalPending: 0,
    details: [],
  });
  const [loading, setLoading] = useState(false);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [searchTerm, setSearchTermState] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // No default period: show everything until the user picks a range
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");

  const viewModal = useModalState();
  const addModal = useModalState();

  // -------------------------------------------------------
  // FETCH
  // -------------------------------------------------------
  // The payroll list and the pending summary are loaded independently: the
  // list is shown as soon as it arrives, and the Pending card / per-staff
  // pending amounts fill in when the summary comes back, instead of the
  // whole page waiting behind the slower of the two requests.
  const fetchPayroll = useCallback(async () => {
    setLoading(true);

    const params = {};
    if (periodFrom) params.periodFrom = periodFrom;
    if (periodTo) params.periodTo = periodTo;

    const pendingPromise = payrollService
      .getPendingSummary(params)
      .then((pendingRes) => {
        const pendingData = pendingRes?.data?.data ?? pendingRes?.data ?? {};
        setPendingSummary({
          totalPending: Number(pendingData.totalPending) || 0,
          details: Array.isArray(pendingData.details) ? pendingData.details : [],
        });
      })
      .catch((err) => {
        // Don't let a pending-summary failure hide the payroll list
        console.error("[usePayroll] Failed to load pending summary:", err);
      })
      .finally(() => setPendingLoading(false));
    setPendingLoading(true);

    try {
      const res = await payrollService.getAll(params);
      const list = extractList(res);

      if (list.length === 0) {
        // Helps you spot a response-shape mismatch quickly
        console.warn("[usePayroll] No records parsed. Raw response:", res?.data ?? res);
      }

      setRecords(list);
    } catch (error) {
      console.error("[usePayroll] Failed to load payroll:", error);
      setRecords([]);
      showToast(
        "error",
        error?.response?.data?.message || "Failed to load payroll"
      );
    } finally {
      setLoading(false);
    }

    // Callers that `await fetchPayroll()` (e.g. after saving) get fully
    // up-to-date numbers.
    await pendingPromise;
  }, [periodFrom, periodTo]);

  useEffect(() => {
    fetchPayroll();
  }, [fetchPayroll]);

  // -------------------------------------------------------
  // GROUP RECORDS BY STAFF (one row per staff member)
  // -------------------------------------------------------
  const groupedRows = useMemo(() => {
    // Pending per staff from the backend pending-summary
    const pendingByStaff = new Map();
    const pendingNameByStaff = new Map();
    pendingSummary.details.forEach((d) => {
      const id = String(d.employeeId?._id ?? d.employeeId ?? "");
      if (!id) return;
      pendingByStaff.set(id, (pendingByStaff.get(id) || 0) + (Number(d.amount) || 0));
      if (d.staffName) pendingNameByStaff.set(id, d.staffName);
    });

    const map = new Map();

    records.forEach((record) => {
      const staff = getStaffInfo(record);

      if (!map.has(staff.id)) {
        map.set(staff.id, {
          staffId: staff.id,
          staffName: staff.name,
          staffCode: staff.code,
          contactNo: staff.contact,
          contact: staff.contact,
          project: staff.project,
          records: [],
        });
      }

      map.get(staff.id).records.push(record);
    });

    // Staff who owe salary but have no payroll record yet still get a row
    pendingByStaff.forEach((_, id) => {
      if (!map.has(id)) {
        map.set(id, {
          staffId: id,
          staffName: pendingNameByStaff.get(id) || "Unknown",
          staffCode: "",
          contactNo: "",
          contact: "",
          project: "",
          records: [],
        });
      }
    });

    return Array.from(map.values()).map((group) => {
      const sorted = [...group.records].sort(
        (a, b) => getPeriodTime(a) - getPeriodTime(b)
      );
      const latest = sorted[sorted.length - 1];

      const totalNet = sorted.reduce((sum, r) => sum + getNet(r), 0);
      const pendingOnRecords = sorted.reduce((sum, r) => sum + getPending(r), 0);
      // Prefer the backend figure (includes months with no record);
      // fall back to the records' own pendingAmount if it's unavailable.
      const totalPending = pendingByStaff.has(group.staffId)
        ? pendingByStaff.get(group.staffId)
        : pendingSummary.details.length
          ? 0
          : pendingOnRecords;

      return {
        ...group,
        _id: group.staffId,
        records: sorted,
        months: sorted.length,
        latestPeriod: latest ? getPeriodLabel(latest) : "",
        latestStatus: latest ? getStatus(latest) : "not created",
        totalPending,
        pendingAmount: totalPending,
        totalNet,
      };
    });
  }, [records, pendingSummary]);

  // -------------------------------------------------------
  // "CURRENT STAFF ONLY" TOGGLE — hide staff who have left
  // -------------------------------------------------------
  const [currentOnly, setCurrentOnly] = useCurrentStaffOnly();
  const leftStaffIds = useLeftStaffIds();
  const visibleRows = useMemo(
    () =>
      currentOnly
        ? groupedRows.filter((row) => !leftStaffIds.has(String(row.staffId)))
        : groupedRows,
    [groupedRows, currentOnly, leftStaffIds]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [currentOnly]);

  // -------------------------------------------------------
  // SEARCH (client-side, by name or code)
  // -------------------------------------------------------
  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return visibleRows;

    return visibleRows.filter(
      (row) =>
        row.staffName?.toLowerCase().includes(term) ||
        row.staffCode?.toLowerCase().includes(term)
    );
  }, [visibleRows, searchTerm]);

  const setSearchTerm = useCallback((value) => {
    // SearchBar may pass an event or a string
    const next = typeof value === "string" ? value : value?.target?.value ?? "";
    setSearchTermState(next);
    setCurrentPage(1);
  }, []);

  // -------------------------------------------------------
  // PAGINATION
  // -------------------------------------------------------
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const currentData = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, currentPage]);

  // -------------------------------------------------------
  // SUMMARY (built from the same records as the list,
  // so the cards and the table always agree)
  // -------------------------------------------------------
  const summary = useMemo(() => {
    const count = records.length;
    const totalNet = records.reduce((sum, r) => sum + getNet(r), 0);
    const paid = records.filter(
      (r) => String(r.status).toLowerCase() === "paid"
    ).length;

    // PayrollSummary reads: count, totalNet, pending, paid
    return {
      count,
      totalNet,
      pending: pendingSummary.totalPending,
      pendingLoading,
      paid,
    };
  }, [records, pendingSummary, pendingLoading]);

  // -------------------------------------------------------
  // PERIOD FILTER
  // -------------------------------------------------------
  const setPeriodRange = useCallback((from, to) => {
    setPeriodFrom(from || "");
    setPeriodTo(to || "");
    setCurrentPage(1);
  }, []);

  const clearPeriodRange = useCallback(() => {
    setPeriodFrom("");
    setPeriodTo("");
    setCurrentPage(1);
  }, []);

  // -------------------------------------------------------
  // EXPORT ALL CSV
  // -------------------------------------------------------
  const exportData = useCallback(async () => {
    setExporting(true);

    try {
      const params = {};
      if (periodFrom) params.periodFrom = periodFrom;
      if (periodTo) params.periodTo = periodTo;

      const res = await payrollService.export(params);
      downloadCsv(res?.data ?? res, "payroll_export.csv");
      showToast("success", "Payroll exported");
    } catch (error) {
      console.error("[usePayroll] Export failed:", error);
      showToast("error", "Failed to export payroll");
    } finally {
      setExporting(false);
    }
  }, [periodFrom, periodTo]);

  return {
    loading,
    pendingLoading,
    exporting,
    exportData,
    summary,
    records,
    currentData,
    totalPages,
    currentPage,
    setCurrentPage,
    searchTerm,
    setSearchTerm,
    periodFrom,
    periodTo,
    setPeriodRange,
    clearPeriodRange,
    fetchPayroll,
    viewModal,
    addModal,
    currentOnly,
    setCurrentOnly,
    visibleStaffCount: visibleRows.length,
    totalStaffCount: groupedRows.length,
  };
};

export default usePayroll;