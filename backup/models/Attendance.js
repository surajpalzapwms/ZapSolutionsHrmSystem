import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // "YYYY-MM-DD" (IST) — lets us find "today's record for this user" with a
    // simple equality lookup instead of scanning a wide date range.
    date: {
      type: String,
    },
    loginTime: {
      type: Date,
      required: true,
    },
    logoutTime: {
      type: Date,
    },
    // "HH:MM:00" — total minutes actually counted as working time, i.e.
    // already clamped to the 08:00–19:00 working window.
    totalTime: {
      type: String,
    },
    workingHoursPerDay: {
      type: Number,
      default: 8,
    },
    // Running total of worked minutes for the day, across every
    // sign-in/sign-out session (see checkIn/checkOut in controllers/leave.js).
    // A fresh sign-in within 2 hours of worked time reopens the same record
    // and keeps adding to this instead of starting a new day's record.
    sessionMinutes: {
      type: Number,
      default: 0,
    },
    extraHours: {
      type: String,
    },
    extraHoursInMinutes: {
      type: Number,
      default: 0,
    },
    attendanceType: {
      type: String,
      enum: ["full", "half", "short"],
    },
    isLeaveDay: {
      type: Boolean,
      default: false,
    },
    // "self" = user signed themselves in/out from the dashboard,
    // "manual" = an admin entered it by hand, "import" = bulk import.
    source: {
      type: String,
      enum: ["self", "manual", "import"],
      default: "manual",
    },
    remarks: {
      type: String,
    },
    status: {
      type: String,
      enum: ["present", "absent", "late"],
      default: "present",
    },
    // Admin can grant a specific user permission to sign out for the day
    // before the required 7h45m of working time is complete. When true, the
    // sign-out button unlocks immediately regardless of time worked.
    earlySignOutApproved: {
      type: Boolean,
      default: false,
    },
    earlySignOutApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    earlySignOutApprovedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// One attendance record per user per day.
attendanceSchema.index({ userId: 1, date: 1 }, { unique: true, sparse: true });

const Attendance = mongoose.model("Attendance", attendanceSchema);
export default Attendance;
