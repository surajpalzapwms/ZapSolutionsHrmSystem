// controllers/expenseCategoryController.js
import mongoose from "mongoose";
import ExpenseCategory from "../models/ExpenseCategory.js";
import OfficeExpense from "../models/OfficeExpense.js";
import { asyncHandler, ApiError } from "../utils/asyncHandler.js";

const assertValidId = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid category ID");
  }
};

/** GET /api/hrm/expense-categories — list all categories (seeds defaults on first use) */
export const getAllCategories = asyncHandler(async (req, res) => {
  await ExpenseCategory.ensureDefaults();
  const categories = await ExpenseCategory.find().sort({ name: 1 }).lean();
  res.json({ success: true, count: categories.length, data: categories });
});

/** POST /api/hrm/expense-categories — add a category */
export const createCategory = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    throw new ApiError(400, "Category name is required");
  }

  const trimmed = name.trim();
  const existing = await ExpenseCategory.findOne({
    name: { $regex: `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
  });
  if (existing) {
    throw new ApiError(409, "A category with this name already exists");
  }

  const category = await ExpenseCategory.create({ name: trimmed });
  res.status(201).json({ success: true, message: "Category added successfully", data: category });
});

/** PUT /api/hrm/expense-categories/:id — rename a category */
export const updateCategory = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const { name } = req.body;
  if (!name || !name.trim()) {
    throw new ApiError(400, "Category name is required");
  }
  const trimmed = name.trim();

  const duplicate = await ExpenseCategory.findOne({
    _id: { $ne: req.params.id },
    name: { $regex: `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
  });
  if (duplicate) {
    throw new ApiError(409, "A category with this name already exists");
  }

  const category = await ExpenseCategory.findByIdAndUpdate(
    req.params.id,
    { name: trimmed },
    { new: true, runValidators: true }
  );
  if (!category) throw new ApiError(404, "Category not found");

  // Keep the denormalized categoryName on existing expenses in sync so
  // reports/lists don't show the old name after a rename.
  await OfficeExpense.updateMany(
    { category: category._id },
    { categoryName: category.name }
  );

  res.json({ success: true, message: "Category updated successfully", data: category });
});

/** DELETE /api/hrm/expense-categories/:id — remove a category */
export const deleteCategory = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const category = await ExpenseCategory.findById(req.params.id);
  if (!category) throw new ApiError(404, "Category not found");

  const inUse = await OfficeExpense.countDocuments({ category: category._id });
  if (inUse > 0) {
    throw new ApiError(
      400,
      `Cannot delete "${category.name}" — it is used by ${inUse} expense(s). Reassign or delete those expenses first.`
    );
  }

  await category.deleteOne();
  res.json({ success: true, message: "Category deleted successfully" });
});
