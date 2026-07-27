// src/services/leavePolicyService.js
import api from "../utils/api";

export const leavePolicyService = {
  // Org-wide allowances (paid / sick / casual per year)
  getPolicy: () => api.get("/api/hrm/leave-policy"),
  updatePolicy: (data) => api.put("/api/hrm/leave-policy", data),

  // Balances (admin: everyone; self: own)
  getAllBalances: () => api.get("/api/hrm/leave-policy/balances"),
  getMyBalance: () => api.get("/api/hrm/leave-policy/balances/me"),
};
