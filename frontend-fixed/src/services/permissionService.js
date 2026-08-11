// src/services/permissionService.js
import api from "../utils/api";

export const permissionService = {
  // Canonical tab/sub-tab tree to render as checkboxes.
  getTabs: () => api.get("/api/auth/permission-tabs"),
  // Every account — super admin, admin, and plain staff — with whatever
  // permissions they currently have.
  getAdmins: () => api.get("/api/auth/admins"),
  // Update one admin's granted tabs (allTabs + tabs[]), or pass
  // { revoke: true } to demote them back to a plain staff login.
  updatePermissions: (userId, data) =>
    api.put(`/api/auth/admins/${userId}/permissions`, data),
  // Promote a plain staff login to admin, granting the given tabs
  // (allTabs + tabs[]) in the same request.
  makeAdmin: (userId, data) =>
    api.put(`/api/auth/admins/${userId}/permissions`, { ...data, makeAdmin: true }),
};
