import mongoose from "mongoose";

const expenseSchema = new mongoose.Schema(
  {
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseCategory",
      required: true,
    },
    categoryType: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    finalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    exchangeLoss: {
      type: Number,
      default: 0,
    },
    description: {
      type: String,
      required: true,
    },
    remarks: {
      type: String,
    },
    date: {
      type: Date,
      required: true,
    },
    reference: {
      type: String,
    },
    payrollCode: {
      type: String,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
    },
    payrollId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payroll",
    },
    period: {
      type: String,
    },
    transactionType: {
      type: String,
      enum: ["payment outward", "payment inward"],
      default: "payment outward",
    },
    accountType: {
      type: String,
      default: "Company Account",
    },
    importStatus: {
      type: String,
      enum: ["imported", "pending", "failed"],
      default: "imported",
    },
    importErrors: [String],
    invoiceNo: {
      type: String,
      default: "NA",
    },
    isConversionLoss: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    sourceAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
    },
    isPayroll: {
      type: Boolean,
      default: false,
    },
    sources: [
      {
        accountId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Account",
        },
        accountName: String,
        amount: Number,
        finalAmount: Number,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Indexes
expenseSchema.index({ payrollId: 1 });
expenseSchema.index({ payrollCode: 1 });
expenseSchema.index({ employeeId: 1 });
expenseSchema.index({ date: 1 });
expenseSchema.index({ isPayroll: 1 });

const Expense = mongoose.model("Expense", expenseSchema);
export default Expense;