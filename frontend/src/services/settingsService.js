// src/services/settingsService.js
import api from "../utils/api";

export const settingsService = {
  // Public — logo, name, colours, details and payroll currency.
  get: () => api.get("/api/settings"),
  // Super admin, or an admin who was given the "Settings" tab.
  update: (data) => api.put("/api/settings", data),
};
