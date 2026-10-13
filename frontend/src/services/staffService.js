// src/services/staffService.js
import api from "../utils/api";

export const staffService = {
  getAll: () => api.get("/api/staff"),
  getById: (id) => api.get(`/api/staff/${id}`),
  create: (data) => api.post("/api/staff", data),
  update: (id, data) => api.put(`/api/staff/${id}`, data),
  delete: (id) => api.delete(`/api/staff/${id}`),
  deletePreview: (id) => api.get(`/api/staff/${id}/delete-preview`),
  deleteMany: (ids) => api.delete("/api/staff", { data: { ids } }),
  import: (data) => api.post("/api/staff/import", data),
  toggleStatus: (id, isActive) => api.put(`/api/staff/status/${id}`, { isActive }),
  getTeams: () => api.get("/api/staff/teams"),
  getMyProfile: () => api.get("/api/staff/me"),
  setPassword: (id, password) => api.put(`/api/staff/${id}/password`, { password }),
  getPassword: (id) => api.get(`/api/staff/${id}/password`),
  getSettlement: (id) => api.get(`/api/staff/${id}/settlement`),
};