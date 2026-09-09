import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const staffSchema = new mongoose.Schema(
  {
    staffName: {
      type: String,
      required: true,
    },
    staffId: {
      type: String,
      unique: true,
      sparse: true,
    },
    projectName: {
      type: String,
    },
    status: {
      type: String,
      enum: ["Probation", "Confirmation", "Relieving"],
      default: "Probation",
    },
    contactNo: {
      type: String,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
    },
    // Only set if a staff member also needs login access. Never returned by
    // default (select: false) — routes/controllers must never echo it back.
    password: {
      type: String,
      minlength: 6,
      select: false,
    },
    date: {
      type: Date, // Joining Date
    },
    dateOfBirth: {
      type: Date,
      default: null,
    },
    // Probation related fields
    probationMonths: {
      type: Number,
      default: 3,
      min: 1,
    },
    probationEndDate: {
      type: Date,
      default: null,
    },
    // Confirmation related fields
    confirmationMonths: {
      type: Number,
      default: 3,
      min: 1,
    },
    confirmationDate: {
      type: Date,
      default: null,
    },
    // Relieving date
    relievingDate: {
      type: Date,
      default: null,
    },
    // Employment type fields
    employmentType: {
      type: String,
      enum: ["", "Project Basic", "Outsource Base"],
      default: "",
    },
    projectStartDate: {
      type: Date,
      default: null,
    },
    projectEndDate: {
      type: Date,
      default: null,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

// Employment-type dates (projectStartDate/projectEndDate) only make sense
// when an employmentType is actually chosen — that part stays a hard
// exclusivity rule at the model level. This is a safety net — the
// controller already enforces the same rule on create/update — so any
// other code path that calls `Staff.create()` / `doc.save()` directly
// (e.g. a future script) can't leave stale dates behind either. Note: this
// does NOT run on `insertMany()` (see importStaff, which applies the same
// rule inline).
//
// IMPORTANT: probationEndDate / confirmationDate / relievingDate are
// intentionally NOT nulled out when `status` changes. Those three dates
// together form the staff member's lifecycle history (probation end,
// confirmation start, leaving date) and the "View" details panel shows all
// of them at once regardless of the current status — wiping the earlier
// ones on every status change would make that view permanently blank for
// anyone who has already moved past Probation.
function enforceStatusEmploymentExclusivity(doc) {
  if (!doc.employmentType) {
    doc.projectStartDate = null;
    doc.projectEndDate = null;
  }
}

// Covers Staff.create() / doc.save() — hashes only when the plaintext
// password was actually set/changed on this call.
staffSchema.pre("save", async function (next) {
  enforceStatusEmploymentExclusivity(this);
  if (!this.isModified("password") || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Covers Staff.findByIdAndUpdate() / findOneAndUpdate() — the "save" hook
// above does NOT run for these, so hashing has to happen here too.
staffSchema.pre("findOneAndUpdate", async function (next) {
  const update = this.getUpdate();
  if (update?.password) {
    update.password = await bcrypt.hash(update.password, 12);
  }
  next();
});

staffSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

const Staff = mongoose.model("Staff", staffSchema);
export default Staff;
