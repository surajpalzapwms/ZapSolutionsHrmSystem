// services/lateDeduction.js
//
// LATE COMING → per-minute salary deduction.
//
// Rules (same everywhere: payroll, website calendar, mobile calendar):
//
//   1. Office time is the staff member's own shift (User.shiftStartTime /
//      shiftEndTime, default 10:00 AM – 6:30 PM; a qualifying Saturday uses
//      the Saturday shift 10:00 AM – 4:00 PM — see resolveEffectiveShift).
//
//   2. The first 15 minutes after shift start are a BUFFER (grace).
//      Signing in at 10:00–10:15 is never late.
//
//   3. Past the buffer, every minute is deducted at the PER-MINUTE salary:
//          per-minute = per-day salary ÷ net shift minutes
//      (per-day = basic ÷ days in month; net shift = shift length minus the
//      1:30–2:15 PM lunch, i.e. 465 min for 10:00–6:30).
//      e.g. sign in 10:20 → late 20 min → 20 − 15 buffer = 5 min deducted.
//
//   4. MAKE-UP: minutes the staff member stays after shift end on the SAME
//      day cancel the late minutes. Late 20 min (10:20) and signs out at
//      6:50 PM (20 min extra) → nothing deducted, full salary.
//          deductible = max(0, lateMinutes − buffer − stayedLateMinutes)
//
//   5. Super admin control:
//        • month-wise   — LateDeductionSetting.deductLate = false turns the
//                         deduction off for that staff member + month;
//        • date-wise    — Attendance.lateDeductionWaived = true waives one
//                         date on the attendance calendar.
//      Waived / switched-off minutes are still SHOWN, just not deducted.
//
//   5b. LUNCH: the lunch window (1:30–2:15 PM = 45 min) is normally NOT working
//       time. If the staff member did not take lunch (lunchSkipped) the whole
//       window counts as working time; if they took less than 45 min, the
//       unused part counts. That time is credited against the late minutes
//       exactly like "stayed extra" — but ONLY when a deduction would
//       otherwise be generated (nothing to deduct → lunch is not applied),
//       and only for the part of the window the staff member was signed in.
//          deductible = max(0, late − buffer − stayed − lunchCredit)
//
//   6. Only real worked days count: not leave-day placeholders, not Absent
//      markers, not Half Days (a half day is already paid as half), not
//      Sundays / holidays. Today's still-open record is "pending" — the
//      staff member can still make the time up — and is not deducted yet.
import mongoose from "mongoose";
import Attendance from "../models/Attendance.js";
import User from "../models/User.js";
import LateDeductionSetting from "../models/LateDeductionSetting.js";
import {
  attendanceDayKey,
  resolveEffectiveShift,
  DEFAULT_SHIFT_START,
  DEFAULT_SHIFT_END,
  LUNCH_START,
  LUNCH_END,
} from "./leave.js";

export const LATE_BUFFER_MINUTES = 15;

/** Allowed lunch length in minutes (13:30 → 14:15 = 45). */
export const LUNCH_ALLOWED_MINUTES =
  Number(LUNCH_END.split(":")[0]) * 60 + Number(LUNCH_END.split(":")[1]) -
  (Number(LUNCH_START.split(":")[0]) * 60 + Number(LUNCH_START.split(":")[1]));

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** "HH:mm" → minutes since midnight (falls back when malformed). */
const hmToMinutes = (hm, fallback) => {
  const str = typeof hm === "string" && /^\d{1,2}:\d{2}$/.test(hm) ? hm : fallback;
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
};

/** Minutes since IST midnight for a timestamp. */
const istMinutesOfDay = (date) => {
  const t = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};

const overlap = (aStart, aEnd, bStart, bEnd) =>
  Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

/** Today's IST "YYYY-MM-DD". */
export const todayKeyIST = () =>
  new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Net working minutes in a shift (shift length minus the lunch overlap).
 * 10:00–18:30 → 465, Saturday 10:00–16:00 → 315.
 */
export const netShiftMinutes = (shiftStartTime, shiftEndTime) => {
  const start = hmToMinutes(shiftStartTime, DEFAULT_SHIFT_START);
  const end = hmToMinutes(shiftEndTime, DEFAULT_SHIFT_END);
  const lunchS = hmToMinutes(LUNCH_START, LUNCH_START);
  const lunchE = hmToMinutes(LUNCH_END, LUNCH_END);
  return Math.max(0, end - start - overlap(start, end, lunchS, lunchE));
};

/**
 * Should this attendance record be checked for late coming at all?
 * Real worked days only — see rule 6 above.
 */
const isCountableRecord = (rec) =>
  !!rec &&
  !!rec.loginTime &&
  rec.isLeaveDay !== true &&
  rec.status !== "absent" &&
  rec.attendanceType !== "absent" &&
  rec.attendanceType !== "half";

/**
 * Late-coming figures for ONE day (pure function, no DB).
 *
 * `rec` needs { loginTime, logoutTime?, date?, lateDeductionWaived? }.
 * Returns null when the staff member was not late beyond the buffer.
 */
export const computeLateForRecord = (
  rec,
  {
    shiftStartTime = DEFAULT_SHIFT_START,
    shiftEndTime = DEFAULT_SHIFT_END,
    perDaySalary = 0,
    bufferMinutes = LATE_BUFFER_MINUTES,
    todayKey = todayKeyIST(),
  } = {},
) => {
  if (!isCountableRecord(rec)) return null;

  const dateKey = attendanceDayKey(rec);
  const shift = resolveEffectiveShift(rec.loginTime, shiftStartTime, shiftEndTime);
  const start = hmToMinutes(shift.shiftStartTime, DEFAULT_SHIFT_START);
  const end = hmToMinutes(shift.shiftEndTime, DEFAULT_SHIFT_END);
  const lunchS = hmToMinutes(LUNCH_START, LUNCH_START);
  const lunchE = hmToMinutes(LUNCH_END, LUNCH_END);

  // Late = working minutes between shift start and sign-in (lunch time in
  // between is not working time, so it is not counted as "late").
  const loginMin = istMinutesOfDay(rec.loginTime);
  const arrive = Math.min(Math.max(loginMin, start), end);
  const lateMinutes = Math.max(0, arrive - start - overlap(start, arrive, lunchS, lunchE));
  if (lateMinutes <= bufferMinutes) return null;

  // Make-up = minutes signed in after shift end on the same day.
  let stayedLateMinutes = 0;
  let pending = false;
  if (rec.logoutTime) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const shiftEndInstant = Date.UTC(y, m - 1, d, 0, end) - IST_OFFSET_MS;
    stayedLateMinutes = Math.max(
      0,
      Math.floor((new Date(rec.logoutTime).getTime() - shiftEndInstant) / 60000),
    );
  } else {
    // Still signed in today — they can still stay late to make it up.
    pending = dateKey >= todayKey;
  }

  const afterBufferMinutes = lateMinutes - bufferMinutes;
  const madeUpMinutes = Math.min(afterBufferMinutes, stayedLateMinutes);
  // What would be charged before lunch is considered. Lunch only matters
  // when this is > 0 (i.e. a deduction is actually generated).
  const deductibleBeforeLunch = Math.max(0, afterBufferMinutes - stayedLateMinutes);

  // ── Lunch credit ─────────────────────────────────────────────────────
  const lunchAllowed = LUNCH_ALLOWED_MINUTES;
  const lunchSkipped = rec.lunchSkipped === true;
  const rawTaken = rec.lunchTakenMinutes;
  const lunchTakenMinutes =
    !lunchSkipped && rawTaken !== null && rawTaken !== undefined && Number.isFinite(Number(rawTaken))
      ? Math.max(0, Math.round(Number(rawTaken)))
      : null;
  // Minutes of the lunch window the staff member was actually signed in.
  const outMin = rec.logoutTime ? istMinutesOfDay(rec.logoutTime) : lunchE;
  const lunchPresent = Math.min(
    lunchAllowed,
    overlap(Math.max(loginMin, start), Math.min(outMin, end), lunchS, lunchE),
  );
  let lunchWorkedMinutes = 0; // lunch time counted as working time
  if (lunchSkipped) lunchWorkedMinutes = lunchAllowed;
  else if (lunchTakenMinutes !== null) lunchWorkedMinutes = Math.max(0, lunchAllowed - lunchTakenMinutes);
  lunchWorkedMinutes = Math.min(lunchWorkedMinutes, lunchPresent);
  // Applied only against a deduction that exists, never more than it.
  const lunchCreditMinutes = Math.min(lunchWorkedMinutes, deductibleBeforeLunch);
  const deductibleMinutes = deductibleBeforeLunch - lunchCreditMinutes;

  const netShift = netShiftMinutes(shift.shiftStartTime, shift.shiftEndTime);
  const perMinuteRate = netShift > 0 ? (Number(perDaySalary) || 0) / netShift : 0;
  // Never more than one day's salary for one day.
  const amount = round2(
    Math.min(Number(perDaySalary) || 0, deductibleMinutes * perMinuteRate),
  );

  return {
    date: dateKey,
    recordId: rec._id ? String(rec._id) : null,
    shiftStartTime: shift.shiftStartTime,
    shiftEndTime: shift.shiftEndTime,
    loginTime: rec.loginTime,
    logoutTime: rec.logoutTime || null,
    lateMinutes, // total minutes after shift start
    bufferMinutes,
    stayedLateMinutes, // minutes after shift end (make-up time)
    madeUpMinutes, // part of the late time covered by staying late
    deductibleBeforeLunch, // charge before lunch is applied
    lunchAllowedMinutes: lunchAllowed,
    lunchEligible: lunchPresent > 0, // signed in during the lunch window
    lunchSkipped, // true = did not take lunch
    lunchTakenMinutes, // null = not recorded
    lunchWorkedMinutes, // lunch time that counts as working time
    lunchCreditMinutes, // part of it actually used to cancel the deduction
    deductibleMinutes, // what is actually charged
    perMinuteRate: round2(perMinuteRate * 10000) / 10000,
    amount, // ₹ for the deductible minutes
    waived: rec.lateDeductionWaived === true,
    pending,
    fullyMadeUp: !pending && deductibleMinutes === 0,
  };
};

/**
 * Month (or range) summary from already-loaded attendance records.
 *
 *   records      — Attendance docs for the staff member (any range; filtered here)
 *   fromKey/toKey— inclusive "YYYY-MM-DD" range to consider
 *   skipKeys     — Set of dates that are Sundays / holidays / unpaid (never deducted)
 *   enabled      — month switch (LateDeductionSetting.deductLate)
 */
export const buildLateSummary = ({
  records = [],
  shiftStartTime = DEFAULT_SHIFT_START,
  shiftEndTime = DEFAULT_SHIFT_END,
  perDaySalary = 0,
  enabled = true,
  fromKey = null,
  toKey = null,
  skipKeys = null,
  todayKey = todayKeyIST(),
  bufferMinutes = LATE_BUFFER_MINUTES,
}) => {
  // One entry per date: earliest sign-in + latest sign-out of that day.
  const byDate = new Map();
  for (const rec of records) {
    if (!isCountableRecord(rec)) continue;
    const key = attendanceDayKey(rec);
    if (!key) continue;
    if (fromKey && key < fromKey) continue;
    if (toKey && key > toKey) continue;
    if (skipKeys && skipKeys.has(key)) continue;
    const prev = byDate.get(key);
    if (!prev) {
      byDate.set(key, { ...rec, date: key });
      continue;
    }
    if (new Date(rec.loginTime) < new Date(prev.loginTime)) {
      prev.loginTime = rec.loginTime;
      prev._id = rec._id;
    }
    if (!rec.logoutTime) prev.logoutTime = prev.logoutTime || null;
    else if (!prev.logoutTime || new Date(rec.logoutTime) > new Date(prev.logoutTime)) {
      prev.logoutTime = rec.logoutTime;
    }
    if (rec.lateDeductionWaived) prev.lateDeductionWaived = true;
    if (rec.lunchSkipped) prev.lunchSkipped = true;
    if (rec.lunchTakenMinutes !== null && rec.lunchTakenMinutes !== undefined) {
      prev.lunchTakenMinutes = rec.lunchTakenMinutes;
    }
  }

  const dates = [];
  let totalLateMinutes = 0;
  let totalDeductibleMinutes = 0;
  let totalDeduction = 0;
  let waivedAmount = 0;
  let pendingAmount = 0;
  let totalLunchCreditMinutes = 0;
  let totalLunchTakenMinutes = 0;
  let lunchSkippedDays = 0;
  let lunchTakenDays = 0;

  [...byDate.keys()].sort().forEach((key) => {
    const late = computeLateForRecord(byDate.get(key), {
      shiftStartTime,
      shiftEndTime,
      perDaySalary,
      bufferMinutes,
      todayKey,
    });
    if (!late) return;
    const deducted = enabled && !late.waived && !late.pending;
    late.deducted = deducted && late.amount > 0;
    late.deductedAmount = late.deducted ? late.amount : 0;
    totalLateMinutes += late.lateMinutes;
    totalLunchCreditMinutes += late.lunchCreditMinutes;
    if (late.lunchSkipped) lunchSkippedDays += 1;
    else if (late.lunchTakenMinutes !== null) {
      lunchTakenDays += 1;
      totalLunchTakenMinutes += late.lunchTakenMinutes;
    }
    if (deducted) {
      totalDeductibleMinutes += late.deductibleMinutes;
      totalDeduction += late.amount;
    } else if (late.pending) {
      pendingAmount += late.amount;
    } else {
      waivedAmount += late.amount;
    }
    dates.push(late);
  });

  const netShift = netShiftMinutes(shiftStartTime, shiftEndTime);
  return {
    enabled,
    bufferMinutes,
    shiftStartTime,
    shiftEndTime,
    perMinuteRate: netShift > 0 ? round2(((Number(perDaySalary) || 0) / netShift) * 10000) / 10000 : 0,
    lateDays: dates.length,
    deductedDays: dates.filter((d) => d.deducted).length,
    madeUpDays: dates.filter((d) => d.fullyMadeUp).length,
    totalLateMinutes,
    totalDeductibleMinutes,
    lunchAllowedMinutes: LUNCH_ALLOWED_MINUTES,
    lunchSkippedDays, // late days where lunch was not taken
    lunchTakenDays, // late days where lunch length was recorded
    totalLunchTakenMinutes, // sum of recorded lunch lengths
    totalLunchCreditMinutes, // lunch time that cancelled deductions
    totalDeduction: round2(totalDeduction),
    waivedAmount: round2(waivedAmount),
    pendingAmount: round2(pendingAmount),
    dates,
  };
};

/** Month switch for one staff member (default: deduct). */
export const isLateDeductionEnabled = async (employeeId, period, session = null) => {
  if (!employeeId || !mongoose.Types.ObjectId.isValid(String(employeeId))) return true;
  const q = LateDeductionSetting.findOne({ employeeId, period }).select("deductLate");
  if (session) q.session(session);
  const doc = await q.lean();
  return doc ? doc.deductLate !== false : true;
};

/** Shift window of a login account (falls back to office default). */
export const getShiftForUser = async (userId, session = null) => {
  if (!userId) return { shiftStartTime: DEFAULT_SHIFT_START, shiftEndTime: DEFAULT_SHIFT_END };
  const q = User.findById(userId).select("shiftStartTime shiftEndTime");
  if (session) q.session(session);
  const u = await q.lean();
  return {
    shiftStartTime: u?.shiftStartTime || DEFAULT_SHIFT_START,
    shiftEndTime: u?.shiftEndTime || DEFAULT_SHIFT_END,
  };
};

/**
 * Loads everything needed and returns the late summary for one staff
 * member + month. Used by payroll (calculateSalary) and the calendar.
 *
 *   employeeId       Staff._id
 *   attendanceUserId login User._id (Attendance.userId)
 *   period           "YYYY-MM"
 *   perDaySalary     basic ÷ days in month
 *   records          optional pre-loaded Attendance docs (saves a query)
 */
export const loadLateSummary = async ({
  employeeId,
  attendanceUserId,
  period,
  perDaySalary,
  fromKey = null,
  toKey = null,
  skipKeys = null,
  records = null,
  session = null,
}) => {
  const [year, month] = period.split("-").map(Number);
  const monthStart = `${period}-01`;
  const monthEnd = `${period}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;

  const [enabled, shift] = await Promise.all([
    isLateDeductionEnabled(employeeId, period, session),
    getShiftForUser(attendanceUserId, session),
  ]);

  let recs = records;
  if (!recs) {
    if (!attendanceUserId) recs = [];
    else {
      const padMs = 86400000;
      const q = Attendance.find({
        userId: attendanceUserId,
        isLeaveDay: { $ne: true },
        loginTime: {
          $gte: new Date(Date.UTC(year, month - 1, 1) - padMs),
          $lte: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999) + padMs),
        },
      }).select(
        "date loginTime logoutTime status attendanceType isLeaveDay lateDeductionWaived lunchSkipped lunchTakenMinutes",
      );
      if (session) q.session(session);
      recs = await q.lean();
    }
  }

  return buildLateSummary({
    records: recs,
    ...shift,
    perDaySalary,
    enabled,
    fromKey: fromKey && fromKey > monthStart ? fromKey : monthStart,
    toKey: toKey && toKey < monthEnd ? toKey : monthEnd,
    skipKeys,
  });
};
