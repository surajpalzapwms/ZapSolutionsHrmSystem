// routes/staffRoutes.js
import express from "express";
import { body, param } from "express-validator";
import {
  protect,
  allowAdminOnly,
  validateRequest,
  allowSuperAdminOnly,
} from "../middleware/auth.js";
import { requireTabAccess } from "../middleware/permission.js";
import {
  bulkOperationLimiter,
  writeOperationLimiter,
} from "../middleware/rateLimiter.js";
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
  getMyStaffProfile,
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
  body("staffName")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 120 }),
  body("firstName").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("lastName").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body().custom((_, { req }) => {
    const hasStaffName = Boolean(
      req.body.staffName && req.body.staffName.trim(),
    );
    const hasFirstName = Boolean(
      req.body.firstName && req.body.firstName.trim(),
    );
    if (!hasStaffName && !hasFirstName) {
      throw new Error("Staff name is required");
    }
    return true;
  }),
  body("staffId").optional().trim().isLength({ max: 40 }),
  body("projectName").optional().trim().isLength({ max: 120 }),
  body("contactNo").optional().trim().isLength({ max: 30 }),
  body("email")
    .optional({ checkFalsy: true })
    .isEmail()
    .withMessage("Invalid email"),
  body("password")
    .optional({ checkFalsy: true })
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  // checkFalsy: true on every optional date field below — the frontend
  // intentionally sends "" for whichever date fields belong to the
  // inactive Status/Employment Type section (see StaffForm's mutual-
  // exclusivity toggle). Without checkFalsy, express-validator's
  // .optional() only skips validation when the field is missing entirely
  // (undefined), NOT when it's an empty string — so isISO8601() was
  // running on "" and failing with "Invalid value".
  body("date").optional({ checkFalsy: true }).isISO8601(),
  body("status")
    .optional()
    .isIn(["Probation", "Confirmation", "Relieving"])
    .withMessage("Status must be one of: Probation, Confirmation, Relieving"),
  body("probationMonths")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Probation months must be at least 1"),
  body("probationEndDate").optional({ checkFalsy: true }).isISO8601(),
  body("confirmationMonths")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Confirmation months must be at least 1"),
  body("confirmationDate").optional({ checkFalsy: true }).isISO8601(),
  body("relievingDate").optional({ checkFalsy: true }).isISO8601(),
  body("employmentType")
    .optional()
    .isIn(["", "Project Basic", "Outsource Base"]),
  body("projectStartDate").optional({ checkFalsy: true }).isISO8601(),
  body("projectEndDate").optional({ checkFalsy: true }).isISO8601(),
  body("enabled").optional().isBoolean(),
  body("makeAdmin").optional().isBoolean(),
];

router.get("/", getAllStaff);
router.get("/teams", getTeams);
// Must come before "/:id" (which requires a Mongo ObjectId) or "me" would
// get swallowed by that route and rejected as an invalid id.
router.get("/me", getMyStaffProfile);

router.get(
  "/:id",
  [param("id").isMongoId().withMessage("Invalid staff ID")],
  validateRequest,
  getStaffById,
);

router.post(
  "/",
  allowSuperAdminOnly,
  allowAdminOnly,
  requireTabAccess("staff.add"),
  writeOperationLimiter,
  staffBodyRules,
  validateRequest,
  createStaff,
);

router.post(
  "/import",
  allowAdminOnly,
  requireTabAccess("staff.add"),
  bulkOperationLimiter,
  [
    body()
      .isArray({ min: 1 })
      .withMessage("Request body must be a non-empty array"),
  ],
  validateRequest,
  importStaff,
);

router.put(
  "/status/:id",
  allowAdminOnly,
  requireTabAccess("staff"),
  [
    param("id").isMongoId(),
    body("isActive").isBoolean().withMessage("isActive must be true/false"),
  ],
  validateRequest,
  toggleStaffStatus,
);

router.put(
  "/:id",
  allowAdminOnly,
  requireTabAccess("staff"),
  writeOperationLimiter,
  [param("id").isMongoId().withMessage("Invalid staff ID"), ...staffBodyRules],
  validateRequest,
  updateStaff,
);

router.delete(
  "/",
  allowAdminOnly,
  requireTabAccess("staff"),
  bulkOperationLimiter,
  [
    body("ids")
      .isArray({ min: 1 })
      .withMessage("ids must be a non-empty array"),
  ],
  validateRequest,
  deleteManyStaff,
);

router.delete(
  "/:id",
  allowAdminOnly,
  requireTabAccess("staff"),
  writeOperationLimiter,
  [param("id").isMongoId().withMessage("Invalid staff ID")],
  validateRequest,
  deleteStaff,
);

export default router;