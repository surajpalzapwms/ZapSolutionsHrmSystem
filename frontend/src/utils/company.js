// src/utils/company.js
// Multi-company: which company the super admin currently has open.
// A normal admin / staff login belongs to one company on the server, so this
// only matters for the super admin (the server ignores it for everyone else).
const KEY = "selectedCompany";

export const getSelectedCompany = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed._id ? parsed : null;
  } catch {
    return null;
  }
};

export const setSelectedCompany = (company) => {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        _id: company._id,
        name: company.name,
        slug: company.slug,
        // null / missing = this company has every tab
        enabledTabs: Array.isArray(company.enabledTabs) ? company.enabledTabs : null,
      }),
    );
  } catch {
    /* storage disabled — the company just isn't remembered */
  }
};

export const clearSelectedCompany = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};
