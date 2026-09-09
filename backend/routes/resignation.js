import express from "express";
import { protect, allowAdminOnly } from "../middleware/auth.js";
import {
  getMyResignation,
  submitResignation,
  withdrawResignation,
  getAllResignations,
  approveResignation,
  rejectResignation,
} from "../controllers/resignation.js";

const router = express.Router();

// ── Staff self-service ──────────────────────────────────────────────────
router.get("/me", protect, getMyResignation);
router.post("/me", protect, submitResignation);
router.delete("/me", protect, withdrawResignation);

// ── Admin: review every staff member's resignation requests ────────────
router.get("/all", protect, allowAdminOnly, getAllResignations);
router.put("/:id/approve", protect, allowAdminOnly, approveResignation);
router.put("/:id/reject", protect, allowAdminOnly, rejectResignation);

export default router;