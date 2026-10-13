// src/services/companyService.js
import api from "../utils/api";

export const companyService = {
  // Branding of the company in use. `params` can carry { id } or { slug }
  // (used by the login page, before anyone is logged in).
  getBranding: (params) => api.get("/api/company/branding", { params }),
  updateBranding: (data) => api.put("/api/company/branding", data),

  // Super admin: every company (with staff counts), add, edit, delete.
  list: () => api.get("/api/company"),
  create: (data) => api.post("/api/company", data),
  update: (id, data) => api.put(`/api/company/${id}`, data),
  // Super admin: the network address this computer comes from (office Wi-Fi).
  myNetwork: () => api.get("/api/company/my-network"),
  remove: (id) => api.delete(`/api/company/${id}`),
};
