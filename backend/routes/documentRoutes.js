// routes/documentRoutes.js — mounted at /api/documents
// (server.js gives this path a larger JSON body limit for file uploads.)
import express from "express";
import { protect, allowAdminOnly } from "../middleware/auth.js";
import { writeOperationLimiter } from "../middleware/rateLimiter.js";
import {
  getMyDocuments,
  uploadMyDocument,
  deleteMyDocument,
  getStaffDocuments,
  uploadStaffDocument,
  deleteStaffDocument,
  getDocumentSummary,
  getPhotoFile,
  getUserPhotoFile,
  getDocumentFile,
} from "../controllers/documentController.js";

const router = express.Router();

// Signed links — checked by signature, not by login (used by <Image>/<img>).
router.get("/photo/:staffId", getPhotoFile);
router.get("/user-photo/:userId", getUserPhotoFile);
router.get("/file/:docId", getDocumentFile);

router.use(protect);

// Staff: own documents + profile photo
router.get("/me", getMyDocuments);
router.post("/me", writeOperationLimiter, uploadMyDocument);
router.delete("/me/:type", writeOperationLimiter, deleteMyDocument);

// Admin / super admin: any staff member
router.get("/summary", allowAdminOnly, getDocumentSummary);
router.get("/staff/:staffId", allowAdminOnly, getStaffDocuments);
router.post("/staff/:staffId", allowAdminOnly, writeOperationLimiter, uploadStaffDocument);
router.delete("/staff/:staffId/:type", allowAdminOnly, writeOperationLimiter, deleteStaffDocument);

export default router;
