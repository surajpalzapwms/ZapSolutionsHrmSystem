// src/services/sidebarCountsService.js
import api from "../utils/api";

export const sidebarCountsService = {
  // { success, data: { month, today, holidays, pendingResignations, presentToday } }
  // A field is null when the logged-in role doesn't get that badge.
  get: () => api.get("/api/hrm/sidebar-counts"),
};
