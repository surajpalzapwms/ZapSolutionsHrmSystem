import express from "express";
import { param } from "express-validator";
import {
  getCountries,
  getBranding,
  getLogo,
  getMyProfile,
  updateMyProfile,
  listCompanies,
  createCompany,
  updateCompany,
  deleteCompany,
  listCompanyAdmins,
  listCompanyAdminInvites,
  createCompanyAdminInvite,
  cancelCompanyAdminInvite,
  getMyNetwork,
  createCompanyLoginLink,
} from "../controllers/companyController.js";
import { protect, allowSuperAdminOnly, allowCompanyAdminOnly, validateRequest } from "../middleware/auth.js";
import { generalAuthRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();
const idParam = [param("id").isMongoId()];
const inviteParams = [param("id").isMongoId(), param("inviteId").isMongoId()];

// ── Public (login page, PDFs, mobile app) ──
router.get("/countries", getCountries);
router.get("/branding", generalAuthRateLimiter, getBranding);
router.get("/logo/:id", getLogo);

// ── The current company's profile: its admin (Settings tab) or the super admin ──
// A branch admin cannot read or edit the company profile.
router.get("/profile", protect, allowCompanyAdminOnly, getMyProfile);
router.put("/profile", protect, allowCompanyAdminOnly, updateMyProfile);

// ── Company management: super admin only ──
router.get("/", protect, allowSuperAdminOnly, listCompanies);
router.get("/my-network", protect, allowSuperAdminOnly, getMyNetwork);
router.post("/", protect, allowSuperAdminOnly, createCompany);
router.put("/:id", protect, allowSuperAdminOnly, idParam, validateRequest, updateCompany);
router.delete("/:id", protect, allowSuperAdminOnly, idParam, validateRequest, deleteCompany);
router.get("/:id/admins", protect, allowSuperAdminOnly, idParam, validateRequest, listCompanyAdmins);
router.post("/:id/login-link", protect, allowSuperAdminOnly, idParam, validateRequest, createCompanyLoginLink);
// Admins are NOT created with a typed password any more: the super admin makes
// a one-time invite link and the future admin creates their own login from it.
router.get("/:id/admin-invites", protect, allowSuperAdminOnly, idParam, validateRequest, listCompanyAdminInvites);
router.post("/:id/admin-invites", protect, allowSuperAdminOnly, idParam, validateRequest, createCompanyAdminInvite);
router.delete("/:id/admin-invites/:inviteId", protect, allowSuperAdminOnly, inviteParams, validateRequest, cancelCompanyAdminInvite);

export default router;
