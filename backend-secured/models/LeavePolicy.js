import mongoose from "mongoose";

// A single, org-wide leave policy the admin configures from the Leave tab.
// Stores how many days of each balance-tracked leave type every staff member
// is entitled to per calendar year.
//
//   paidPerYear   – paid leave. UNUSED days carry forward into the next year.
//   sickPerYear   – sick leave. Does NOT carry forward (resets each year).
//   casualPerYear – casual leave. Does NOT carry forward (resets each year).
//
// This is a singleton: there is only ever one policy document. Use
// LeavePolicy.getSingleton() to read (or lazily create) it.
const leavePolicySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "global",
      unique: true,
    },
    paidPerYear: {
      type: Number,
      default: 12,
      min: 0,
    },
    sickPerYear: {
      type: Number,
      default: 6,
      min: 0,
    },
    casualPerYear: {
      type: Number,
      default: 6,
      min: 0,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

// Read the one-and-only policy, creating it with defaults on first access so
// callers never have to null-check.
leavePolicySchema.statics.getSingleton = async function () {
  let policy = await this.findOne({ key: "global" });
  if (!policy) {
    policy = await this.create({ key: "global" });
  }
  return policy;
};

export default mongoose.model("LeavePolicy", leavePolicySchema);
