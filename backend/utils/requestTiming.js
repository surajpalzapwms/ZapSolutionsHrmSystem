// utils/requestTiming.js
//
// Measures every API request so slow pages can be diagnosed with real
// numbers instead of guesses:
//   - how long the whole request took,
//   - how much of that was spent waiting on MongoDB,
//   - how many database queries it ran.
//
// Two ways to see it:
//   1. Browser: DevTools -> Network -> click a request -> "Timing" tab shows
//      a "Server Timing" section (total / db, with the query count).
//   2. Server console: any request slower than SLOW_REQUEST_MS is logged as
//        [slow] GET /api/hrm/payroll 2350ms — db 2100ms in 85 queries
//
// How to read it:
//   - db time close to total  -> the database is the bottleneck (too many
//     queries, or the database is far away from the server — each query
//     pays the network round trip).
//   - total much larger than the browser's "Waiting" time -> network/hosting
//     (e.g. a free-tier server waking up from sleep).
//
// IMPORTANT: this module registers a global mongoose plugin, so it must be
// imported BEFORE any model file (it is the first import in server.js).

import { AsyncLocalStorage } from "node:async_hooks";
import mongoose from "mongoose";

const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS) || 800;

const als = new AsyncLocalStorage();

const QUERY_OPS = [
  "find",
  "findOne",
  "countDocuments",
  "estimatedDocumentCount",
  "distinct",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
];

const now = () => Number(process.hrtime.bigint()) / 1e6; // ms

const record = (startedAt) => {
  const store = als.getStore();
  if (!store || typeof startedAt !== "number") return;
  store.queries += 1;
  store.dbMs += now() - startedAt;
};

// Global plugin: time every query / aggregate / save / insertMany / bulkWrite.
mongoose.plugin((schema) => {
  schema.pre(QUERY_OPS, function () {
    this._rtStart = now();
  });
  schema.post(QUERY_OPS, function () {
    record(this._rtStart);
  });

  schema.pre("aggregate", function () {
    this._rtStart = now();
  });
  schema.post("aggregate", function () {
    record(this._rtStart);
  });

  schema.pre("save", function () {
    this.$locals._rtStart = now();
  });
  schema.post("save", function () {
    record(this.$locals._rtStart);
  });

  schema.pre("insertMany", function (next, docs) {
    // model middleware: `this` is the Model
    this._rtInsertStart = now();
    if (typeof next === "function") next();
  });
  schema.post("insertMany", function () {
    record(this._rtInsertStart);
  });

  schema.pre("bulkWrite", function (next) {
    this._rtBulkStart = now();
    if (typeof next === "function") next();
  });
  schema.post("bulkWrite", function () {
    record(this._rtBulkStart);
  });
});

/** Express middleware — mount it before the routes. */
export const requestTiming = (req, res, next) => {
  const store = { startedAt: now(), dbMs: 0, queries: 0 };

  // Set the Server-Timing header right before the headers go out.
  const originalWriteHead = res.writeHead;
  res.writeHead = function (...args) {
    try {
      const total = now() - store.startedAt;
      res.setHeader(
        "Server-Timing",
        `total;dur=${total.toFixed(1)}, db;dur=${store.dbMs.toFixed(1)};desc="${store.queries} queries"`,
      );
    } catch {
      /* headers already sent — ignore */
    }
    return originalWriteHead.apply(this, args);
  };

  res.on("finish", () => {
    const total = now() - store.startedAt;
    if (total >= SLOW_REQUEST_MS) {
      console.warn(
        `[slow] ${req.method} ${req.originalUrl} ${Math.round(total)}ms — db ${Math.round(
          store.dbMs,
        )}ms in ${store.queries} queries`,
      );
    }
  });

  als.run(store, next);
};
