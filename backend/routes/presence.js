import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { param } from "express-validator";
import { protect, allowAdminOnly, validateRequest } from "../middleware/auth.js";
import {
  protectUserOrDevice,
  heartbeat,
  getMyPresence,
  revokeDevice,
  downloadWindowsAgent,
  getLivePresence,
  listOfficeNetworks,
  addOfficeNetwork,
  removeOfficeNetwork,
  addOfficeWifi,
  removeOfficeWifi,
  officeCheck,
} from "../controllers/presenceController.js";

// Automatic attendance from office-network presence — see services/presence.js.
// Mounted at /api/presence (deliberately NOT under /api/hrm, so these frequent
// background heartbeats don't flush the HRM caches that server.js clears on
// every /api/hrm write).
const router = express.Router();

// A device checks in every few minutes; this only stops runaway loops.
const heartbeatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.get("x-device-token")?.slice(0, 16) ||
    req.headers.authorization?.slice(-24) ||
    ipKeyGenerator(req.ip),
});

router.post("/heartbeat", heartbeatLimiter, protectUserOrDevice, heartbeat);

router.get("/me", protect, getMyPresence);
router.get("/agent/windows", protect, downloadWindowsAgent);
router.delete(
  "/devices/:id",
  protect,
  [param("id").isMongoId()],
  validateRequest,
  revokeDevice,
);
router.get("/live", protect, allowAdminOnly, getLivePresence);
router.get("/office-check", protect, officeCheck);

// Office Wi-Fi networks — admin presses "Set this Wi-Fi as office network".
router.get("/office-networks", protect, allowAdminOnly, listOfficeNetworks);
router.post("/office-networks", protect, allowAdminOnly, addOfficeNetwork);
router.delete(
  "/office-networks/:id",
  protect,
  allowAdminOnly,
  [param("id").isMongoId()],
  validateRequest,
  removeOfficeNetwork,
);

// Office Wi-Fi by NAME (SSID) — keeps working when the office IP changes.
router.post("/office-wifis", protect, allowAdminOnly, addOfficeWifi);
router.delete(
  "/office-wifis/:id",
  protect,
  allowAdminOnly,
  [param("id").isMongoId()],
  validateRequest,
  removeOfficeWifi,
);

export default router;
