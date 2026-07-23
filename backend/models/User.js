import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
    },
    name: {
      type: String,
      trim: true,
    },
    contactNumber: {
      type: String,
      required: [true, "Contact number is required"],
      trim: true,
      match: [/^[0-9+\-\s]{7,15}$/, "Please enter a valid contact number"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false,
    },
    role: {
      type: String,
      enum: ["admin", "user"],
      default: "user",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    // Per-user shift window, "HH:mm" 24-hour format. Defaults to the
    // general office timing (10:00 AM – 6:30 PM). Staff who come in early
    // (e.g. 9:00 AM – 5:30 PM) can have these overridden by an admin. Both
    // shifts span 8.5 hours, so after the 45-minute lunch break is
    // subtracted, either shift requires the same 7h 45m of net working time.
    shiftStartTime: {
      type: String,
      default: "10:00",
    },
    shiftEndTime: {
      type: String,
      default: "18:30",
    },
  },
  {
    timestamps: true,
  },
);

// Keep `name` in sync with firstName + lastName for any code that still reads it
userSchema.pre("validate", function (next) {
  if (this.firstName || this.lastName) {
    this.name = `${this.firstName || ""} ${this.lastName || ""}`.trim();
  }
  next();
});

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  console.log("value of candidatePassword", candidatePassword);
  console.log("value sof this.password", this.password);
  console.log(
    "values of 77",
    await bcrypt.compare(candidatePassword, this.password),
  );
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate JWT token
userSchema.methods.generateToken = function () {
  return jwt.sign({ id: this._id, role: this.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });
};

const User = mongoose.model("User", userSchema);
export default User;
