// src/components/holidays/hooks/useSaturdayHolidays.js
import { useState, useEffect, useCallback } from "react";
import { saturdayHolidayService } from "../../../services/saturdayHolidayService";
import { showToast } from "../../../utils/toast";

const emptyYearRules = () =>
  Array.from({ length: 12 }, (_, idx) => ({ month: idx + 1, occurrences: [] }));

export const useSaturdayHolidays = (initialYear = new Date().getFullYear()) => {
  const [year, setYear] = useState(initialYear);
  const [rules, setRules] = useState(emptyYearRules());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchRules = useCallback(async (targetYear) => {
    try {
      setLoading(true);
      const res = await saturdayHolidayService.getRules(targetYear);
      const fetched = res.data?.rules;
      setRules(
        Array.isArray(fetched) && fetched.length === 12
          ? fetched.map((r) => ({ month: r.month, occurrences: r.occurrences || [] }))
          : emptyYearRules(),
      );
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load Saturday holiday rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules(year);
  }, [year, fetchRules]);

  // Toggles a single Saturday occurrence (1-5) on/off for a given month (1-12).
  const toggleOccurrence = useCallback((month, occurrence) => {
    setRules((prev) =>
      prev.map((r) => {
        if (r.month !== month) return r;
        const has = r.occurrences.includes(occurrence);
        const next = has
          ? r.occurrences.filter((o) => o !== occurrence)
          : [...r.occurrences, occurrence].sort((a, b) => a - b);
        return { ...r, occurrences: next };
      }),
    );
  }, []);

  // Convenience: applies the same set of occurrences (e.g. [2, 4]) to every month at once.
  const applyToAllMonths = useCallback((occurrences) => {
    setRules((prev) => prev.map((r) => ({ ...r, occurrences: [...occurrences].sort((a, b) => a - b) })));
  }, []);

  const clearAllMonths = useCallback(() => {
    setRules((prev) => prev.map((r) => ({ ...r, occurrences: [] })));
  }, []);

  const saveRules = useCallback(async () => {
    try {
      setSaving(true);
      await saturdayHolidayService.saveRules(year, rules);
      showToast("success", "Saturday holiday rules saved successfully");
      return true;
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to save Saturday holiday rules");
      return false;
    } finally {
      setSaving(false);
    }
  }, [year, rules]);

  return {
    year,
    setYear,
    rules,
    loading,
    saving,
    toggleOccurrence,
    applyToAllMonths,
    clearAllMonths,
    saveRules,
    refetch: () => fetchRules(year),
  };
};
