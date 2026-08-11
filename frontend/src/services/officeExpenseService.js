// src/services/officeExpenseService.js
import api from "../utils/api";

export const officeExpenseService = {
  getAll: (params) => api.get("/api/hrm/office-expenses", { params }),
  getById: (id) => api.get(`/api/hrm/office-expenses/${id}`),
  create: (data) => api.post("/api/hrm/office-expenses", data),
  update: (id, data) => api.put(`/api/hrm/office-expenses/${id}`, data),
  delete: (id) => api.delete(`/api/hrm/office-expenses/${id}`),
  deleteMany: (ids) => api.delete("/api/hrm/office-expenses", { data: { ids } }),
  getSummary: (params) => api.get("/api/hrm/office-expenses/summary", { params }),
};
