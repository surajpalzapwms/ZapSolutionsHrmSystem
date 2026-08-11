// src/services/permissionService.js
import api from "../utils/api";
import { staffService } from "./staffService";

export const permissionService = {
  // Canonical tab/sub-tab tree to render as checkboxes.
  getTabs: () => api.get("/api/auth/permission-tabs"),

  // Every admin account + their current permissions.
  getAdmins: () => api.get("/api/auth/admins"),

  // Update one admin's granted tabs (allTabs + tabs[]), or pass
  // { revoke: true } to demote them back to a plain staff login.
  updatePermissions: (userId, data) =>
    api.put(`/api/auth/admins/${userId}/permissions`, data),

  // Promote an EXISTING staff member to admin. This reuses the same
  // mechanism the "Make Admin" checkbox in StaffForm already uses:
  // PUT /api/staff/:id with { makeAdmin: true } tells the backend to
  // create / link an admin login for that staff record. (Requires the
  // staff to have an email + password on file, same as StaffForm.)
  promoteStaff: (staffId) =>
    staffService.update(staffId, { makeAdmin: true }),
};
