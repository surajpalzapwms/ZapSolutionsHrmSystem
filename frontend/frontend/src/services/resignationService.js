// src/services/resignationService.js
import api from "../utils/api";

export const resignationService = {
  // The caller's current (non-withdrawn) resignation, or null if none.
  getMine: () => api.get("/api/hrm/resignations/me"),
  submit: (data) => api.post("/api/hrm/resignations/me", data),
  withdraw: () => api.delete("/api/hrm/resignations/me"),

  // ── Admin: every staff member's resignation requests ────────────────────
  getAll: (params) => api.get("/api/hrm/resignations/all", { params }),
  approve: (id, remarks) =>
    api.put(`/api/hrm/resignations/${id}/approve`, { remarks }),
  reject: (id, remarks) =>
    api.put(`/api/hrm/resignations/${id}/reject`, { remarks }),
};