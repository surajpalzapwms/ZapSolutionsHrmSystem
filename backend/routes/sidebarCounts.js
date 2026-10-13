// routes/sidebarCounts.js
import express from "express";
import { protect } from "../middleware/auth.js";
import { getSidebarCounts } from "../controllers/sidebarCounts.js";

const router = express.Router();

// Any logged-in account may call this; the controller decides which badges
// that role is allowed to see (others come back as null).
router.get("/", protect, getSidebarCounts);

export default router;
