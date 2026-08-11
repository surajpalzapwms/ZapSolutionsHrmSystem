import mongoose from "mongoose";

const officeExpenseSchema = new mongoose.Schema(
  {
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseCategory",
      required: true,
    },
    // Denormalized so the list/report still reads correctly even if the
    // category is later renamed or deleted.
    categoryName: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    date: {
      type: Date,
      required: true,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    remarks: {
      type: String,
      trim: true,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

officeExpenseSchema.index({ date: -1 });
officeExpenseSchema.index({ category: 1 });

const OfficeExpense = mongoose.model("OfficeExpense", officeExpenseSchema);
export default OfficeExpense;
