import mongoose from "mongoose";
import "../utils/tenant.js"; // registers the per-company plugin first

// A branch (office / location) of ONE company. The tenant plugin adds the
// `company` field, so a company can never see another company's branches,
// and the unique indexes below become unique PER COMPANY automatically.
//
// A branch can have exactly ONE branch admin (see services/adminRules.js).
const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Branch name is required"], trim: true, maxlength: 80 },
    // Optional short code, e.g. "MUM", "RYD-01".
    code: { type: String, trim: true, uppercase: true, maxlength: 20 },
    address: { type: String, trim: true, maxlength: 300 },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    phone: { type: String, trim: true, maxlength: 40 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// Case-insensitive: "Mumbai" and "mumbai" are the same branch name.
branchSchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
// Only branches that actually have a code take part in the code uniqueness.
branchSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: "string" } } });

export default mongoose.model("Branch", branchSchema);
