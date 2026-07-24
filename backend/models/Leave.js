import mongoose from "mongoose";

const leaveSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
    },
    leaveDate: {
      type: Date,
      required: true,
    },
    // Ties together every day of a multi-day ("range") leave request so the
    // admin can approve/reject/view them as a single unit, while each day
    // still keeps its own Leave document (same pattern every other part of
    // this schema already relies on — one doc per calendar day). Null for
    // ordinary single-day requests.
    requestGroupId: {
      type: String,
      default: null,
      index: true,
    },
    reason: {
      type: String,
      required: true,
    },
    leaveType: {
      type: String,
      enum: ["paid", "unpaid", "swapleave"],
      default: "unpaid",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: {
      type: Date,
    },
    extraHoursSources: [
      {
        attendanceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Attendance",
          required: true,
        },
        deductedMinutes: {
          type: Number,
          required: true,
        },
      },
    ],
  },
  {
    timestamps: true,
  },
);

leaveSchema.index({ userId: 1, leaveDate: 1 });
leaveSchema.index({ leaveDate: 1 });

export default mongoose.model("Leave", leaveSchema);
