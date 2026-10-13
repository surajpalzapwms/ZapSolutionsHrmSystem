// src/services/documentService.js — staff documents (Aadhaar, PAN, light
// bill) + profile photo. Backend: /api/documents.
import api from "../utils/api";
import { BACKEND_URL } from "../utils/constants";

const UPLOAD_TIMEOUT = 120000;

export const documentService = {
  getMine: () => api.get("/api/documents/me"),
  uploadMine: (payload) => api.post("/api/documents/me", payload, { timeout: UPLOAD_TIMEOUT }),
  deleteMine: (type) => api.delete(`/api/documents/me/${type}`),
  getSummary: () => api.get("/api/documents/summary"),
  getForStaff: (staffId) => api.get(`/api/documents/staff/${staffId}`),
  uploadForStaff: (staffId, payload) =>
    api.post(`/api/documents/staff/${staffId}`, payload, { timeout: UPLOAD_TIMEOUT }),
  deleteForStaff: (staffId, type) => api.delete(`/api/documents/staff/${staffId}/${type}`),
};

// Photo / document links come back relative ("/api/documents/…").
export const fileUrl = (path) => {
  if (!path) return null;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return `${String(BACKEND_URL || "").replace(/\/+$/, "")}${path}`;
};

// File -> { data (base64), mimeType, fileName }
export const readFileForUpload = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve({ data: result.split(",")[1] || "", mimeType: file.type, fileName: file.name });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
