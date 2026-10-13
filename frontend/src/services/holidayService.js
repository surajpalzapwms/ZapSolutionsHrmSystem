// src/services/holidayService.js
import api from "../utils/api";

export const holidayService = {
  getAll: (params) => api.get("/api/hrm/holidays", { params }),
  getById: (id) => api.get(`/api/hrm/holidays/${id}`),
  create: (data) => api.post("/api/hrm/holidays", data),
  update: (id, data) => api.put(`/api/hrm/holidays/${id}`, data),
  delete: (id) => api.delete(`/api/hrm/holidays/${id}`),
  // The backend has no bulk-delete route for this resource, so delete one
  // by one through the existing (validated, permission-checked) endpoint.
  deleteMany: (ids) =>
    Promise.all(ids.map((id) => api.delete(`/api/hrm/holidays/${id}`))),
  import: (data) => api.post("/api/hrm/holidays/import", data),
};