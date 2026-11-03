// services/responseCache.js
//
// PERFORMANCE: the Payroll tab and the HRM dashboard both call a few
// endpoints whose answer is expensive to build but rarely changes:
//   - GET /api/hrm/payroll/pending-summary  (runs a Full & Final
//     settlement — month-by-month salary + leave ledger — for every
//     relieved staff member)
//   - computeFinalSettlement(staffId)       (same settlement, also used by
//     the settlement PDF)
//   - GET /api/hrm/leaves/staff-summary     (leave balance + extra hours
//     for every staff member)
// Rebuilding those on every page load was what made both screens slow.
//
// This keeps the last result in memory and serves it again until either:
//   - any write (POST/PUT/PATCH/DELETE) hits an HRM/staff route — the
//     existing invalidateCalendarHealOnWrite middleware in server.js calls
//     markCalendarDataChanged(), which clears this cache too; or
//   - the entry's TTL runs out (safety net for changes made outside the
//     API, e.g. scripts, direct DB edits, or simply the date moving on).
//
// Concurrent requests for the same key share ONE in-flight computation
// instead of all doing the same heavy work in parallel (the dashboard and
// the Payroll tab often ask for the pending summary at the same moment).

import { getCompanyId, runWithCompany } from "../utils/tenant.js";
import { listRegisteredCompanies } from "../utils/companyContext.js";

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 500;

const store = new Map(); // key -> { value, expiresAt }
const inFlight = new Map(); // key -> Promise
let generation = 0; // bumped on every invalidation

// Background "warmers": functions that rebuild the most-used entries (the
// default pending summary, the staff summary) shortly after the cache is
// cleared, so the NEXT page load finds them ready instead of waiting.
// Debounced: a burst of saves triggers only one rebuild, 3s after the last.
const warmers = [];
const WARM_DELAY_MS = 3000;
let warmTimer = null;

export const registerCacheWarmer = (fn) => {
  warmers.push(fn);
};

// Warmers run inside each company (all active companies at start-up, only
// the company that changed after a write).
const warmCompany = (companyId) =>
  warmers.forEach((fn) => {
    runWithCompany(companyId, () =>
      Promise.resolve()
        .then(fn)
        .catch((err) => console.error("[responseCache] Warm-up failed:", err?.message || err)),
    );
  });

export const runCacheWarmers = (companyIds = null) => {
  const ids =
    companyIds ||
    listRegisteredCompanies()
      .filter((c) => c.isActive !== false)
      .map((c) => String(c._id));
  ids.forEach(warmCompany);
};

const pendingWarm = new Set();
const scheduleWarmers = (companyId) => {
  if (!warmers.length || !companyId) return;
  pendingWarm.add(String(companyId));
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    warmTimer = null;
    const ids = [...pendingWarm];
    pendingWarm.clear();
    runCacheWarmers(ids);
  }, WARM_DELAY_MS);
  // Don't keep the process alive just for this timer.
  warmTimer.unref?.();
};

/** A write is starting: results computed before it must not be cached. */
export const noteWriteStarting = () => {
  generation++;
};

/**
 * Drops cached answers. With a company id only THAT company's entries go
 * (a save in one company never slows down the others); without one,
 * everything is cleared.
 */
export const invalidateResponseCache = (companyId = getCompanyId()) => {
  generation++;
  if (!companyId) {
    store.clear();
    inFlight.clear();
    return;
  }
  const prefix = `${companyId}::`;
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
  for (const k of inFlight.keys()) if (k.startsWith(prefix)) inFlight.delete(k);
  scheduleWarmers(companyId);
};

/**
 * Returns the cached value for `key`, or runs `compute()` once, caches its
 * result for `ttlMs`, and returns it. Errors are never cached.
 */
export const getOrCompute = async (rawKey, compute, ttlMs = DEFAULT_TTL_MS) => {
  // Keyed per company: one backend serves several companies, and a cached
  // staff summary / pending summary must never be served to another one.
  const key = `${getCompanyId() || "_"}::${rawKey}`;
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  if (inFlight.has(key)) return inFlight.get(key);

  const startedGeneration = generation;
  const promise = (async () => {
    try {
      const value = await compute();
      // Only cache if no write happened while we were computing — otherwise
      // the result may already be stale.
      if (startedGeneration === generation) {
        if (store.size >= MAX_ENTRIES) {
          const oldestKey = store.keys().next().value;
          store.delete(oldestKey);
        }
        store.set(key, { value, expiresAt: Date.now() + ttlMs });
      }
      return value;
    } finally {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
};
