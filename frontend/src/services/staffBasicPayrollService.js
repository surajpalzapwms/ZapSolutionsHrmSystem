// src/services/staffBasicPayrollService.js
import api from "../utils/api";

export const staffBasicPayrollService = {
  getAll: (params) => api.get("/api/hrm/staff-basic-payrolls", { params }),
  getById: (id) => api.get(`/api/hrm/staff-basic-payrolls/${id}`),
  create: (data) => api.post("/api/hrm/staff-basic-payrolls", data),
  update: (id, data) => api.put(`/api/hrm/staff-basic-payrolls/${id}`, data),
  delete: (id) => api.delete(`/api/hrm/staff-basic-payrolls/${id}`),
  deleteMany: (ids) => api.delete("/api/hrm/staff-basic-payrolls", { data: { ids } }),
  import: (data) => api.post("/api/hrm/staff-basic-payrolls/import", data),
  getAvailableStaff: () =>
    api.get("/api/hrm/staff-basic-payrolls/staff/available", {
      // Cache-busting query param + no-cache headers so this always
      // fetches the current list instead of a stale browser-cached copy.
      params: { _t: Date.now() },
      headers: { "Cache-Control": "no-cache" },
    }),
  getHistory: (staffId) => api.get(`/api/hrm/staff-basic-payrolls/${staffId}/history`),
  addSalary: (staffId, data) => api.post(`/api/hrm/staff-basic-payrolls/${staffId}/salary`, data),
  updateSalary: (staffId, historyId, data) =>
    api.put(`/api/hrm/staff-basic-payrolls/${staffId}/salary/${historyId}`, data),
  deleteSalary: (staffId, historyId) =>
    api.delete(`/api/hrm/staff-basic-payrolls/${staffId}/salary/${historyId}`),
};