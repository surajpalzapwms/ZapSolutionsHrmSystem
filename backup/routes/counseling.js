import express from "express";
import { protect } from "../middleware/auth.js";
import { getMyCounseling, scheduleCounseling } from "../controllers/counseling.js";

const router = express.Router();
router.get("/me", protect, getMyCounseling);
router.post("/me", protect, scheduleCounseling);
export default router;