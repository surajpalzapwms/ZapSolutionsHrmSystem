// services/calendarHealCache.js
//
// PERFORMANCE: the staff attendance calendar (buildStaffCalendarPayload in
// controllers/leave.js) runs four "self-heal" passes over the WHOLE year
// (sandwich cleanup, sandwich reconcile, non-working-day cleanup, and the
// attendance/leave conflict check) before it even starts building the
// response. Those passes used to run on EVERY calendar request — every
// month arrow click, every Monthly <-> Annual switch — even though nothing
// had changed since the previous request a second earlier. That was the
// main reason the calendar felt slow to render.
//
// The passes are idempotent, so running them again when no data changed is
// pure wasted work. This module remembers, per staff+year, that the heal
// already ran, and skips it until either:
//   - any write (POST/PUT/PATCH/DELETE) hits an HRM/staff route — see
//     invalidateCalendarHealOnWrite, mounted in server.js — or
//   - HEAL_TTL_MS has passed (safety net for writes made outside the API,
//     e.g. scripts or direct DB edits).
//
// Concurrent requests for the same staff+year share one in-flight heal
// instead of running the same passes in parallel and racing each other.

import { invalidateResponseCache } from "./responseCache.js";

const HEAL_TTL_MS = 10 * 60 * 1000; // 10 minutes

const lastHealAt = new Map(); // "staffId:year" -> timestamp
const inFlight = new Map(); // "staffId:year" -> Promise
let generation = 0; // bumped on every write so an in-flight heal that
// started BEFORE a write never marks the post-write data as "healed"

export const markCalendarDataChanged = () => {
  generation++;
  lastHealAt.clear();
  // Any data change also invalidates the cached payroll pending summary,
  // settlements and staff summary (see services/responseCache.js).
  invalidateResponseCache();
};

/**
 * Runs `healFn` for `key` unless it already ran recently with no writes
 * since. `healFn` should resolve to `true` when every pass succeeded; a
 * `false` result (some pass failed) is not cached, so it retries next time.
 */
export const runCalendarSelfHealOnce = async (key, healFn) => {
  const last = lastHealAt.get(key);
  if (last && Date.now() - last < HEAL_TTL_MS) return;

  if (inFlight.has(key)) return inFlight.get(key);

  const startedGeneration = generation;
  const promise = (async () => {
    try {
      const ok = await healFn();
      if (ok !== false && startedGeneration === generation) {
        lastHealAt.set(key, Date.now());
      }
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
};

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Express middleware: any write to an HRM/staff route may change
 * attendance, leave, holidays or staff dates, so forget which calendars
 * are "already healed". Cleared both when the write starts and when it
 * finishes, so a heal running concurrently with the write can't cache a
 * half-written state.
 */
export const invalidateCalendarHealOnWrite = (req, res, next) => {
  if (WRITE_METHODS.has(req.method)) {
    markCalendarDataChanged();
    res.on("finish", markCalendarDataChanged);
  }
  next();
};
