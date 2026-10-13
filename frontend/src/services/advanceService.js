// src/services/advanceService.js
import api from "../utils/api";

export const advanceService = {
  getAll: (params) => api.get("/api/hrm/advances", { params }),
  // Total advance still owed by one staff member (amount - repaid)
  getOutstanding: (employeeId) =>
    api.get(`/api/hrm/advances/outstanding/${employeeId}`),
  getById: (id) => api.get(`/api/hrm/advances/${id}`),
  create: (data) => api.post("/api/hrm/advances", data),
  update: (id, data) => api.put(`/api/hrm/advances/${id}`, data),
  delete: (id) => api.delete(`/api/hrm/advances/${id}`),
  deleteMany: (ids) => api.delete("/api/hrm/advances", { data: { ids } }),
  updateStatus: (id, status) => api.put(`/api/hrm/advances/${id}/status`, { status }),
  recordRepayment: (id, data) => api.post(`/api/hrm/advances/${id}/repay`, data),
};
