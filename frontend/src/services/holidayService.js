// src/services/holidayService.js
import api from "../utils/api";

export const holidayService = {
  getAll: (params) => api.get("/api/hrm/holidays", { params }),
  getById: (id) => api.get(`/api/hrm/holidays/${id}`),
  create: (data) => api.post("/api/hrm/holidays", data),
  update: (id, data) => api.put(`/api/hrm/holidays/${id}`, data),
  delete: (id) => api.delete(`/api/hrm/holidays/${id}`),
  deleteMany: (ids) => api.delete("/api/hrm/holidays", { data: { ids } }),
  import: (data) => api.post("/api/hrm/holidays/import", data),
};