// routes/letterRoutes.js — mounted at /api/hrm/letters
import express from "express";
import { protect, allowAdminOnly } from "../middleware/auth.js";
import {
  getMyLetters,
  downloadLetter,
  getStaffLetters,
  issueLetter,
  revokeLetter,
  getIssuedLetters,
  getLetterForm,
} from "../controllers/letterController.js";

const router = express.Router();
router.use(protect);

// Admin / super admin: see, generate and withdraw a staff member's letters.
router.get("/issued", allowAdminOnly, getIssuedLetters);
router.get("/staff/:staffId", allowAdminOnly, getStaffLetters);
router.get("/staff/:staffId/:type/form", allowAdminOnly, getLetterForm);
router.post("/staff/:staffId/:type/issue", allowAdminOnly, issueLetter);
router.delete("/staff/:staffId/:type/issue", allowAdminOnly, revokeLetter);

router.get("/", getMyLetters);
router.get("/:type/download", downloadLetter);

export default router;
