// src/components/attendance/hooks/useMRCalendar.js
import { useState, useEffect, useCallback, useRef } from "react";
import { attendanceService } from "../../../services/attendanceService";
import { showToast } from "../../../utils/toast";

// PERFORMANCE
// -----------
// Every month/year arrow click used to throw the current calendar away,
// show a spinner and wait for a brand-new server round trip — even for a
// month that had been on screen a few seconds earlier. This hook now:
//   1. Keeps every calendar it has loaded in an in-memory cache (per mount,
//      so going back to the Staff List and opening someone again starts
//      fresh). A cached month renders INSTANTLY, and is quietly refreshed
//      in the background.
//   2. Pre-loads the previous and next month after a month finishes
//      loading, so the arrow buttons usually land on cached data.
//   3. Ignores out-of-date responses: clicking quickly through months can
//      no longer let a slow, older response overwrite the month on screen.
//   4. Skips re-rendering when a background refresh returns identical data.
// `fetchCalendar()` (called after an edit/delete/bulk mark) clears the cache
// first, because one change can affect other months too (sandwich leave,
// leave balance, working-day totals).

const keyFor = (viewMode, year, month) =>
  viewMode === "annual" ? `annual:${year}` : `monthly:${year}:${month}`;

const paramsFor = (viewMode, year, month) =>
  viewMode === "annual" ? { year, mode: "annual" } : { year, month };

export const useMRCalendar = (staffId, defaultDate) => {
  // Defaults to today, but a relieved staff member's calendar should open
  // on the month they actually left instead — landing on "today" would
  // usually show a blank month with nothing to see.
  const initial = defaultDate ? new Date(defaultDate) : new Date();
  const [viewMode, setViewMode] = useState("monthly"); // "monthly" | "annual"
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());
  const [calendar, setCalendar] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);

  // key -> { data, json }  (json kept to cheaply detect "nothing changed")
  const cacheRef = useRef(new Map());
  // key -> in-flight Promise, so a prefetch and a real request for the same
  // month share one network call.
  const inFlightRef = useRef(new Map());
  // Bumped whenever the cache is cleared, so a request that started before
  // the clear (i.e. before an edit was saved) can't put old data back in.
  const cacheGenRef = useRef(0);
  // Bumped on every foreground request; only the latest may update state.
  const reqIdRef = useRef(0);
  // The key currently on screen, so a same-data refresh can be skipped.
  const shownKeyRef = useRef(null);

  // Clear everything when switching to a different staff member.
  const clearCache = useCallback(() => {
    cacheGenRef.current++;
    cacheRef.current.clear();
    inFlightRef.current.clear();
  }, []);
  useEffect(() => {
    clearCache();
  }, [staffId, clearCache]);

  const request = useCallback(
    (mode, y, m) => {
      const key = keyFor(mode, y, m);
      const existing = inFlightRef.current.get(key);
      if (existing) return existing;
      const gen = cacheGenRef.current;
      const p = attendanceService
        .getStaffCalendar(staffId, paramsFor(mode, y, m))
        .then((res) => {
          const data = res.data?.data || null;
          const entry = { data, json: JSON.stringify(data) };
          if (gen === cacheGenRef.current) cacheRef.current.set(key, entry);
          return entry;
        })
        .finally(() => {
          if (inFlightRef.current.get(key) === p) inFlightRef.current.delete(key);
        });
      inFlightRef.current.set(key, p);
      return p;
    },
    [staffId],
  );

  // Warm the cache for a month without touching what's on screen.
  const prefetch = useCallback(
    (y, m) => {
      const key = keyFor("monthly", y, m);
      if (cacheRef.current.has(key) || inFlightRef.current.has(key)) return;
      request("monthly", y, m).catch(() => {}); // best effort
    },
    [request],
  );

  const load = useCallback(
    async ({ force = false } = {}) => {
      if (!staffId) return;
      const key = keyFor(viewMode, year, month);
      const reqId = ++reqIdRef.current;

      if (force) clearCache();

      const cached = cacheRef.current.get(key);
      if (cached) {
        // Instant render from cache; refresh quietly below.
        setCalendar(cached.data);
        shownKeyRef.current = key;
        setError(null);
        setLoading(false);
      } else {
        setLoading(true);
        setError(null);
      }

      try {
        const fresh = await request(viewMode, year, month);
        if (reqId !== reqIdRef.current) return; // user moved on
        // Don't re-render (and re-trigger salary reloads etc.) when the
        // background refresh returned exactly what's already showing.
        if (!(cached && shownKeyRef.current === key && cached.json === fresh.json)) {
          setCalendar(fresh.data);
          shownKeyRef.current = key;
        }
        setError(null);

        // Pre-load the neighbours so the arrows feel instant.
        if (viewMode === "monthly") {
          const prev = month === 0 ? [year - 1, 11] : [year, month - 1];
          const next = month === 11 ? [year + 1, 0] : [year, month + 1];
          const now = new Date();
          prefetch(prev[0], prev[1]);
          if (
            next[0] < now.getFullYear() ||
            (next[0] === now.getFullYear() && next[1] <= now.getMonth())
          ) {
            prefetch(next[0], next[1]);
          }
        }
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        // Leave any previously-loaded calendar on screen (a failed refresh
        // shouldn't blank out data that was already showing correctly) but
        // record the failure so the view can render a visible retry state
        // instead of silently showing nothing when there's no prior data.
        const msg = err.response?.data?.message || "Failed to load calendar";
        if (!cached) {
          setCalendar(null);
          setError(msg);
        }
        showToast("error", msg);
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
    },
    [staffId, year, month, viewMode, request, prefetch, clearCache],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Public refresh: data changed on the server, so drop every cached month.
  const fetchCalendar = useCallback(() => load({ force: true }), [load]);

  useEffect(() => {
    setSelectedDay(null);
  }, [year, month, viewMode]);

  const goToPrevMonth = useCallback(() => {
    setMonth((m) => {
      if (m === 0) {
        setYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const goToNextMonth = useCallback(() => {
    setMonth((m) => {
      if (m === 11) {
        setYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, []);

  const goToPrevYear = useCallback(() => setYear((y) => y - 1), []);
  const goToNextYear = useCallback(() => setYear((y) => y + 1), []);

  const goToMonth = useCallback((newYear, newMonth) => {
    setYear(newYear);
    setMonth(newMonth);
  }, []);
  const goToYear = useCallback((newYear) => setYear(newYear), []);

  return {
    viewMode,
    setViewMode,
    year,
    month,
    calendar,
    loading,
    error,
    selectedDay,
    setSelectedDay,
    goToPrevMonth,
    goToNextMonth,
    goToPrevYear,
    goToNextYear,
    goToMonth,
    goToYear,
    fetchCalendar,
  };
};
