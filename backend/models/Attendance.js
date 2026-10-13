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
    // Minutes borrowed from the user's overtime bank (see
    // deductFromExtraHoursBank in services/leave.js) to promote THIS day
    // to "full" despite falling short of the shift's net requirement. Kept
    // for audit/debugging only — the actual deduction lives on the source
    // record(s)' own extraHoursInMinutes, this is just "how much, and why
    // this day is full despite a shortfall".
    bankMinutesUsed: {
      type: Number,
      default: 0,
    },
    attendanceType: {
      type: String,
      enum: ["full", "half", "short", "absent"],
    },
    isLeaveDay: {
      type: Boolean,
      default: false,
    },
    // "self" = user signed themselves in/out from the dashboard,
    // "manual" = an admin entered it by hand, "import" = bulk import.
    source: {
      type: String,
      // "auto" = signed in automatically because one of the user's devices
      // (phone app / website / PC agent) checked in from the office network.
      enum: ["self", "manual", "import", "auto"],
      default: "manual",
    },
    // ── Office presence tracking (see services/presence.js) ──────────────
    // Last time any of the user's devices checked in from the office network.
    lastSeenInOfficeAt: {
      type: Date,
    },
    // Time the user was last seen LEAVING the office network (Wi-Fi
    // disconnect, PC shutdown, or no check-in for a while). Cleared again
    // when they reconnect, so it always holds the latest disconnect only.
    // If they never reconnect, this becomes the automatic sign-out time.
    lastDisconnectAt: {
      type: Date,
    },
    // true when logoutTime was set by the system (not the Sign Out button).
    autoSignedOut: {
      type: Boolean,
      default: false,
    },
    // Why the system signed the user out: "pc_shutdown", "left_office",
    // "day_end".
    signOutReason: {
      type: String,
    },
    // Open-state values saved just before an AUTOMATIC sign-out, so the
    // record can be re-opened if the user comes back to the office the same
    // day (services/presence.js → reopenAfterAutoSignOut).
    autoSignOutSnapshot: {
      type: mongoose.Schema.Types.Mixed,
    },
    // Short audit trail of connect/disconnect events for the day (newest
    // last, capped at 60 entries).
    presenceEvents: [
      {
        _id: false,
        type: { type: String }, // connect | reconnect | reopen | disconnect | timeout | shutdown | sleep | logoff | auto_signout
        at: { type: Date },
        platform: { type: String }, // pc | android | ios | web
        deviceName: { type: String },
      },
    ],
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

// Nearly every calendar/report query (buildMonthDays, the annual view, the
// self-heal routines in leaveAutomation.js, payroll, extra-hours summaries)
// filters by { userId, loginTime: { $gte, $lte } } rather than the `date`
// string above, but there was no index covering that shape — those queries
// could only use { userId, date } as a userId-only prefix and then scan
// every one of that user's records in memory to apply the loginTime range.
// This index lets Mongo satisfy the range filter directly.
attendanceSchema.index({ userId: 1, loginTime: 1 });
// The admin attendance list / dashboard sorts every record by loginTime
// (optionally within a date window) with no userId filter — without this,
// Mongo has to sort the whole collection in memory on each request.
attendanceSchema.index({ loginTime: -1 });

const Attendance = mongoose.model("Attendance", attendanceSchema);
export default Attendance;