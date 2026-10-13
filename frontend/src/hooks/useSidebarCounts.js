// src/hooks/useSidebarCounts.js
//
// Live numbers for the sidebar badges (holidays this month, pending
// resignations, present today). Refreshes on mount, every minute, whenever
// the tab regains focus, and instantly when any screen calls
// refreshSidebarCounts() (e.g. right after an admin approves / rejects a
// resignation, or a staff member submits one).
import { useCallback, useEffect, useRef, useState } from "react";
import { sidebarCountsService } from "../services/sidebarCountsService";

const REFRESH_EVENT = "sidebar-counts:refresh";
const POLL_MS = 60 * 1000;

export const refreshSidebarCounts = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REFRESH_EVENT));
};

export const useSidebarCounts = (enabled = true) => {
  const [counts, setCounts] = useState({
    holidays: null,
    pendingResignations: null,
    presentToday: null,
  });
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current || !localStorage.getItem("token")) return;
    inFlight.current = true;
    try {
      const res = await sidebarCountsService.get();
      const data = res.data?.data;
      if (data) setCounts(data);
    } catch {
      /* a badge failing to load must never break the sidebar - keep the last value */
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    window.addEventListener(REFRESH_EVENT, load);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener(REFRESH_EVENT, load);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, load]);

  return counts;
};
