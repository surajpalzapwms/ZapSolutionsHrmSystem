// src/hooks/useCurrentStaffFilter.js
//
// Shared state for the "Current staff only" toggle shown above the tables
// on the Staff, Staff Basic Payroll, Payroll and Attendance & Leaves tabs.
//
//   ON  (default) -> only staff still working here
//   OFF           -> everyone, including staff who have left
//
// The choice is remembered in the browser and shared by all four tabs, so
// switching it on one tab applies on the others too.

import { useCallback, useEffect, useState } from "react";
import { staffService } from "../services/staffService";
import { hasLeftOrganization } from "../utils/staffStatus";

const STORAGE_KEY = "hrm.currentStaffOnly";
const CHANGE_EVENT = "hrm:currentStaffOnlyChanged";

const readStored = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === "true";
  } catch {
    return true;
  }
};

export const useCurrentStaffOnly = () => {
  const [currentOnly, setCurrentOnlyState] = useState(readStored);

  // Keep every mounted tab in sync (same window and other windows).
  useEffect(() => {
    const sync = () => setCurrentOnlyState(readStored());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setCurrentOnly = useCallback((value) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(!!value));
    } catch {
      /* storage unavailable — still works for this page */
    }
    setCurrentOnlyState(!!value);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [currentOnly, setCurrentOnly];
};

// ── Who has left? ───────────────────────────────────────────────────────
// Payroll and Staff Basic Payroll rows don't carry the staff member's
// status, so those tabs look it up from the staff list. The list is fetched
// at most once per minute and shared between tabs.
const LEFT_IDS_TTL_MS = 60 * 1000;
let leftIdsCache = null; // { ids: Set<string>, at: number }
let leftIdsPromise = null;

const loadLeftStaffIds = () => {
  if (leftIdsCache && Date.now() - leftIdsCache.at < LEFT_IDS_TTL_MS) {
    return Promise.resolve(leftIdsCache.ids);
  }
  if (leftIdsPromise) return leftIdsPromise;
  leftIdsPromise = staffService
    .getAll()
    .then((res) => {
      const list = res?.data?.data || res?.data || [];
      const ids = new Set(
        (Array.isArray(list) ? list : [])
          .filter(hasLeftOrganization)
          .map((s) => String(s._id)),
      );
      leftIdsCache = { ids, at: Date.now() };
      return ids;
    })
    .finally(() => {
      leftIdsPromise = null;
    });
  return leftIdsPromise;
};

/** Set of Staff._id (as strings) for staff who have left the organization. */
export const useLeftStaffIds = () => {
  const [ids, setIds] = useState(() => leftIdsCache?.ids || new Set());
  useEffect(() => {
    let cancelled = false;
    loadLeftStaffIds()
      .then((next) => {
        if (!cancelled) setIds(next);
      })
      .catch(() => {
        /* no status info — nothing gets hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return ids;
};
