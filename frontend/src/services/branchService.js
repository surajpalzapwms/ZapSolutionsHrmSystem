// src/services/branchService.js
// Branches of the current company — company admin (or super admin with a
// company open). A branch admin cannot use these.
import api from "../utils/api";

export const branchService = {
  list: () => api.get("/api/branches"),
  create: (data) => api.post("/api/branches", data),
  update: (id, data) => api.put(`/api/branches/${id}`, data),
  remove: (id) => api.delete(`/api/branches/${id}`),
  // One-time link for THE admin of this branch.
  createAdminInvite: (id, data) => api.post(`/api/branches/${id}/admin-invites`, data),
  cancelAdminInvite: (id, inviteId) => api.delete(`/api/branches/${id}/admin-invites/${inviteId}`),
};
