import mongoose from "mongoose";

const accountSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    code: {
      type: String,
      unique: true,
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

const Account = mongoose.model("Account", accountSchema);
export default Account;