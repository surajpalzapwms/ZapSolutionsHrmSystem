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
  getAvailableStaff: () => api.get("/api/hrm/staff-basic-payrolls/staff/available"),
  // id here is the payroll record's own _id (same id used by getById/update/delete)
  getHistory: (id) => api.get(`/api/hrm/staff-basic-payrolls/${id}/history`),
  addSalary: (id, data) => api.post(`/api/hrm/staff-basic-payrolls/${id}/salary`, data),
};