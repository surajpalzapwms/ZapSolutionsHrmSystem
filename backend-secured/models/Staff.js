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
      enum: ["Trial", "Confirmed"],
      default: "Trial",
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
      type: Date,
    },
    // Last working day, if this staff member has left / is leaving the
    // organization. When set, payroll for the month it falls in is prorated
    // to only pay through this date instead of the full month.
    relievingDate: {
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

// Covers Staff.create() / doc.save() — hashes only when the plaintext
// password was actually set/changed on this call.
staffSchema.pre("save", async function (next) {
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
