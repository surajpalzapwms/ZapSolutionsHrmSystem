import mongoose from "mongoose";

const staffAdvanceSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
    },
    employeeName: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    sourceAccount: {
      accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Account",
      },
      accountName: String,
    },
    date: {
      type: Date,
      required: true,
    },
    reason: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "repaid"],
      default: "pending",
    },
    repaidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    remarks: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const StaffAdvance = mongoose.model("StaffAdvance", staffAdvanceSchema);
export default StaffAdvance;
