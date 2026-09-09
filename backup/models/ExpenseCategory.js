import mongoose from "mongoose";

const expenseCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

expenseCategorySchema.index({ name: 1 }, { unique: true });

// Categories the app should always offer out of the box. Seeded once, the
// first time anything touches this collection, so a brand-new install
// doesn't start with an empty dropdown — admins can still rename/delete
// them afterwards like any other category.
const DEFAULT_CATEGORY_NAMES = [
  "Office Expense",
  "Tea",
  "Light Bill",
  "Hardware Repairing",
];

expenseCategorySchema.statics.ensureDefaults = async function () {
  const count = await this.countDocuments();
  if (count > 0) return;
  await this.insertMany(
    DEFAULT_CATEGORY_NAMES.map((name) => ({ name, isDefault: true }))
  );
};

const ExpenseCategory = mongoose.model("ExpenseCategory", expenseCategorySchema);
export default ExpenseCategory;
