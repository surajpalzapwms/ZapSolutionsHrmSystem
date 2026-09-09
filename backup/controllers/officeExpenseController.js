// controllers/officeExpenseController.js
import mongoose from "mongoose";
import OfficeExpense from "../models/OfficeExpense.js";
import ExpenseCategory from "../models/ExpenseCategory.js";
import { asyncHandler, ApiError } from "../utils/asyncHandler.js";

const assertValidId = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid expense ID");
  }
};

const resolveCategory = async (categoryId) => {
  if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
    throw new ApiError(400, "A valid category is required");
  }
  const category = await ExpenseCategory.findById(categoryId);
  if (!category) throw new ApiError(404, "Category not found");
  return category;
};

/** GET /api/hrm/office-expenses — list all (optional ?category=, ?startDate=, ?endDate=) */
export const getAllOfficeExpenses = asyncHandler(async (req, res) => {
  const { category, startDate, endDate } = req.query;
  const filter = {};
  if (category && mongoose.Types.ObjectId.isValid(category)) filter.category = category;
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate) filter.date.$lte = new Date(endDate);
  }

  const expenses = await OfficeExpense.find(filter).sort({ date: -1, createdAt: -1 }).lean();
  res.json({ success: true, count: expenses.length, data: expenses });
});

/** GET /api/hrm/office-expenses/:id — single expense */
export const getOfficeExpenseById = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const expense = await OfficeExpense.findById(req.params.id).lean();
  if (!expense) throw new ApiError(404, "Expense not found");
  res.json({ success: true, data: expense });
});

/** POST /api/hrm/office-expenses — create an expense */
export const createOfficeExpense = asyncHandler(async (req, res) => {
  const { category, amount, date, note, remarks } = req.body;

  const categoryDoc = await resolveCategory(category);

  if (amount === undefined || Number(amount) <= 0) {
    throw new ApiError(400, "A positive amount is required");
  }
  if (!date) {
    throw new ApiError(400, "date is required");
  }

  const expense = await OfficeExpense.create({
    category: categoryDoc._id,
    categoryName: categoryDoc.name,
    amount: Number(amount),
    date: new Date(date),
    note: note?.trim() || "",
    remarks: remarks?.trim() || "",
    createdBy: req.user?._id,
  });

  res.status(201).json({ success: true, message: "Expense added successfully", data: expense });
});

/** PUT /api/hrm/office-expenses/:id — update an expense */
export const updateOfficeExpense = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const { category, amount, date, note, remarks } = req.body;

  const update = {};
  if (category !== undefined) {
    const categoryDoc = await resolveCategory(category);
    update.category = categoryDoc._id;
    update.categoryName = categoryDoc.name;
  }
  if (amount !== undefined) {
    if (Number(amount) <= 0) throw new ApiError(400, "amount must be a positive number");
    update.amount = Number(amount);
  }
  if (date !== undefined) update.date = new Date(date);
  if (note !== undefined) update.note = note.trim();
  if (remarks !== undefined) update.remarks = remarks.trim();

  const updated = await OfficeExpense.findByIdAndUpdate(req.params.id, update, {
    new: true,
    runValidators: true,
    context: "query",
  });
  if (!updated) throw new ApiError(404, "Expense not found");

  res.json({ success: true, message: "Expense updated successfully", data: updated });
});

/** DELETE /api/hrm/office-expenses/:id — remove an expense */
export const deleteOfficeExpense = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const expense = await OfficeExpense.findById(req.params.id);
  if (!expense) throw new ApiError(404, "Expense not found");
  await expense.deleteOne();
  res.json({ success: true, message: "Expense deleted successfully" });
});

/** DELETE /api/hrm/office-expenses — bulk delete { ids: [...] } */
export const deleteManyOfficeExpenses = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, "ids must be a non-empty array");
  }
  const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  const result = await OfficeExpense.deleteMany({ _id: { $in: validIds } });
  res.json({
    success: true,
    message: `${result.deletedCount} expense(s) deleted successfully`,
    deletedCount: result.deletedCount,
  });
});

/** GET /api/hrm/office-expenses/summary — totals grouped by category (optional ?startDate=, ?endDate=) */
export const getOfficeExpenseSummary = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const match = {};
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }

  const summary = await OfficeExpense.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$categoryName",
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
  ]);

  const totalExpenses = summary.reduce((sum, s) => sum + s.total, 0);

  res.json({ success: true, data: summary, total: totalExpenses });
});
