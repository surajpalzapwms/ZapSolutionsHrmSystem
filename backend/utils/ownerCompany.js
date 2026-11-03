// utils/ownerCompany.js
//
// The OWNER company is the one the super admin belongs to and works inside
// (ZAP Solutionz). Every other company is a CLIENT company:
//   - inside the OWNER company the super admin does EVERYTHING: every
//     operation the company admin can do (add / edit / delete staff, payroll,
//     attendance, leave ...) plus the super-admin-only screens;
//   - inside a CLIENT company the super admin is VIEW ONLY. They only create
//     the company (name + country), give its admin a one-time invite link, set
//     its plan (tabs, staff limit, domain) and can activate / deactivate /
//     delete an empty one. The company's own admin fills in the profile, logo,
//     staff, payroll ... (writes are refused in middleware/auth.js).
//
// A company is the owner when
//   1. it has `isOwner: true` in the database (the server sets this flag by
//      itself the first time it recognises the company — see
//      services/companyRegistry.js — so renaming the link name later can never
//      turn the owner into a client), or
//   2. its link name (slug) matches one of OWNER_COMPANY_SLUG (comma
//      separated, default "zap-solutionz,zap,zapsolutionz,zapsolutions").
//
// Slugs are compared WITHOUT hyphens / underscores / spaces / case, so
// "zap-solutionz", "zapsolutionz" and "ZAP_Solutionz" are all the same name.
// (Before, only the exact text "zap-solutionz" or "zap" matched: a company whose
// link name was "zapsolutionz" was treated as a client company and the super
// admin became view-only inside their own company.)
const normalizeSlug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const OWNER_SLUG_KEYS = new Set(
  String(process.env.OWNER_COMPANY_SLUG || "zap-solutionz,zap,zapsolutionz,zapsolutions")
    .split(",")
    .map(normalizeSlug)
    .filter(Boolean),
);

/** True when this link name is one of the owner company's names. */
export const slugTakesOwnerIdentity = (slug) => OWNER_SLUG_KEYS.has(normalizeSlug(slug));

// The owner company is ALSO recognised by its NAME / link name starting with
// "zapsolution" (spaces, hyphens, case ignored), e.g. "ZAP Solutionz",
// "Zap Solutionz Pvt Ltd", "zap-solutionz-pvt-ltd", "zapsolutions-hrm".
// Before, a link name such as "zap-solutionz-pvt-ltd" did not match the exact
// list above, so ZAP Solutionz was treated as a client company and the super
// admin got "View only" when marking attendance inside their own company.
// Override with OWNER_COMPANY_NAME_PREFIX (comma separated) if needed.
const OWNER_NAME_PREFIXES = String(process.env.OWNER_COMPANY_NAME_PREFIX || "zapsolution")
  .split(",")
  .map(normalizeSlug)
  .filter(Boolean);

const startsWithOwnerName = (value) => {
  const key = normalizeSlug(value);
  return !!key && OWNER_NAME_PREFIXES.some((p) => key.startsWith(p));
};

export const isOwnerCompany = (company) =>
  !!company &&
  (company.isOwner === true ||
    slugTakesOwnerIdentity(company.slug) ||
    startsWithOwnerName(company.slug) ||
    startsWithOwnerName(company.name));
