// models/BirthdayWish.js — one "Happy Birthday" wish from one colleague to
// a staff member on their birthday. A person can wish someone once a year.
import mongoose from "mongoose";

const birthdayWishSchema = new mongoose.Schema(
  {
    // Birthday person
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true },
    year: { type: Number, required: true },
    // Who wished
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    fromStaff: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", default: null },
    fromName: { type: String, trim: true, default: "" },
    message: { type: String, trim: true, maxlength: 300, default: "" },
  },
  { timestamps: true },
);

birthdayWishSchema.index({ staff: 1, year: 1, fromUser: 1 }, { unique: true });

export default mongoose.model("BirthdayWish", birthdayWishSchema);
