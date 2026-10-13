import mongoose from "mongoose";

// A single, org-wide leave policy the admin configures from the Leave tab.
// Stores how many days of each balance-tracked leave type every staff member
// is entitled to per calendar year. Accrual is monthly: perYear / 12 is
// credited for every completed month after the confirmation date
// (16.5 / 3.5 / 3.5  =>  1.375 paid, ~0.29 sick, ~0.29 casual per month).
//
//   paidPerYear   – paid leave. UNUSED days carry forward into the next year.
//                   May round up to the next whole day (16.5 -> 17) by
//                   borrowing the fraction from the Sick + Casual pool.
//   sickPerYear   – sick leave. Does NOT carry forward (resets each year).
//   casualPerYear – casual leave. Does NOT carry forward (resets each year).
//                   Sick + Casual share one pool (3.5 + 3.5 = 7), e.g.
//                   3 sick + 4 casual. See applySharedPool in
//                   services/leaveBalance.js.
//
// This is a singleton: there is only ever one policy document. Use
// LeavePolicy.getSingleton() to read (or lazily create) it.
const leavePolicySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "global",
    },
    paidPerYear: {
      type: Number,
      default: 18, // 1.375 per month
      min: 0,
    },
    sickPerYear: {
      type: Number,
      default: 6, // shared pool with casual
      min: 0,
    },
    casualPerYear: {
      type: Number,
      default: 6, // shared pool with sick
      min: 0,
    },
    // Max PAID days that may be recorded in the staff member's CONFIRMATION
    // year, even if they have not earned that much yet (advance leave).
    // Whatever is used beyond what was really earned that year becomes a
    // debt that is deducted from the next year's monthly accrual — until it
    // is paid back, new leave falls to Unpaid.
    advancePaidLimit: {
      type: Number,
      default: 15,
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

leavePolicySchema.index({ key: 1 }, { unique: true });

export default mongoose.model("LeavePolicy", leavePolicySchema);