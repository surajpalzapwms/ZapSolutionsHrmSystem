// src/services/inviteService.js
// PUBLIC — the page behind a one-time admin invite link (no login needed).
import api from "../utils/api";

export const inviteService = {
  get: (token) => api.get(`/api/invites/${token}`),
  accept: (token, data) => api.post(`/api/invites/${token}/accept`, data),
};
