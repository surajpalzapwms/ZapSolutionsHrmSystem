import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { encryptPassword } from "../utils/passwordVault.js";

const staffSchema = new mongoose.Schema(
  {
    staffName: {
      type: String,
      required: true,
    },
    staffId: {
      type: String,
    },
    projectName: {
      type: String,
    },
    status: {
      type: String,
      enum: ["Internship", "Probation", "Confirmation", "Relieved"],
      default: "Probation",
    },
    contactNo: {
      type: String,
    },
    email: {
      type: String,
    },
    // Only set if a staff member also needs login access. Never returned by
    // default (select: false) — routes/controllers must never echo it back.
    password: {
      type: String,
      minlength: 6,
      select: false,
    },
    // Encrypted (reversible) copy of the password, ONLY so an admin can view
    // it in the staff History modal. Login still uses the bcrypt hash above.
    passwordEncrypted: {
      type: String,
      select: false,
    },
    date: {
      type: Date, // Joining Date
    },
    dateOfBirth: {
      type: Date,
      default: null,
    },
    // ── Printed on the Offer / Joining / Confirmation letters ─────────────
    // Gender decides the title: Male -> "Mr.", Female -> "Ms.".
    gender: {
      type: String,
      enum: ["", "Male", "Female"],
      default: "",
    },
    // Job title, e.g. "Full Stack developer & Software Engineer".
    designation: { type: String, trim: true, default: "" },
    // e.g. "CRM & app development department" / "Programming team".
    department: { type: String, trim: true, default: "" },
    // Permanent address, and current address ("" = same as permanent).
    // Printed in the letters' details box / the joining letter's "To," block.
    address: { type: String, trim: true, default: "" },
    currentAddress: { type: String, trim: true, default: "" },
    // e.g. "Full time / Mon till Saturday / 10.00 AM till 6.30 PM".
    workSchedule: { type: String, trim: true, default: "" },
    // Internship related fields (first stage: Internship -> Probation ->
    // Confirmation). Internship starts on the joining date. Probation then
    // starts the day AFTER internshipEndDate. Staff with no internshipEndDate
    // never had an internship, so their probation still counts from the
    // joining date exactly as before.
    internshipMonths: {
      type: Number,
      default: 3,
      min: 1,
    },
    internshipEndDate: {
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
    // Set when a profile photo is uploaded (models/StaffDocument.js, type
    // "photo"); used to build the photo URL. null = no photo (initials shown).
    photoUpdatedAt: {
      type: Date,
      default: null,
    },
    // HR letters (offer / joining / confirmation / termination / leaving /
    // experience) an admin or super admin has GENERATED for this staff
    // member. The mobile app only enables a letter tile once it's in here.
    issuedLetters: {
      type: [
        {
          _id: false,
          type: {
            type: String,
            enum: [
              "offer",
              "joining",
              "confirmation",
              "termination",
              "leaving",
              "experience",
            ],
            required: true,
          },
          issuedAt: { type: Date, default: Date.now },
          issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          issuedByName: { type: String, default: "" },
          // Offer / Joining / Confirmation: everything HR entered in the
          // "Generate letter" form (name, gender, designation, salary
          // table, Aadhaar, PAN, letter date…), so the PDF always shows
          // exactly those values. See utils/letterFields.js.
          details: { type: mongoose.Schema.Types.Mixed, default: undefined },
        },
      ],
      default: [],
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
// IMPORTANT: internshipEndDate / probationEndDate / confirmationDate / relievingDate are
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
  this.passwordEncrypted = encryptPassword(this.password);
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Covers Staff.findByIdAndUpdate() / findOneAndUpdate() — the "save" hook
// above does NOT run for these, so hashing has to happen here too.
staffSchema.pre("findOneAndUpdate", async function (next) {
  const update = this.getUpdate();
  if (update?.password) {
    update.passwordEncrypted = encryptPassword(update.password);
    update.password = await bcrypt.hash(update.password, 12);
  }
  next();
});

staffSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// staffId and email are unique. The partial filter ignores staff that have none.
staffSchema.index({ staffId: 1 }, { unique: true, partialFilterExpression: { staffId: { $type: "string" } } });
staffSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });

const Staff = mongoose.model("Staff", staffSchema);
export default Staff;
