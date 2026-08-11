import mongoose from "mongoose";
import Attendance from "../models/Attendance.js";
import Leave from "../models/Leave.js";
import Holiday from "../models/holiday.js";
import SaturdayHolidayRule from "../models/saturdayHolidayRule.js";
import Staff from "../models/Staff.js";
import User from "../models/User.js";

const SATURDAY_ORDINAL = {
  1: "1st Saturday",
  2: "2nd Saturday",
  3: "3rd Saturday",
  4: "4th Saturday",
  5: "5th Saturday",
};

// ─── Small pure helpers ───────────────────────────────────────────────────────
export const toTitleCase = (str) => {
  if (!str) return "";
  return str
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

export const formatDateForLog = (date) => {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
};

export const formatMinutesToTimeString = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
};

export const getAttendanceType = (totalMinutesWorked) => {
  if (totalMinutesWorked >= 7 * 60)
    return { type: "full", expectedMinutes: 8 * 60 };
  if (totalMinutesWorked >= 4 * 60)
    return { type: "half", expectedMinutes: 4 * 60 };
  return { type: "short", expectedMinutes: 8 * 60 };
};

// ─── "YYYY-MM-DD" → { year, month (1-12), day } ────────────────────────────
const parseDateString = (str) => {
  const [year, month, day] = str.split("-").map(Number);
  return { year, month, day };
};

// ─── Standard UTC day range (used for leave queries & holiday checks) ─────────
export const getDayRange = (dateInput) => {
  let y, mo, d;
  if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    ({ year: y, month: mo, day: d } = parseDateString(dateInput));
    mo -= 1;
  } else {
    const dt = new Date(dateInput);
    y = dt.getUTCFullYear();
    mo = dt.getUTCMonth();
    d = dt.getUTCDate();
  }
  return {
    start: new Date(Date.UTC(y, mo, d, 0, 0, 0, 0)),
    end: new Date(Date.UTC(y, mo, d, 23, 59, 59, 999)),
  };
};

// ─── Wide UTC range: day-1 00:00 → day+1 23:59 ───────────────────────────────
const getWideDayRange = (dateStr) => {
  const { year, month, day } = parseDateString(dateStr);
  return {
    start: new Date(Date.UTC(year, month - 1, day - 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month - 1, day + 1, 23, 59, 59, 999)),
  };
};

// ─── Wide range derived from a stored Date object ────────────────────────────
export const getLeaveRangeFromDate = (dateObj) => {
  const d = new Date(dateObj);
  return {
    start: new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() - 1,
        0,
        0,
        0,
        0,
      ),
    ),
    end: new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() + 1,
        23,
        59,
        59,
        999,
      ),
    ),
  };
};

export const isHolidayOrSunday = async (date) => {
  const checkDate = new Date(date);
  // Use the IST calendar day-of-week, not the server's local/UTC day —
  // Node servers almost always run in UTC, so a plain getDay()/getUTCDay()
  // check is wrong for roughly 5.5 hours around every IST midnight (e.g. it
  // would treat early Monday-IST hours as still Sunday and block sign-in).
  const istDate = toIST(checkDate);
  if (istDate.getUTCDay() === 0) return { isHoliday: true, reason: "Sunday" };
  const s = new Date(checkDate);
  s.setUTCHours(0, 0, 0, 0);
  const e = new Date(checkDate);
  e.setUTCHours(23, 59, 59, 999);
  const holiday = await Holiday.findOne({
    $or: [{ date: { $gte: s, $lte: e } }, { startDate: { $gte: s, $lte: e } }],
  });
  if (holiday) return { isHoliday: true, reason: holiday.name };

  if (istDate.getUTCDay() === 6) {
    const { isHoliday: isSaturdayHoliday, occurrence } =
      await SaturdayHolidayRule.isSaturdayHoliday(checkDate);
    if (isSaturdayHoliday) {
      return {
        isHoliday: true,
        reason: SATURDAY_ORDINAL[occurrence] || "Saturday holiday",
      };
    }
  }

  return { isHoliday: false, reason: null };
};

export const enforceExtraHoursConsistency = async (userId, session = null) => {
  try {
    const records = await Attendance.find({
      userId,
      isLeaveDay: { $ne: true },
    }).session(session);
    let totalExtraMinutes = 0;
    records.forEach((rec) => {
      const expected = rec.attendanceType === "half" ? 4 * 60 : 8 * 60;
      const worked = rec.totalTime
        ? (() => {
            const [h, m] = rec.totalTime.split(":").map(Number);
            return h * 60 + m;
          })()
        : 0;
      totalExtraMinutes += Math.max(0, worked - expected);
    });
    const swapLeaves = await Leave.find({
      userId,
      leaveType: "swapleave",
      status: "approved",
    })
      .sort({ leaveDate: 1 })
      .session(session);
    const maxAllowed = Math.floor(totalExtraMinutes / 480);
    if (swapLeaves.length > maxAllowed) {
      const toDelete = swapLeaves.slice(-(swapLeaves.length - maxAllowed));
      await Leave.deleteMany({
        _id: { $in: toDelete.map((l) => l._id) },
      }).session(session);
    }
  } catch (err) {
    console.error("Error enforcing extra hours consistency:", err);
  }
};

export const calculateExtraHoursSummary = async (userId) => {
  try {
    const records = await Attendance.find({
      userId,
      logoutTime: { $exists: true },
      isLeaveDay: { $ne: true },
    }).sort({ loginTime: -1 });
    let totalExtraMinutes = 0,
      totalWorkedMinutes = 0;
    const recordsWithExtra = [];
    records.forEach((rec) => {
      if (!rec.loginTime || !rec.logoutTime) return;
      const minutesWorked = Math.floor(
        (new Date(rec.logoutTime) - new Date(rec.loginTime)) / 60000,
      );
      totalWorkedMinutes += minutesWorked;
      const { expectedMinutes } = getAttendanceType(minutesWorked);
      const extra = Math.max(0, minutesWorked - expectedMinutes);
      if (extra > 0) {
        totalExtraMinutes += extra;
        recordsWithExtra.push({
          id: rec._id,
          date: rec.loginTime,
          extraHours: formatMinutesToTimeString(extra),
          extraHoursInMinutes: extra,
          totalTime: rec.totalTime,
          workedHours: minutesWorked / 60,
          attendanceType: rec.attendanceType,
        });
      }
    });
    return {
      userId,
      totalExtraHours: parseFloat((totalExtraMinutes / 60).toFixed(2)),
      totalExtraMinutes,
      leaveDaysAvailable: Math.floor(totalExtraMinutes / 480),
      remainingMinutes: totalExtraMinutes % 480,
      totalWorkedMinutes,
      totalWorkedHours: parseFloat((totalWorkedMinutes / 60).toFixed(2)),
      recordsWithExtraHours: recordsWithExtra,
      totalRecords: recordsWithExtra.length,
    };
  } catch (error) {
    console.error("Error calculating extra hours:", error);
    return {
      userId,
      totalExtraHours: 0,
      totalExtraMinutes: 0,
      leaveDaysAvailable: 0,
      remainingMinutes: 0,
      totalWorkedMinutes: 0,
      totalWorkedHours: 0,
      recordsWithExtraHours: [],
      totalRecords: 0,
    };
  }
};

export const calculateMonthlyExtraHoursSummary = async (
  userId,
  year,
  month,
) => {
  try {
    const startDate = new Date(Date.UTC(year, month, 1));
    const endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
    const records = await Attendance.find({
      userId,
      logoutTime: { $exists: true },
      isLeaveDay: { $ne: true },
      loginTime: { $gte: startDate, $lte: endDate },
    }).sort({ loginTime: -1 });
    let monthlyExtraMinutes = 0,
      monthlyWorkedMinutes = 0;
    const monthlyRecordsWithExtra = [];
    records.forEach((rec) => {
      if (!rec.loginTime || !rec.logoutTime) return;
      const minutesWorked = Math.floor(
        (new Date(rec.logoutTime) - new Date(rec.loginTime)) / 60000,
      );
      monthlyWorkedMinutes += minutesWorked;
      const { expectedMinutes } = getAttendanceType(minutesWorked);
      const extra = Math.max(0, minutesWorked - expectedMinutes);
      if (extra > 0) {
        monthlyExtraMinutes += extra;
        monthlyRecordsWithExtra.push({
          id: rec._id,
          date: rec.loginTime,
          extraHours: formatMinutesToTimeString(extra),
          extraHoursInMinutes: extra,
          totalTime: rec.totalTime,
          workedHours: minutesWorked / 60,
          attendanceType: rec.attendanceType,
        });
      }
    });
    return {
      userId,
      monthlyExtraHours: parseFloat((monthlyExtraMinutes / 60).toFixed(2)),
      monthlyExtraMinutes,
      monthlyLeaveDaysAvailable: Math.floor(monthlyExtraMinutes / 480),
      monthlyRemainingMinutes: monthlyExtraMinutes % 480,
      monthlyWorkedMinutes,
      monthlyWorkedHours: parseFloat((monthlyWorkedMinutes / 60).toFixed(2)),
      monthlyRecordsWithExtraHours: monthlyRecordsWithExtra,
      monthlyTotalRecords: monthlyRecordsWithExtra.length,
    };
  } catch (error) {
    console.error("Error calculating monthly extra hours:", error);
    return {
      userId,
      monthlyExtraHours: 0,
      monthlyExtraMinutes: 0,
      monthlyLeaveDaysAvailable: 0,
      monthlyRemainingMinutes: 0,
      monthlyWorkedMinutes: 0,
      monthlyWorkedHours: 0,
      monthlyRecordsWithExtraHours: [],
      monthlyTotalRecords: 0,
    };
  }
};

// ─── Timezone-safe attendance lookup ─────────────────────────────────────────
export const findExistingAttendance = async (
  userId,
  dateInput,
  session = null,
) => {
  let dateStr;
  if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    dateStr = dateInput;
  } else {
    const d = new Date(dateInput);
    dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const { year, month, day } = parseDateString(dateStr);
  const { start, end } = getWideDayRange(dateStr);

  const applySession = (q) => (session ? q.session(session) : q);
  const candidates = await applySession(
    Attendance.find({ userId, loginTime: { $gte: start, $lte: end } }),
  );

  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

  for (const rec of candidates) {
    const login = new Date(rec.loginTime);

    if (
      login.getUTCFullYear() === year &&
      login.getUTCMonth() + 1 === month &&
      login.getUTCDate() === day
    )
      return rec;

    const ist = new Date(login.getTime() + IST_OFFSET_MS);
    if (
      ist.getUTCFullYear() === year &&
      ist.getUTCMonth() + 1 === month &&
      ist.getUTCDate() === day
    )
      return rec;

    if (
      login.getFullYear() === year &&
      login.getMonth() + 1 === month &&
      login.getDate() === day
    )
      return rec;
  }

  return null;
};

// ─── Timezone-safe leave lookup by date string ────────────────────────────────
export const findExistingLeave = async (userId, dateStr, session = null) => {
  const { year, month, day } = parseDateString(dateStr);
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

  const start = new Date(Date.UTC(year, month - 1, day - 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day + 1, 23, 59, 59, 999));

  const applySession = (q) => (session ? q.session(session) : q);
  const candidates = await applySession(
    Leave.find({ userId, leaveDate: { $gte: start, $lte: end } }),
  );

  for (const rec of candidates) {
    const leaveDate = new Date(rec.leaveDate);

    if (
      leaveDate.getUTCFullYear() === year &&
      leaveDate.getUTCMonth() + 1 === month &&
      leaveDate.getUTCDate() === day
    )
      return rec;

    const ist = new Date(leaveDate.getTime() + IST_OFFSET_MS);
    if (
      ist.getUTCFullYear() === year &&
      ist.getUTCMonth() + 1 === month &&
      ist.getUTCDate() === day
    )
      return rec;

    if (
      leaveDate.getFullYear() === year &&
      leaveDate.getMonth() + 1 === month &&
      leaveDate.getDate() === day
    )
      return rec;
  }

  return null;
};

// ─── Paid leaves available in the current calendar year (1 day/month) ────────
export const getAvailablePaidLeaves = async (userId, joinDate) => {
  if (!joinDate) return 0;
  const today = new Date();
  const currentYear = today.getFullYear();
  const join = new Date(joinDate);

  let startMonth = join.getFullYear() === currentYear ? join.getMonth() : 0;
  const currentMonth = today.getMonth();
  let monthsWorked = currentMonth - startMonth + 1;
  if (monthsWorked < 0) monthsWorked = 0;
  const totalEligible = monthsWorked;

  const startOfYear = new Date(Date.UTC(currentYear, 0, 1, 0, 0, 0, 0));
  const endOfYear = new Date(Date.UTC(currentYear, 11, 31, 23, 59, 59, 999));
  const takenPaidLeaves = await Leave.countDocuments({
    userId,
    leaveType: "paid",
    status: "approved",
    leaveDate: { $gte: startOfYear, $lte: endOfYear },
  });

  return Math.max(0, totalEligible - takenPaidLeaves);
};

// ═══════════════════════════════════════════════════════════════════════════
// Data-access / orchestration functions used directly by the controller
// ═══════════════════════════════════════════════════════════════════════════

export const getAllAttendance = async () => {
  const records = await Attendance.find().sort({ loginTime: -1 }).lean();
  if (records.length === 0) return records;

  // Attendance.userId points at the login User account, which is a separate
  // collection from Staff (different _id). The only reliable link between
  // the two is email, so resolve userId -> User.email -> Staff record here
  // and attach the display fields the admin table needs directly.
  const userIds = [...new Set(records.map((r) => String(r.userId)))];
  const users = await User.find({ _id: { $in: userIds } })
    .select("email")
    .lean();
  const emailByUserId = {};
  users.forEach((u) => {
    if (u.email) emailByUserId[String(u._id)] = u.email.toLowerCase();
  });

  const emails = [...new Set(Object.values(emailByUserId))];
  const staffList = await Staff.find({ email: { $in: emails } })
    .select("staffName projectName email")
    .lean();
  const staffByEmail = {};
  staffList.forEach((s) => {
    if (s.email) staffByEmail[s.email.toLowerCase()] = s;
  });

  return records.map((r) => {
    const email = emailByUserId[String(r.userId)];
    const matchedStaff = email ? staffByEmail[email] : null;
    return {
      ...r,
      staffName: matchedStaff?.staffName || null,
      projectName: matchedStaff?.projectName || null,
    };
  });
};

export const getAttendanceForDay = async (dateInput) => {
  const { start, end } = getDayRange(dateInput);
  return Attendance.find({ loginTime: { $gte: start, $lte: end } });
};

export const getHolidays = () => Holiday.find().sort({ date: 1 });

export const getLeaves = ({ leaveType, status } = {}) => {
  const filter = {};
  if (leaveType) filter.leaveType = leaveType;
  if (status) filter.status = status;
  return Leave.find(filter).sort({ leaveDate: -1 });
};

export const getStaffById = (userId) => Staff.findById(userId).lean();

export const getUserAttendanceRange = (userId, startDate, endDate) => {
  const query = { userId };
  if (startDate && endDate) {
    query.loginTime = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }
  return Attendance.find(query).sort({ loginTime: 1 }).lean();
};

// ─── Self sign-in / sign-out (per-user shift window, IST) ────────────────────
// Same IST_OFFSET_MS trick used in findExistingAttendance: shift the UTC
// timestamp by +5:30 so that its UTC getters read like IST wall-clock time.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Fallback shift if a user has no shiftStartTime/shiftEndTime set — matches
// the general office timing (10:00 AM – 6:30 PM).
export const DEFAULT_SHIFT_START = "10:00";
export const DEFAULT_SHIFT_END = "18:30";

// Lunch break, subtracted from worked time regardless of shift (1:30 PM –
// 2:15 PM, 45 minutes).
export const LUNCH_START = "13:30";
export const LUNCH_END = "14:15";

// Net working minutes required before self sign-out unlocks. Both the
// 10:00–18:30 and 9:00–17:30 shifts span 8.5 hours, so after the 45-minute
// lunch break is subtracted, either shift needs 7h 45m (465 min) of work.
export const REQUIRED_WORK_MINUTES = 7 * 60 + 45; // 465

const toIST = (date) => new Date(new Date(date).getTime() + IST_OFFSET_MS);

/** "HH:mm" → { hour, minute } */
const parseHM = (hm, fallback) => {
  const str =
    typeof hm === "string" && /^\d{1,2}:\d{2}$/.test(hm) ? hm : fallback;
  const [hour, minute] = str.split(":").map(Number);
  return { hour, minute };
};

/** "YYYY-MM-DD" for a timestamp's IST calendar day. */
export const getDateStringIST = (date) => {
  const ist = toIST(date);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(
    ist.getUTCDate(),
  ).padStart(2, "0")}`;
};

/** Builds a UTC-flagged Date that reads as `hh:mm` IST on the same calendar day as `referenceIST`. */
const istClockOn = (referenceIST, hh, mm) =>
  new Date(
    Date.UTC(
      referenceIST.getUTCFullYear(),
      referenceIST.getUTCMonth(),
      referenceIST.getUTCDate(),
      hh,
      mm,
      0,
      0,
    ),
  );

/** Overlap, in minutes, between [aStart,aEnd] and [bStart,bEnd]. */
const overlapMinutes = (aStart, aEnd, bStart, bEnd) => {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (end <= start) return 0;
  return Math.floor((end - start) / 60000);
};

/**
 * Working hours only count within the user's shift window (defaults to
 * 10:00 AM – 6:30 PM IST; some staff are set to 9:00 AM – 5:30 PM). Time
 * signed in before shift start or still signed in after shift end is
 * clipped at the boundary. The 1:30–2:15 PM lunch break is then subtracted
 * from whatever falls inside the shift window. Returns whole minutes,
 * never negative.
 */
export const getClampedWorkingMinutes = (
  loginTime,
  logoutTime,
  shiftStartTime = DEFAULT_SHIFT_START,
  shiftEndTime = DEFAULT_SHIFT_END,
) => {
  const loginIST = toIST(loginTime);
  const logoutIST = toIST(logoutTime);

  const { hour: startH, minute: startM } = parseHM(
    shiftStartTime,
    DEFAULT_SHIFT_START,
  );
  const { hour: endH, minute: endM } = parseHM(shiftEndTime, DEFAULT_SHIFT_END);
  const { hour: lunchStartH, minute: lunchStartM } = parseHM(
    LUNCH_START,
    LUNCH_START,
  );
  const { hour: lunchEndH, minute: lunchEndM } = parseHM(LUNCH_END, LUNCH_END);

  const windowStart = istClockOn(loginIST, startH, startM);
  const windowEnd = istClockOn(loginIST, endH, endM);
  const lunchStart = istClockOn(loginIST, lunchStartH, lunchStartM);
  const lunchEnd = istClockOn(loginIST, lunchEndH, lunchEndM);

  const clampedLogin = loginIST < windowStart ? windowStart : loginIST;
  const clampedLogout = logoutIST > windowEnd ? windowEnd : logoutIST;

  if (clampedLogout <= clampedLogin) return 0;

  const grossMinutes = Math.floor((clampedLogout - clampedLogin) / 60000);
  const lunchMinutes = overlapMinutes(
    clampedLogin,
    clampedLogout,
    lunchStart,
    lunchEnd,
  );

  return Math.max(0, grossMinutes - lunchMinutes);
};

/** Resolves the shift window to use for a user, falling back to the office default. */
export const getUserShift = (user) => ({
  shiftStartTime: user?.shiftStartTime || DEFAULT_SHIFT_START,
  shiftEndTime: user?.shiftEndTime || DEFAULT_SHIFT_END,
});

/** The signed-in-but-not-yet-signed-out record for this user, if any. */
export const findOpenAttendance = (userId) =>
  Attendance.findOne({
    userId,
    loginTime: { $exists: true },
    logoutTime: { $exists: false },
  }).sort({
    loginTime: -1,
  });

// ── Deterministic (non-heuristic) lookups used by self sign-in/out ─────────
// findExistingAttendance() above re-derives "which calendar day is this
// login on" from loginTime using three different, sometimes-conflicting
// branches (raw UTC / IST-shifted / server-local time) — a legacy heuristic
// built for admin bulk-import matching. For the self sign-in/out flow we
// always write the `date` field ourselves at check-in time using the exact
// same getDateStringIST() call we then read it back with, so a plain
// equality match is both correct and unambiguous — no timezone guessing.

/** Exact match: this user's attendance record for this IST calendar date. */
export const findAttendanceByUserAndDate = (userId, dateString) =>
  Attendance.findOne({ userId, date: dateString });

/** Exact match: this user's still-open (no logoutTime) record for this IST date. */
export const findOpenAttendanceForDate = (userId, dateString) =>
  Attendance.findOne({
    userId,
    date: dateString,
    logoutTime: { $exists: false },
  });

export { Attendance, Leave, Holiday, Staff, mongoose };
