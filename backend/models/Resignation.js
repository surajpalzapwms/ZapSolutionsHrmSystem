import mongoose from "mongoose";
import "../utils/tenant.js"; // registers the per-company plugin first

const resignationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true },
    lastWorkingDay: { type: Date, required: true },
    reason: { type: String, required: true },
    noticePeriodDays: { type: Number, default: 60 },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "withdrawn"],
      default: "pending",
    },
  },
  { timestamps: true },
);

export default mongoose.model("Resignation", resignationSchema);