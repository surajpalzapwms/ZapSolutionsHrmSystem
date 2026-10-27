// models/UserPhoto.js
//
// Profile photo of a LOGIN ACCOUNT that has no Staff record — the super
// admin (and any admin account that isn't on the staff list). Staff photos
// stay in StaffDocument (type "photo"); this is only the fallback so every
// account can add a photo from the Profile screen / website header.
//
// Keyed by the User id, not by company: the super admin belongs to no
// company and can switch between them, and should keep one photo.
import mongoose from "mongoose";
import "../utils/tenant.js";

const userPhotoSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    mimeType: { type: String, required: true },
    size: { type: Number, default: 0 },
    data: { type: Buffer, required: true, select: false },
  },
  { timestamps: true, skipTenant: true },
);

export default mongoose.model("UserPhoto", userPhotoSchema);
