// src/services/staffService.js
import api from "../utils/api";

// PERFORMANCE: the full staff list is asked for by several screens at once
// (dashboard, payroll form, "who has left" lookup, download dialogs…).
// Identical calls made within a few seconds now share ONE request/response
// instead of each downloading the whole list again. Any staff write clears
// it, so a change is visible immediately.
const LIST_TTL_MS = 15 * 1000;
const listCache = new Map(); // key -> { at, promise }

const cachedGet = (key, request) => {
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.promise;
  const promise = request().catch((err) => {
    listCache.delete(key);
    throw err;
  });
  listCache.set(key, { at: Date.now(), promise });
  return promise;
};

export const clearStaffListCache = () => listCache.clear();

// Clears the shared list after any write, success or not.
const write = (request) => request.finally(clearStaffListCache);

export const staffService = {
  // Staff for every screen EXCEPT the Staff tab: staff that have been
  // disabled (Enable/Disable toggle) are left out by the server.
  getAll: () => cachedGet("visible", () => api.get("/api/staff")),
  // Staff tab only: everyone, including disabled staff.
  getAllIncludingHidden: () =>
    cachedGet("all", () => api.get("/api/staff", { params: { includeHidden: true } })),
  // Final Settlement page: only staff who have left, a few fields each.
  getLeft: () => cachedGet("left", () => api.get("/api/staff/left")),
  getById: (id) => api.get(`/api/staff/${id}`),
  create: (data) => write(api.post("/api/staff", data)),
  update: (id, data) => write(api.put(`/api/staff/${id}`, data)),
  delete: (id) => write(api.delete(`/api/staff/${id}`)),
  deletePreview: (id) => api.get(`/api/staff/${id}/delete-preview`),
  deleteMany: (ids) => write(api.delete("/api/staff", { data: { ids } })),
  import: (data) => write(api.post("/api/staff/import", data)),
  // Enable / disable. For staff who have left, "disabled" means they are
  // shown only on the Staff tab (not in other tabs or any dropdown).
  toggleStatus: (id, isActive) =>
    write(api.put(`/api/staff/status/${id}`, { isActive })),
  getTeams: () => api.get("/api/staff/teams"),
  getMyProfile: () => api.get("/api/staff/me"),
  setPassword: (id, password) => api.put(`/api/staff/${id}/password`, { password }),
  getPassword: (id) => api.get(`/api/staff/${id}/password`),
  getSettlement: (id) => api.get(`/api/staff/${id}/settlement`),
  // Referral organisation + first-month commission (super admin only).
  setReferral: (id, data) => write(api.put(`/api/staff/${id}/referral`, data)),
  clearReferral: (id) => write(api.delete(`/api/staff/${id}/referral`)),
};
