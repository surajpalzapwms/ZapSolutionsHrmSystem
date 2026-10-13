// utils/tenant.js
//
// MULTI-COMPANY support. One backend + one database now serves many
// companies. Every record carries a `company` field and every query is
// automatically limited to the company of the current request, so a company
// can never read, change or delete another company's data — even if a
// controller forgets to filter.
//
// How the "current company" is known:
//   - A normal user (admin / staff) belongs to exactly one company; it is
//     taken from their account.
//   - The super admin belongs to no company. They pick one by sending the
//     `X-Company-Id` header (the website does this after they click a
//     company on the White Label page).
//   - Background jobs (attendance sweep, absence reconciliation) loop over
//     the companies and run each one inside runWithCompany().
//
// The company is kept in an AsyncLocalStorage "context", so controllers and
// services don't need to pass it around.
//
// IMPORTANT: this file registers a global mongoose plugin, and plugins only
// apply to models compiled AFTER they are registered. Every model file
// imports this module first for exactly that reason.

import { AsyncLocalStorage } from "async_hooks";
import mongoose from "mongoose";

const als = new AsyncLocalStorage();

const toObjectId = (id) =>
  id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id));

/** Company id (string) of the current context, or null. */
export const getCompanyId = () => {
  const store = als.getStore();
  if (!store || store.bypass) return null;
  return store.companyId ? String(store.companyId) : null;
};

/** Run `fn` with every query limited to this company. */
export const runWithCompany = (companyId, fn) =>
  als.run({ companyId: companyId ? String(companyId) : null }, fn);

/**
 * Run `fn` WITHOUT any company filter. Only for code that must look across
 * companies on purpose (company list, migration, background loops).
 */
export const runUnscoped = (fn) => als.run({ bypass: true }, fn);

/**
 * Switch the rest of the current async flow (e.g. a login handler, after the
 * user — and so the company — is known) into a company.
 */
export const enterCompany = (companyId) => {
  als.enterWith({ companyId: companyId ? String(companyId) : null });
};

const QUERY_OPS = [
  "count",
  "countDocuments",
  "distinct",
  "find",
  "findOne",
  "findOneAndDelete",
  "findOneAndReplace",
  "findOneAndUpdate",
  "replaceOne",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
];

const currentScope = () => {
  const store = als.getStore();
  if (!store || store.bypass || !store.companyId) return null;
  return store.companyId;
};

mongoose.plugin((schema) => {
  // Models that are not company-owned (the Company collection itself).
  if (schema.options.skipTenant) return;

  // "User" is special: the super admin has no company, so a company's
  // queries must still be able to see that one account (e.g. /auth/me).
  const isUserModel = schema.options.tenantMode === "user";

  if (!schema.path("company")) {
    schema.add({
      company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        index: true,
      },
    });
  }

  // ── Reads / updates / deletes: always add the company condition ─────────
  schema.pre(QUERY_OPS, function () {
    const companyId = currentScope();
    if (!companyId) return;
    const oid = toObjectId(companyId);
    if (isUserModel) {
      this.and([{ $or: [{ company: oid }, { role: "super-admin" }] }]);
    } else {
      // Overrides any `company` a caller tried to put in the filter.
      this.where({ company: oid });
    }
  });

  // ── Aggregations: first stage is the company match ──────────────────────
  schema.pre("aggregate", function () {
    const companyId = currentScope();
    if (!companyId) return;
    const oid = toObjectId(companyId);
    const match = isUserModel
      ? { $or: [{ company: oid }, { role: "super-admin" }] }
      : { company: oid };
    this.pipeline().unshift({ $match: match });
  });

  // ── Creates: stamp the company, and refuse cross-company writes ─────────
  schema.pre("validate", function (next) {
    const companyId = currentScope();
    if (!companyId) return next();
    const isSuper = isUserModel && this.role === "super-admin";
    if (isSuper) return next();
    if (!this.company) {
      this.company = toObjectId(companyId);
    } else if (String(this.company) !== String(companyId)) {
      return next(new Error("Blocked: record belongs to a different company"));
    }
    next();
  });

  schema.pre("insertMany", function (next, docs) {
    const companyId = currentScope();
    if (companyId && Array.isArray(docs)) {
      const oid = toObjectId(companyId);
      for (const d of docs) {
        if (d && !d.company) d.company = oid;
      }
    }
    if (typeof next === "function") next();
  });

  schema.pre("bulkWrite", function (next, ops) {
    const companyId = currentScope();
    if (companyId && Array.isArray(ops)) {
      const oid = toObjectId(companyId);
      for (const op of ops) {
        if (op.insertOne?.document && !op.insertOne.document.company) {
          op.insertOne.document.company = oid;
        }
        for (const kind of ["updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany"]) {
          if (op[kind]) op[kind].filter = { ...(op[kind].filter || {}), company: oid };
        }
      }
    }
    if (typeof next === "function") next();
  });
});
