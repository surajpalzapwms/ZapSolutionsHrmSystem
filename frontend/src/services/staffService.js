// src/services/staffService.js
import api from "../utils/api";

export const staffService = {
  getAll: () => api.get("/api/staff"),
  getById: (id) => api.get(`/api/staff/${id}`),
  create: (data) => api.post("/api/staff", data),
  update: (id, data) => api.put(`/api/staff/${id}`, data),
  delete: (id) => api.delete(`/api/staff/${id}`),
  deleteMany: (ids) => api.delete("/api/staff", { data: { ids } }),
  import: (data) => api.post("/api/staff/import", data),
  toggleStatus: (id, isActive) => api.put(`/api/staff/status/${id}`, { isActive }),
  getTeams: () => api.get("/api/staff/teams"),
  getActiveStaff: () => api.get("/api/hrm/advances/staffs-list"),
};