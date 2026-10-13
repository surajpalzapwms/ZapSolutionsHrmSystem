// src/services/presenceService.js
// Automatic attendance from office-network presence (backend: /api/presence,
// services/presence.js). The backend decides "in office" from the request's
// network address (a browser can't read the Wi-Fi name; phones / PC agents
// send it), so the browser only has to say "I'm here".
import api from "../utils/api";

const DEVICE_KEY = "presenceDeviceId";

export const getBrowserDeviceId = () => {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "web-unknown";
  }
};

const browserName = () => {
  const ua = navigator.userAgent || "";
  const os = /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Linux/i.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br}${os ? ` on ${os}` : ""}`;
};

export const presenceService = {
  heartbeat: (event = "heartbeat") =>
    api.post("/api/presence/heartbeat", {
      event,
      deviceId: getBrowserDeviceId(),
      platform: "web",
      name: browserName(),
    }),
  getMine: () => api.get("/api/presence/me"),
  getLive: () => api.get("/api/presence/live"),
  // Admin: office Wi-Fi networks
  getOfficeNetworks: () => api.get("/api/presence/office-networks"),
  addOfficeNetwork: (data = {}) => api.post("/api/presence/office-networks", data),
  removeOfficeNetwork: (id) => api.delete(`/api/presence/office-networks/${id}`),
  // Office Wi-Fi by NAME (works with a changing office IP)
  addOfficeWifi: (data = {}) => api.post("/api/presence/office-wifis", data),
  removeOfficeWifi: (id) => api.delete(`/api/presence/office-wifis/${id}`),
  revokeDevice: (id) => api.delete(`/api/presence/devices/${id}`),
  // Personal Windows installer (.ps1) with this user's device key inside.
  downloadWindowsAgent: (name) =>
    api.get("/api/presence/agent/windows", {
      params: { name },
      responseType: "blob",
    }),
};
