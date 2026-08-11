import mongoose from "mongoose";

const salaryHistorySchema = new mongoose.Schema(
  {
    basicSalary: {
      type: Number,
      required: true,
      min: 0,
    },
    effectiveFrom: {
      type: Date,
      required: true,
    },
    remarks: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const staffBasicPayrollSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
      unique: true,
    },
    employeeName: {
      type: String,
    },
    currentBasicSalary: {
      type: Number,
      required: true,
      min: 0,
    },
    currentEffectiveFrom: {
      type: Date,
      default: Date.now,
    },
    remarks: {
      type: String,
      trim: true,
      default: "",
    },
    salaryHistory: {
      type: [salaryHistorySchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

const StaffBasicPayroll = mongoose.model("StaffBasicPayroll", staffBasicPayrollSchema);
export default StaffBasicPayroll;