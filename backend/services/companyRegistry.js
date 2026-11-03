// services/companyRegistry.js
//
// Loads every company (without the heavy logo / signature images) into the
// in-memory registry in utils/companyContext.js, and helps background jobs
// run once per company.
import Company from "../models/Company.js";
import { runUnscoped, runWithCompany } from "../utils/tenant.js";
import { isOwnerCompany } from "../utils/ownerCompany.js";
import {
  setCompanyRegistry,
  putCompanyInRegistry,
  removeCompanyFromRegistry,
  listRegisteredCompanies,
  getRegisteredCompany,
} from "../utils/companyContext.js";

const REFRESH_MS = 60 * 1000;
let lastLoad = 0;
let loading = null;

const toPlain = (c) => {
  if (!c) return c;
  const out = { ...c };
  if (out.legalIds instanceof Map) out.legalIds = Object.fromEntries(out.legalIds);
  delete out.logoData;
  delete out.signatureData;
  delete out.stampData;
  return out;
};

// The owner company (ZAP Solutionz) is recognised by its flag or its link name
// (utils/ownerCompany.js). The first time it is recognised by link name only,
// the flag is saved in the database so the company stays the owner even if its
// link name is edited later. If NO company is the owner, the super admin would
// be view-only everywhere — say so loudly instead of failing silently.
const persistOwnerFlag = async (rows) => {
  const owners = rows.filter(isOwnerCompany);
  if (!owners.length) {
    console.warn(
      "⚠️  No OWNER company found: the super admin is VIEW ONLY in every company. " +
        "Set OWNER_COMPANY_SLUG in .env to the link name of ZAP Solutionz " +
        `(companies: ${rows.map((r) => r.slug).join(", ") || "none"}).`,
    );
    return;
  }
  const unflagged = owners.filter((r) => r.isOwner !== true);
  if (unflagged.length) {
    await runUnscoped(() =>
      Company.updateMany({ _id: { $in: unflagged.map((r) => r._id) } }, { $set: { isOwner: true } }),
    );
    for (const r of unflagged) r.isOwner = true;
  }
  if (owners.length > 1) {
    console.warn(
      `⚠️  ${owners.length} companies match the owner company (${owners.map((r) => r.slug).join(", ")}). ` +
        "The super admin can edit all of them — keep only one.",
    );
  }
};

export const reloadCompanyRegistry = async () => {
  if (loading) return loading;
  loading = (async () => {
    try {
      const rows = await runUnscoped(() => Company.find().lean());
      await persistOwnerFlag(rows).catch((err) => console.error("Owner company check failed:", err.message));
      setCompanyRegistry(rows.map(toPlain));
      lastLoad = Date.now();
    } catch (err) {
      console.error("Could not load companies:", err.message);
    } finally {
      loading = null;
    }
  })();
  return loading;
};

/** Refresh one company after it was saved (no full reload needed). */
export const refreshCompanyInRegistry = async (id) => {
  const row = await runUnscoped(() => Company.findById(id).lean());
  if (row) putCompanyInRegistry(toPlain(row));
  else removeCompanyFromRegistry(id);
  return row ? getRegisteredCompany(id) : null;
};

/** Safety net for several server instances: reload every minute. */
export const startCompanyRegistryRefresh = () => {
  const t = setInterval(() => {
    if (Date.now() - lastLoad >= REFRESH_MS) reloadCompanyRegistry();
  }, REFRESH_MS);
  t.unref?.();
};

/**
 * Company by id from memory; falls back to the database (and caches it)
 * when it was created on another server instance a moment ago.
 */
export const findCompanyCached = async (id) => {
  if (!id) return null;
  const hit = getRegisteredCompany(id);
  if (hit) return hit;
  return refreshCompanyInRegistry(id).catch(() => null);
};

/**
 * Runs `fn(company)` once for every ACTIVE company, each inside that
 * company's context (so every query is limited to it). One company failing
 * never stops the others.
 */
export const forEachCompany = async (fn, { includeInactive = false } = {}) => {
  if (!listRegisteredCompanies().length) await reloadCompanyRegistry();
  const results = [];
  for (const company of listRegisteredCompanies()) {
    if (!includeInactive && company.isActive === false) continue;
    try {
      results.push(await runWithCompany(company._id, () => fn(company)));
    } catch (err) {
      console.error(`[${company.name}]`, err?.message || err);
    }
  }
  return results;
};
