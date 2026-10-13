import mongoose from "mongoose";

const payrollSchema = new mongoose.Schema(
  {
    payrollCode: {
      type: String,
      required: true,
      trim: true,
    },

    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
    },

    period: {
      type: String,
      required: true, // Format: YYYY-MM
    },

    basicSalary: {
      type: Number,
      required: true,
      min: 0,
    },

    adjustedBasicSalary: {
      type: Number,
      min: 0,
    },

    allowances: [
      {
        type: {
          type: String,
          required: true,
          trim: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],

    totalAllowance: {
      type: Number,
      default: 0,
      min: 0,
    },

    deductions: [
      {
        type: {
          type: String,
          required: true,
          trim: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],

    totalDeduction: {
      type: Number,
      default: 0,
      min: 0,
    },

    netSalary: {
      type: Number,
      required: true,
      min: 0,
    },

    netSalaryExact: {
      type: Number,
      min: 0,
    },

    // Advance amount deducted from this period's salary
    advanceDeduction: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Advance still owed by the staff member after this payroll's recovery
    // (e.g. 10,000 advance, 500 recovered in May → 9,500)
    advanceBalanceAfter: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Unpaid balance carried over from the previous period (partial payment)
    previousPendingAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // netSalaryExact + previousPendingAmount = total amount owed this period
    totalPayable: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Amount actually paid out on this record. Can be less than totalPayable
    // to support partial payments — the remainder becomes pendingAmount and
    // rolls into next period's previousPendingAmount automatically.
    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // totalPayable - paidAmount, carried forward to next month
    pendingAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ["pending", "partial", "paid", "cancelled"],
      default: "pending",
    },

    paymentMethod: {
      type: String,
      enum: ["bank", "cash", "cheque"],
      default: "bank",
    },

    // Single optional account the paidAmount was actually paid from
    sourceAccount: {
      accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Account",
      },
      accountName: String,
    },

    bankAccount: String,

    paymentDate: Date,

    // Every payment made against this month's salary, in order — a month
    // can be paid in several parts (e.g. 2,000 then 5,000 then 5,000).
    // paidAmount is always the sum of these. Older records saved before
    // this list existed have an empty list; the UI shows their paidAmount
    // as one "earlier payment" instead.
    payments: [
      {
        amount: { type: Number, required: true, min: 0 },
        date: { type: Date, default: Date.now },
        method: String,
        accountName: String,
        note: String,
      },
    ],

    // When the part left unpaid (pendingAmount) is expected to be paid.
    // Only meaningful while pendingAmount > 0; cleared once fully paid.
    pendingDate: Date,

    remarks: String,

    advances: [
      {
        advanceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "StaffAdvance",
        },
        amount: Number,
      },
    ],

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    enabled: {
      type: Boolean,
      default: true,
    },

    attendanceInfo: {
      totalWorkingDays: Number,
      presentDays: Number,
      totalLeaves: Number,
      paidLeaves: Number,
      unpaidLeaves: Number,
      swapLeaves: Number,
      perDaySalary: Number,
      perDaySalaryExact: Number,
      effectiveDays: Number,
      leaveDeduction: Number,
      leaveDeductionExact: Number,
      isFull: Boolean,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index: one payroll per employee per period
payrollSchema.index(
  { employeeId: 1, period: 1 },
  { unique: true }
);
payrollSchema.index({ payrollCode: 1 }, { unique: true });

// Performance indexes
payrollSchema.index({ status: 1 });
payrollSchema.index({ period: 1 });

const Payroll = mongoose.model("Payroll", payrollSchema);

export default Payroll;