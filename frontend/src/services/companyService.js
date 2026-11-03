// src/services/companyService.js
import api from "../utils/api";

export const companyService = {
  // Public: country presets (currency, time zone, weekly off, legal numbers).
  countries: () => api.get("/api/company/countries"),
  // Public: login-page branding of a company ({ company: slug } or { id }).
  getBranding: (params) => api.get("/api/company/branding", { params }),

  // The company in use — its admin (Settings tab) or the super admin.
  getProfile: () => api.get("/api/company/profile"),
  updateProfile: (data) => api.put("/api/company/profile", data),

  // Super admin: every company, add, edit, delete, admins.
  list: () => api.get("/api/company"),
  create: (data) => api.post("/api/company", data),
  update: (id, data) => api.put(`/api/company/${id}`, data),
  remove: (id) => api.delete(`/api/company/${id}`),
  admins: (id) => api.get(`/api/company/${id}/admins`),
  // Signed login link that fills in the company admin's e-mail + password.
  loginLink: (id) => api.post(`/api/company/${id}/login-link`),
  // Admins are NOT created with a typed password: the super admin makes a
  // one-time invite link and the future admin creates their own login from it.
  adminInvites: (id) => api.get(`/api/company/${id}/admin-invites`),
  createAdminInvite: (id, data) => api.post(`/api/company/${id}/admin-invites`, data),
  cancelAdminInvite: (id, inviteId) => api.delete(`/api/company/${id}/admin-invites/${inviteId}`),
  // Super admin: the network address this computer comes from (office Wi-Fi).
  myNetwork: () => api.get("/api/company/my-network"),
};
