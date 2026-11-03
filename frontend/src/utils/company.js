// src/utils/company.js
// White label: which company the website is working on.
//   - admin / staff: always their own company (saved with the login, the
//     server ignores anything else for them).
//   - super admin: the company opened on the Companies page. It is sent as
//     the X-Company-Id header with every request (see utils/api.js).
const KEY = "selectedCompany";

const read = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const getSelectedCompany = () => {
  const parsed = read(KEY);
  return parsed && parsed._id ? parsed : null;
};

// The OWNER company (ZAP Solutionz) — the super admin has FULL access there
// (mark attendance, add staff, payroll ...). Every other company is view only
// for the super admin. Same rule as the server (backend utils/ownerCompany.js):
// the server's isOwner flag, OR the name / link name is one of ZAP Solutionz's
// names (spaces, hyphens and case ignored), e.g. "ZAP Solutionz",
// "zap-solutionz-pvt-ltd", "zapsolutions".
const normalize = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const OWNER_SLUGS = ["zap", "zapsolutionz", "zapsolutions"];
const OWNER_NAME_PREFIX = "zapsolution";
const looksLikeOwner = (value) => {
  const key = normalize(value);
  return !!key && (OWNER_SLUGS.includes(key) || key.startsWith(OWNER_NAME_PREFIX));
};

export const isOwnerCompany = (company) =>
  !!company && (company.isOwner === true || looksLikeOwner(company.slug) || looksLikeOwner(company.name));

export const setSelectedCompany = (company) => {
  if (!company?._id) return;
  // A refresh that doesn't carry isOwner must not turn the owner company into
  // "view only": keep what we knew about the same company.
  const prev = getSelectedCompany();
  const sameAsBefore = prev && String(prev._id) === String(company._id);
  const isOwner =
    isOwnerCompany(company) ||
    (typeof company.isOwner !== "boolean" && sameAsBefore && prev.isOwner === true);
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        _id: company._id,
        name: company.name,
        slug: company.slug,
        country: company.country || "",
        isOwner,
        logoUrl: company.logoUrl || "",
        primaryColor: company.primaryColor || "",
        // null / missing = this company has every tab
        enabledTabs: Array.isArray(company.enabledTabs) ? company.enabledTabs : null,
        tabsVersion: company.tabsVersion || 1,
        probationEnabled: company.probationEnabled !== false,
      }),
    );
  } catch {
    /* storage disabled — the company just isn't remembered */
  }
  window.dispatchEvent(new Event("companyChanged"));
};

export const clearSelectedCompany = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("companyChanged"));
};

/** The company in use: the login's own company, or the super admin's open one. */
export const getActiveCompany = () => {
  const user = read("user");
  if ((user?.role || "").toLowerCase() === "super-admin") return getSelectedCompany() || user?.company || null;
  return user?.company || null;
};

/** Login page link of a company: https://site/login?company=<slug> */
export const loginLinkFor = (company, key = "") =>
  `${window.location.origin}/login?company=${encodeURIComponent(company?.slug || "")}` +
  (key ? `&key=${encodeURIComponent(key)}` : "");

// One-time admin invite link (the token is shown only when the link is made).
export const inviteLinkFor = (token) => `${window.location.origin}/invite/${token}`;
