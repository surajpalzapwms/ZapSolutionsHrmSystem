import express from "express";
import { param } from "express-validator";
import {
  getBranding,
  updateBranding,
  listCompanies,
  createCompany,
  updateCompany,
  deleteCompany,
  getMyNetwork,
} from "../controllers/companyController.js";
import { protect, allowSuperAdminOnly, validateRequest } from "../middleware/auth.js";
import { generalAuthRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// Public: the login page needs branding before anyone is logged in.
router.get("/branding", generalAuthRateLimiter, getBranding);
// Branding of the company the super admin currently has open.
router.put("/branding", protect, allowSuperAdminOnly, updateBranding);

// Company management — super admin only.
router.get("/", protect, allowSuperAdminOnly, listCompanies);
router.get("/my-network", protect, allowSuperAdminOnly, getMyNetwork);
router.post("/", protect, allowSuperAdminOnly, createCompany);
router.put("/:id", protect, allowSuperAdminOnly, [param("id").isMongoId()], validateRequest, updateCompany);
router.delete("/:id", protect, allowSuperAdminOnly, [param("id").isMongoId()], validateRequest, deleteCompany);

export default router;
