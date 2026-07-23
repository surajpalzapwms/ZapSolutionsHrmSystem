// routes/staffRoutes.js
import express from "express";
import { body, param } from "express-validator";
import { protect, allowAdminOnly, validateRequest } from "../middleware/auth.js";
import { bulkOperationLimiter, writeOperationLimiter } from "../middleware/rateLimiter.js";
import {
  getAllStaff,
  getTeams,
  getStaffById,
  createStaff,
  updateStaff,
  toggleStaffStatus,
  deleteStaff,
  deleteManyStaff,
  importStaff,
} from "../controllers/staffController.js";

const router = express.Router();

// Every route requires a valid session; writes additionally require admin.
router.use(protect);

const staffBodyRules = [
  // The staff form sends split firstName/lastName; other callers (e.g. CSV
  // import elsewhere) may still send a combined staffName. Both are
  // optional individually — the custom check below requires at least one
  // of the two forms of "a name" to be present, matching what
  // createStaff/updateStaff actually accept.
  body("staffName").optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body("firstName").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("lastName").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body().custom((_, { req }) => {
    const hasStaffName = Boolean(req.body.staffName && req.body.staffName.trim());
    const hasFirstName = Boolean(req.body.firstName && req.body.firstName.trim());
    if (!hasStaffName && !hasFirstName) {
      throw new Error("Staff name is required");
    }
    return true;
  }),
  body("staffId").optional().trim().isLength({ max: 40 }),
  body("projectName").optional().trim().isLength({ max: 120 }),
  body("contactNo").optional().trim().isLength({ max: 30 }),
  body("email").optional({ checkFalsy: true }).isEmail().withMessage("Invalid email"),
  body("password").optional({ checkFalsy: true }).isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
  body("date").optional().isISO8601(),
  body("status").optional().isIn(["Trial", "Confirmed"]).withMessage("Status must be Trial or Confirmed"),
  body("enabled").optional().isBoolean(),
];

router.get("/", getAllStaff);
router.get("/teams", getTeams);

router.get(
  "/:id",
  [param("id").isMongoId().withMessage("Invalid staff ID")],
  validateRequest,
  getStaffById,
);

router.post(
  "/",
  allowAdminOnly,
  writeOperationLimiter,
  staffBodyRules,
  validateRequest,
  createStaff,
);

router.post(
  "/import",
  allowAdminOnly,
  bulkOperationLimiter,
  [body().isArray({ min: 1 }).withMessage("Request body must be a non-empty array")],
  validateRequest,
  importStaff,
);

router.put(
  "/status/:id",
  allowAdminOnly,
  [param("id").isMongoId(), body("isActive").isBoolean().withMessage("isActive must be true/false")],
  validateRequest,
  toggleStaffStatus,
);

router.put(
  "/:id",
  allowAdminOnly,
  writeOperationLimiter,
  [param("id").isMongoId().withMessage("Invalid staff ID"), ...staffBodyRules],
  validateRequest,
  updateStaff,
);

router.delete(
  "/",
  allowAdminOnly,
  bulkOperationLimiter,
  [body("ids").isArray({ min: 1 }).withMessage("ids must be a non-empty array")],
  validateRequest,
  deleteManyStaff,
);

router.delete(
  "/:id",
  allowAdminOnly,
  writeOperationLimiter,
  [param("id").isMongoId().withMessage("Invalid staff ID")],
  validateRequest,
  deleteStaff,
);

export default router;
