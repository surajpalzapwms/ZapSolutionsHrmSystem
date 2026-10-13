// src/services/letterService.js — HR letters (admin side)
import api from "../utils/api";

export const letterService = {
  // Status of all six letters for one staff member (Staff _id)
  getForStaff: (staffId) => api.get(`/api/hrm/letters/staff/${staffId}`),
  // Offer / Joining / Confirmation: the details form — every field with its
  // current value and which ones are still missing for this staff member.
  getForm: (staffId, type) => api.get(`/api/hrm/letters/staff/${staffId}/${type}/form`),
  // Generate (issue) a letter — enables it in the staff member's mobile app.
  // `details` = the values entered in the details form (offer / joining /
  // confirmation only).
  issue: (staffId, type, details) =>
    api.post(`/api/hrm/letters/staff/${staffId}/${type}/issue`, details ? { details } : {}),
  // Withdraw a generated letter — disables it again
  revoke: (staffId, type) => api.delete(`/api/hrm/letters/staff/${staffId}/${type}/issue`),
  download: (staffId, type) =>
    api.get(`/api/hrm/letters/${type}/download`, {
      params: { staffId },
      responseType: "blob",
    }),
};
