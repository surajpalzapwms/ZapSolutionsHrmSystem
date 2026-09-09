import mongoose from "mongoose";

const counselingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true },
    topic: { type: String, required: true },
    counselor: { type: String, default: "" },
    date: { type: Date, required: true },
    time: { type: String, default: "" },
    mode: { type: String, enum: ["video", "in-person", "phone"], default: "video" },
    status: { type: String, enum: ["requested", "scheduled", "completed", "cancelled"], default: "requested" },
    outcome: { type: String, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model("Counseling", counselingSchema);