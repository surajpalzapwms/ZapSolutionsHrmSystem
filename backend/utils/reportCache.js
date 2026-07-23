// backend/utils/reportCache.js
const cache = new Map();

export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCached(key, data, ttlSeconds = 300) {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

// Call this after any write that affects a report
export function invalidateCache(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

// Invalidate multiple prefixes at once (convenience helper for write routes)
export function invalidateReportCaches(...prefixes) {
  for (const prefix of prefixes) {
    invalidateCache(prefix);
  }
}

export const CACHE_TTL = {
  REPORTS: 300,   // 5 min — P&L, province, outstanding
  STOCK:   120,   // 2 min — stock in hand
  STATIC:  3600,  // 1 hr  — product list, zones, etc.
};