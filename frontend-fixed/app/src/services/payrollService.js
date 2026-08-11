// src/services/payrollService.js
import api from "../utils/api";

export const payrollService = {
  getAll: (params) => api.get("/api/hrm/payroll", { params }),
  getById: (id) => api.get(`/api/hrm/payroll/${id}`),
  create: (data) => api.post("/api/hrm/payroll", data),
  update: (id, data) => api.put(`/api/hrm/payroll/${id}`, data),
  delete: (id) => api.delete(`/api/hrm/payroll/${id}`),
  deleteMany: (ids) => api.delete("/api/hrm/payroll", { data: { ids } }),
  import: (data) => api.post("/api/hrm/payroll/import", data),
  export: (params) =>
    api.get("/api/hrm/payroll/export/csv", { params, responseType: "blob" }),
  calculate: (staffId, period) =>
    api.get(`/api/hrm/payroll/calculate/${staffId}/${period}`),
  bulkCreate: (data) => api.post("/api/hrm/payroll/bulk", data),
};