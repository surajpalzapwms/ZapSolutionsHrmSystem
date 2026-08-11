// src/services/expenseCategoryService.js
import api from "../utils/api";

export const expenseCategoryService = {
  getAll: (params) => api.get("/api/hrm/expense-categories", { params }),
  create: (data) => api.post("/api/hrm/expense-categories", data),
  update: (id, data) => api.put(`/api/hrm/expense-categories/${id}`, data),
  delete: (id) => api.delete(`/api/hrm/expense-categories/${id}`),
};
