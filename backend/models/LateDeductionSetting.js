// models/LateDeductionSetting.js
//
// Month-wise switch (super admin only) that decides whether LATE COMING is
// deducted from one staff member's salary for one month.
//
// One document = one (staff, "YYYY-MM") pair. No document means the default:
// late coming IS deducted. Individual dates can additionally be waived on
// the attendance calendar — that flag lives on the Attendance record itself
// (Attendance.lateDeductionWaived), see services/lateDeduction.js.
import mongoose from "mongoose";

const lateDeductionSettingSchema = new mongoose.Schema(
  {
    // Staff._id (same id Payroll.employeeId uses), not the login User id.
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
    },
    // "YYYY-MM"
    period: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}$/,
    },
    // true  = deduct late-coming minutes from this month's salary (default)
    // false = super admin chose NOT to deduct anything for this month
    deductLate: {
      type: Boolean,
      default: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

lateDeductionSettingSchema.index({ employeeId: 1, period: 1 }, { unique: true });

const LateDeductionSetting = mongoose.model(
  "LateDeductionSetting",
  lateDeductionSettingSchema,
);
export default LateDeductionSetting;
