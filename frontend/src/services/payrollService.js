// src/services/payrollService.js
import api from "../utils/api";

export const payrollService = {
  getAll: (params) => api.get("/api/hrm/payroll", { params }),
  getById: (id) => api.get(`/api/hrm/payroll/${id}`),
  create: (data) => api.post("/api/hrm/payroll", data),
  update: (id, data) => api.put(`/api/hrm/payroll/${id}`, data),
  recalculate: (id) => api.put(`/api/hrm/payroll/${id}/recalculate`),
  delete: (id) => api.delete(`/api/hrm/payroll/${id}`),
  deleteMany: (ids) =>
    Promise.all(ids.map((id) => api.delete(`/api/hrm/payroll/${id}`))),
  export: (params) =>
    api.get("/api/hrm/payroll/export/csv", { params, responseType: "blob" }),
  calculate: (staffId, period) =>
    api.get(`/api/hrm/payroll/calculate/${staffId}/${period}`),
  getPendingSummary: (params) =>
    api.get("/api/hrm/payroll/pending-summary", { params }),

};