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
