import mongoose from "mongoose";
import "../utils/tenant.js"; // registers the per-company plugin first

const accountSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    code: {
      type: String,
    },
    totalAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    balance: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

accountSchema.index({ code: 1 }, { unique: true, sparse: true });

const Account = mongoose.model("Account", accountSchema);
export default Account;