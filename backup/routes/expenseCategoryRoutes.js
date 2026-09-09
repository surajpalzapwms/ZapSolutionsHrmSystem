// routes/expenseCategoryRoutes.js
import express from "express";
import { body, param } from "express-validator";
import { protect, allowAdminOnly, validateRequest } from "../middleware/auth.js";
import { writeOperationLimiter } from "../middleware/rateLimiter.js";
import {
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/expenseCategoryController.js";

const router = express.Router();

// Every route requires a valid session; writes additionally require admin.
router.use(protect);

router.get("/", getAllCategories);

router.post(
  "/",
  allowAdminOnly,
  writeOperationLimiter,
  [body("name").trim().notEmpty().withMessage("Category name is required").isLength({ max: 80 })],
  validateRequest,
  createCategory,
);

router.put(
  "/:id",
  allowAdminOnly,
  writeOperationLimiter,
  [
    param("id").isMongoId().withMessage("Invalid category ID"),
    body("name").trim().notEmpty().withMessage("Category name is required").isLength({ max: 80 }),
  ],
  validateRequest,
  updateCategory,
);

router.delete(
  "/:id",
  allowAdminOnly,
  writeOperationLimiter,
  [param("id").isMongoId().withMessage("Invalid category ID")],
  validateRequest,
  deleteCategory,
);

export default router;

// server.js:
//   import expenseCategoryRoutes from "./routes/expenseCategoryRoutes.js";
//   app.use("/api/hrm/expense-categories", expenseCategoryRoutes);
