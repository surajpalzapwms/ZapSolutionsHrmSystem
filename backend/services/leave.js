import mongoose from "mongoose";
import Attendance from "../models/Attendance.js";
import Leave from "../models/Leave.js";
import Holiday from "../models/holiday.js";
import SaturdayHolidayRule, {
  SATURDAY_RULE_EFFECTIVE_FROM,
} from "../models/saturdayHolidayRule.js";
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

// Real Saturday office hours, confirmed against the actual login/logout
// data on file: staff sign in ~9:30–10:15 AM and sign out at 4:00 PM. This
// used to be hardcoded as a 4:00 PM – 5:30 PM (90-minute) evening window,
// which never matched how Saturdays are actually punched — a normal ~6
// hour Saturday shift (10:00 AM start, 4:00 PM close) was being scored
// against a 90-minute "expected" shift, so hundreds of legitimate worked
// minutes were misread as "extra hours earned" and inflated the
// extra-hours bank (see calculateExtraHoursSummary) far beyond what the
// punch times justify. Weekdays are completely unaffected — this only
// ever applies when `referenceDate` (the login time) falls on a Saturday
// in IST **on or after SATURDAY_SHORT_SHIFT_EFFECTIVE_FROM**. Before that
// date Saturdays were normal full working days (same hours as a weekday).
export const SATURDAY_SHIFT_START = "10:00";
export const SATURDAY_SHIFT_END = "16:00";
// Net minutes expected for a full Saturday: 10:00 AM – 4:00 PM (360 min)
// minus the 1:30–2:15 PM lunch overlap (45 min) = 315 net minutes.
const SATURDAY_SHIFT_MINUTES = 6 * 60 - 45; // 315
const SATURDAY_SHORT_SHIFT_EFFECTIVE_FROM = new Date(Date.UTC(2026, 3, 1)); // Apr 1, 2026
const isShortSaturday = (referenceDate) =>
  !!referenceDate &&
  toIST(referenceDate).getUTCDay() === 6 &&
  toIST(referenceDate) >= SATURDAY_SHORT_SHIFT_EFFECTIVE_FROM;

// Worked-time thresholds (weekdays):
//   > 5h worked  → full day
//   4h–5h worked → half day
//   < 4h worked  → short/absent
// `expectedMinutes` stays anchored to the nominal 4h/8h shift lengths (used
// downstream to compute extraHoursInMinutes — see buildAttendanceFields /
// checkOut), it's only the full/half/short cutoffs above that changed.
const FULL_DAY_THRESHOLD_MINUTES = 5 * 60;
const HALF_DAY_THRESHOLD_MINUTES = 4 * 60;

export const getAttendanceType = (totalMinutesWorked, referenceDate = null) => {
  if (isShortSaturday(referenceDate)) {
    // Saturday is optional — any recorded attendance (any positive worked
    // time) counts as a full day, no half/short tiers. Only time worked
    // beyond the real Saturday window (10:00 AM – 4:00 PM) is extra.
    if (totalMinutesWorked > 0) {
      return { type: "full", expectedMinutes: SATURDAY_SHIFT_MINUTES };
    }
  }
  if (totalMinutesWorked > FULL_DAY_THRESHOLD_MINUTES)
    return { type: "full", expectedMinutes: 8 * 60 };
  if (totalMinutesWorked >= HALF_DAY_THRESHOLD_MINUTES)
    return { type: "half", expectedMinutes: 4 * 60 };
  return { type: "short", expectedMinutes: 8 * 60 };
};

/**
 * Classifies a day's *effective* worked minutes (net shift time + any
 * overtime, see getWorkedMinutesBreakdown) into full / half / short — same
 * thresholds as getAttendanceType — but first tries to cover a shortfall
 * out of the user's extra-hours bank (see getAvailableBankMinutes) before
 * settling for a lower tier or "short".
 *
 *   > 5h worked alone       → full, bank untouched
 *   worked + bank > 5h      → full, bank spends just enough to cross 5h
 *   4h–5h worked alone      → half, bank untouched
 *   worked + bank >= 4h     → half, bank spends just enough to cross 4h
 *   otherwise               → short/absent, bank can't help
 *
 * A day only ever earns extra minutes (extraMinutesEarned, added to the
 * bank via extraHoursInMinutes on save) when it reaches full/half purely on
 * its own worked time — a day that needed the bank to reach its tier can't
 * also feed the bank in the same breath.
 */
export const classifyWorkedMinutes = (
  effectiveMinutes,
  availableBankMinutes = 0,
  referenceDate = null,
) => {
  if (isShortSaturday(referenceDate)) {
    // Same rule as getAttendanceType: any recorded Saturday attendance is
    // a full day, and only time beyond the real 10:00 AM – 4:00 PM window
    // is credited as extra.
    if (effectiveMinutes > 0) {
      return {
        type: "full",
        bankMinutesUsed: 0,
        extraMinutesEarned: Math.max(
          0,
          effectiveMinutes - SATURDAY_SHIFT_MINUTES,
        ),
      };
    }
    // No worked time at all (e.g. an "absent" marker on a Saturday) —
    // fall through to the normal thresholds below, same as any other day.
  }

  const bank = Math.max(0, Math.floor(availableBankMinutes || 0));

  if (effectiveMinutes > FULL_DAY_THRESHOLD_MINUTES) {
    return {
      type: "full",
      bankMinutesUsed: 0,
      extraMinutesEarned: Math.max(0, effectiveMinutes - 8 * 60),
    };
  }

  const neededForFull = FULL_DAY_THRESHOLD_MINUTES + 1 - effectiveMinutes;
  if (neededForFull <= bank) {
    return { type: "full", bankMinutesUsed: neededForFull, extraMinutesEarned: 0 };
  }

  if (effectiveMinutes >= HALF_DAY_THRESHOLD_MINUTES) {
    return { type: "half", bankMinutesUsed: 0, extraMinutesEarned: 0 };
  }

  const neededForHalf = HALF_DAY_THRESHOLD_MINUTES - effectiveMinutes;
  if (neededForHalf <= bank) {
    return { type: "half", bankMinutesUsed: neededForHalf, extraMinutesEarned: 0 };
  }

  return { type: "short", bankMinutesUsed: 0, extraMinutesEarned: 0 };
};

/**
 * Total minutes currently sitting in a user's extra-hours bank: the sum of
 * extraHoursInMinutes across their attendance records, excluding leave
 * days. This is what classifyWorkedMinutes draws on to cover a shortfall,
 * and what deductFromExtraHoursBank spends once a day actually uses it.
 */
export const getAvailableBankMinutes = async (userId) => {
  const result = await Attendance.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        isLeaveDay: { $ne: true },
        extraHoursInMinutes: { $gt: 0 },
      },
    },
    { $group: { _id: null, total: { $sum: "$extraHoursInMinutes" } } },
  ]);
  return result[0]?.total || 0;
};

/**
 * Spends `minutesToDeduct` out of a user's extra-hours bank, oldest banked
 * minutes first — the same FIFO convention already used by the "convert
 * extra hours to swap leave" flow elsewhere in this codebase. Reduces
 * extraHoursInMinutes (and the matching extraHours display string) on each
 * source record in turn until the requested amount is accounted for.
 */
export const deductFromExtraHoursBank = async (userId, minutesToDeduct) => {
  let remaining = Math.max(0, Math.floor(minutesToDeduct || 0));
  if (remaining <= 0) return;

  const records = await Attendance.find({
    userId,
    isLeaveDay: { $ne: true },
    extraHoursInMinutes: { $gt: 0 },
  }).sort({ loginTime: 1 });

  for (const rec of records) {
    if (remaining <= 0) break;
    const original = rec.extraHoursInMinutes || 0;
    if (original <= 0) continue;
    const deduction = Math.min(original, remaining);
    const newMinutes = original - deduction;
    rec.extraHoursInMinutes = newMinutes;
    rec.extraHours = formatMinutesToTimeString(newMinutes);
    await rec.save();
    remaining -= deduction;
  }
  // If `remaining` is still > 0 here, the bank had less available than the
  // caller believed — shouldn't happen since callers always check
  // getAvailableBankMinutes first, but it's not fatal: whatever the bank
  // actually had gets spent, and nothing throws.
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

// isHolidayOrSunday is called once PER CALENDAR DAY by several range-walking
// self-heal routines in services/leaveAutomation.js (e.g.
// reconcileSandwichLeaveForRange loops every day of a ~1-year padded range).
// Each call was previously a fresh Holiday.findOne (+ a SaturdayHolidayRule
// query on Saturdays), awaited one day at a time — 350-400+ sequential DB
// round trips on every single "My Attendance" / staff calendar page load,
// which is the actual cause of the slow calendar load. Holidays and
// Saturday-holiday rules are admin-managed and change rarely, so a short
// in-memory cache keyed by calendar day removes nearly all of that DB
// traffic (repeat lookups for the same day, which happen constantly across
// the several self-heal passes run per calendar request, are served from
// memory) without changing behavior — a holiday edit is visible to new
// requests within CACHE_TTL_MS.
const holidayCheckCache = new Map(); // "YYYY-MM-DD" -> { result, expiresAt }
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// Call after any Holiday or SaturdayHolidayRule create/update/delete so an
// admin's change is reflected immediately instead of waiting out the TTL.
export const invalidateHolidayCheckCache = () => holidayCheckCache.clear();

// ─── Holiday-window preload ────────────────────────────────────────────────
// The cache above only helps once a day has actually been looked up once.
// Several self-heal routines in services/leaveAutomation.js (reconciling
// sandwich leave, cleaning up invalid leave, etc.) walk a calendar range
// day-by-day and call isHolidayOrSunday for EVERY day in it — for a staff
// member's Annual View that's 400+ *unique* days on a cold cache (first
// load, or any load more than CACHE_TTL_MS after the last one), each one
// previously triggering its own Holiday.findOne (+ a SaturdayHolidayRule
// lookup on Saturdays), awaited one at a time. That's 400+ sequential DB
// round trips on a single page load — the actual cause of the slow render.
//
// warmHolidayWindow fetches everything the whole range could possibly need
// in a small, FIXED number of range queries (one for Holiday, one per
// spanned year for SaturdayHolidayRule) and pre-fills holidayCheckCache for
// every day in the range from that in-memory data. Any range-walking caller
// that calls this once up front (see buildStaffCalendarPayload) turns its
// day-by-day lookups into pure Map reads — no behavior change, since
// computeIsHolidayOrSunday's actual holiday/Saturday-rule logic is
// untouched; only where the underlying data comes from changes.
export const warmHolidayWindow = async (fromDate, toDate) => {
  const start = new Date(fromDate);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setUTCHours(23, 59, 59, 999);
  if (end < start) return;

  const years = [];
  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) years.push(y);

  const [holidays, ...ruleSets] = await Promise.all([
    Holiday.find({
      enabled: true,
      startDate: { $lte: end },
      endDate: { $gte: start },
    })
      .select("name startDate endDate")
      .lean(),
    ...years.map((year) => SaturdayHolidayRule.find({ year }).lean()),
  ]);

  const rulesByYearMonth = new Map();
  ruleSets.flat().forEach((r) => rulesByYearMonth.set(`${r.year}-${r.month}`, r.occurrences || []));

  const expiresAt = Date.now() + CACHE_TTL_MS;
  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor = new Date(cursor.getTime() + 86400000)
  ) {
    const istDate = toIST(cursor);
    const cacheKey = istDate.toISOString().slice(0, 10);
    // Don't clobber a value someone else already cached for this exact day
    // (e.g. an overlapping in-flight request) — first one in wins, same as
    // before; this is purely a bulk pre-fill, not a source of truth change.
    if (holidayCheckCache.has(cacheKey)) continue;

    let result;
    if (istDate.getUTCDay() === 0) {
      result = { isHoliday: true, reason: "Sunday" };
    } else {
      const s = new Date(cursor);
      s.setUTCHours(0, 0, 0, 0);
      const e = new Date(cursor);
      e.setUTCHours(23, 59, 59, 999);
      const holiday = holidays.find(
        (h) => new Date(h.startDate) <= e && new Date(h.endDate) >= s,
      );
      if (holiday) {
        result = { isHoliday: true, reason: holiday.name };
      } else if (istDate.getUTCDay() === 6) {
        const occurrence = SaturdayHolidayRule.getOccurrenceOfDate(cursor);
        const occurrences =
          occurrence && cursor >= SATURDAY_RULE_EFFECTIVE_FROM
            ? rulesByYearMonth.get(`${cursor.getUTCFullYear()}-${cursor.getUTCMonth() + 1}`) || []
            : [];
        result =
          occurrence && occurrences.includes(occurrence)
            ? { isHoliday: true, reason: SATURDAY_ORDINAL[occurrence] || "Saturday holiday" }
            : { isHoliday: false, reason: null };
      } else {
        result = { isHoliday: false, reason: null };
      }
    }
    holidayCheckCache.set(cacheKey, { result, expiresAt });
  }
};

export const isHolidayOrSunday = async (date) => {
  const checkDate = new Date(date);
  // Use the IST calendar day-of-week, not the server's local/UTC day —
  // Node servers almost always run in UTC, so a plain getDay()/getUTCDay()
  // check is wrong for roughly 5.5 hours around every IST midnight (e.g. it
  // would treat early Monday-IST hours as still Sunday and block sign-in).
  const istDate = toIST(checkDate);

  const cacheKey = istDate.toISOString().slice(0, 10);
  const cached = holidayCheckCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const result = await computeIsHolidayOrSunday(checkDate, istDate);
  holidayCheckCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
};

const computeIsHolidayOrSunday = async (checkDate, istDate) => {
  if (istDate.getUTCDay() === 0) return { isHoliday: true, reason: "Sunday" };
  // BUGFIX: the day window must be the INDIA calendar day — the same day
  // the result is cached under (cacheKey above). It used to be the UTC day
  // of `checkDate`, so a check made between 00:00 and 05:30 IST (e.g. the
  // midnight absence job, or a date saved as IST midnight = 18:30 UTC the
  // day before) looked up YESTERDAY's holiday and cached that answer as
  // today's. A holiday could then be treated as a normal working day for
  // the rest of the cache lifetime, and payroll deducted it as absent
  // ("all present, but ₹29,000 instead of ₹30,000").
  const s = new Date(
    Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth(), istDate.getUTCDate()),
  );
  const e = new Date(s.getTime() + 86400000 - 1);
  // Match any day WITHIN a declared holiday's startDate..endDate span, not
  // just a day that happens to equal startDate exactly — the previous
  // `startDate: { $gte: s, $lte: e }` (plus a `date` field the Holiday
  // schema doesn't even have) only ever matched the first day of a
  // multi-day holiday, silently treating day 2/3/etc. of it as an ordinary
  // working day everywhere this helper is used (absence auto-marking,
  // sandwich bridging, sign-in blocking, the invalid-leave cleanup). This
  // now matches the same range check buildMonthDays and the Holiday model's
  // own `isHoliday` static already use.
  const holiday = await Holiday.findOne({
    enabled: true,
    startDate: { $lte: e },
    endDate: { $gte: s },
  });
  if (holiday) return { isHoliday: true, reason: holiday.name };

  if (istDate.getUTCDay() === 6) {
    const { isHoliday: isSaturdayHoliday, occurrence } =
      await SaturdayHolidayRule.isSaturdayHoliday(s);
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
    // Compare against the total DAY VALUE actually banked/used, not just
    // the record count — a swapleave record can represent more than one
    // day (dayValue: 1.5, 2, ...) when it was created from a fractional
    // convertExtraHoursToLeave conversion, so counting records alone would
    // under-trim (or over-trim) whenever any record isn't worth exactly 1
    // day. `maxAllowedDays` is intentionally not floored — the bank is
    // compared in the same fractional units the records themselves use.
    const maxAllowedDays = totalExtraMinutes / 480;
    let cumulativeDays = 0;
    const toDelete = [];
    for (const l of swapLeaves) {
      const recordDays = l.dayValue ?? 1;
      if (cumulativeDays + recordDays > maxAllowedDays + 1e-9) {
        toDelete.push(l._id);
      } else {
        cumulativeDays += recordDays;
      }
    }
    if (toDelete.length > 0) {
      await Leave.deleteMany({ _id: { $in: toDelete } }).session(session);
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
    })
      // PERFORMANCE: only the fields used below, as plain objects — this
      // runs once per staff member on every Staff List load, over their
      // entire attendance history, so full Mongoose documents were costly.
      .select("loginTime logoutTime extraHoursInMinutes totalTime attendanceType")
      .sort({ loginTime: -1 })
      .lean();
    let totalExtraMinutes = 0,
      totalWorkedMinutes = 0;
    const recordsWithExtra = [];
    records.forEach((rec) => {
      if (!rec.loginTime || !rec.logoutTime) return;
      const minutesWorked = Math.floor(
        (new Date(rec.logoutTime) - new Date(rec.loginTime)) / 60000,
      );
      totalWorkedMinutes += minutesWorked;
      // Use the stored, already-adjusted extraHoursInMinutes — it reflects
      // any hours already redeemed via "Convert Extra Hours to Leave".
      // Recomputing from raw login/logout every time ignored those past
      // conversions, so the total only ever grew and never went back down
      // (the source of inflated totals like "37d 5h 25m"). Older records
      // saved before this field existed fall back to the raw calculation.
      const extra =
        typeof rec.extraHoursInMinutes === "number"
          ? Math.max(0, rec.extraHoursInMinutes)
          : Math.max(
              0,
              minutesWorked -
                getAttendanceType(minutesWorked, rec.loginTime).expectedMinutes,
            );
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
      // Same fix as calculateExtraHoursSummary: prefer the stored,
      // already-adjusted extraHoursInMinutes so past conversions are
      // respected instead of recomputed away.
      const extra =
        typeof rec.extraHoursInMinutes === "number"
          ? Math.max(0, rec.extraHoursInMinutes)
          : Math.max(
              0,
              minutesWorked -
                getAttendanceType(minutesWorked, rec.loginTime).expectedMinutes,
            );
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

  const applySession = (q) => (session ? q.session(session) : q);

  // Primary, unambiguous check: every record created since the `date`
  // field was added (see models/Attendance.js) carries the exact IST
  // calendar day it belongs to, set once at creation time. Matching on it
  // directly can never confuse two different days with each other.
  const byDateField = await applySession(
    Attendance.findOne({ userId, date: dateStr }),
  );
  if (byDateField) return byDateField;

  // Legacy fallback, for older records saved before the `date` field
  // existed. Only records that still lack a `date` are considered here —
  // a record for an adjacent day now always carries its own correct
  // `date` and so can never be mismatched onto this one just because its
  // loginTime happens to fall inside the padded lookup window. Only the
  // IST calendar day is checked (the app's single source of truth for
  // "which day" an attendance record belongs to everywhere else) instead
  // of also checking the raw UTC day and the server's local timezone,
  // either of which could disagree with IST and match the wrong day.
  const { year, month, day } = parseDateString(dateStr);
  const { start, end } = getWideDayRange(dateStr);
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

  const candidates = await applySession(
    Attendance.find({
      userId,
      $or: [{ date: { $exists: false } }, { date: null }, { date: "" }],
      loginTime: { $gte: start, $lte: end },
    }),
  );

  for (const rec of candidates) {
    const login = new Date(rec.loginTime);
    const ist = new Date(login.getTime() + IST_OFFSET_MS);
    if (
      ist.getUTCFullYear() === year &&
      ist.getUTCMonth() + 1 === month &&
      ist.getUTCDate() === day
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


// ═══════════════════════════════════════════════════════════════════════════
// Data-access / orchestration functions used directly by the controller
// ═══════════════════════════════════════════════════════════════════════════

// Optional { from, to } ("YYYY-MM-DD", IST calendar days, inclusive) narrow
// the query to a date window. Without them every record ever saved is
// returned (old behaviour) — which grows forever, so callers like the
// dashboard should pass a range.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const getAllAttendance = async ({ from, to } = {}) => {
  const filter = {};
  if (DAY_RE.test(from || "") || DAY_RE.test(to || "")) {
    filter.loginTime = {};
    if (DAY_RE.test(from || ""))
      filter.loginTime.$gte = new Date(`${from}T00:00:00.000+05:30`);
    if (DAY_RE.test(to || ""))
      filter.loginTime.$lte = new Date(`${to}T23:59:59.999+05:30`);
  }
  const records = await Attendance.find(filter).sort({ loginTime: -1 }).lean();
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

// Holiday has no `date` field — sort by startDate (the old sort on `date`
// was a no-op). .lean() returns plain objects, which is much faster to
// build and serialise than full Mongoose documents for read-only lists.
export const getHolidays = () => Holiday.find().sort({ startDate: 1 }).lean();

// Leave.leaveDate is stored as UTC midnight of the calendar day.
export const getLeaves = ({ leaveType, status, from, to } = {}) => {
  const filter = {};
  if (leaveType) filter.leaveType = leaveType;
  if (status) filter.status = status;
  if (DAY_RE.test(from || "") || DAY_RE.test(to || "")) {
    filter.leaveDate = {};
    if (DAY_RE.test(from || ""))
      filter.leaveDate.$gte = new Date(`${from}T00:00:00.000Z`);
    if (DAY_RE.test(to || ""))
      filter.leaveDate.$lte = new Date(`${to}T23:59:59.999Z`);
  }
  return Leave.find(filter).sort({ leaveDate: -1 }).lean();
};

export const getStaffById = (userId) => Staff.findById(userId).lean();

// ─── Probation / confirmation gating ──────────────────────────────────────
// A staff member should not be able to apply for ANY leave type (paid,
// unpaid, sick, casual, or swap) until their probation period is over and
// they've actually been confirmed. e.g. joining 1 Nov 2025 with a 3-month
// probation means leave only becomes applicable from 1 Feb 2026 onward.
//
// Mirrors the same joining-date + months calculation staffController.js
// uses to auto-flip a staff member from "Probation" to "Confirmation"
// (see calculateConfirmationDate/getAutoConfirmUpdate there) — kept here so
// the leave-apply endpoints can reuse it without importing a controller.
const addMonthsToDate = (dateInput, months) => {
  if (!dateInput || !months) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + months);
  return d;
};

// Staff lifecycle is Internship -> Probation -> Confirmation. Probation (and
// so confirmation) counts from the day AFTER the internship ends. Staff with
// no internship on record still count from their joining date, as before.
const getProbationStartDate = (staff) => {
  if (staff.internshipEndDate) {
    const d = new Date(staff.internshipEndDate);
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() + 1);
      return d;
    }
  }
  // Currently an intern but the end date was never stored — derive it.
  if (staff.status === "Internship" && staff.date && staff.internshipMonths) {
    return addMonthsToDate(staff.date, staff.internshipMonths);
  }
  return staff.date ? new Date(staff.date) : null;
};

/**
 * Returns the effective confirmation date for a staff member — the date on
 * or after which they're allowed to apply for leave — or null if it can't
 * be determined (no joining date on file, in which case the check is
 * skipped rather than blocking everyone).
 *
 * Uses whatever confirmationDate is already stored, falling back to
 * probation start date (the day after the internship ends, or the joining
 * date when there was no internship) + confirmationMonths (or
 * probationMonths, or a default of 3 months) — the exact same fallback chain getAutoConfirmUpdate() in
 * staffController.js uses, so this always agrees with what the staff
 * record's own status/confirmationDate will eventually show.
 */
export const getEffectiveConfirmationDate = (staff) => {
  if (!staff) return null;
  if (staff.confirmationDate) return new Date(staff.confirmationDate);
  const probationStart = getProbationStartDate(staff);
  if (!probationStart) return null;
  return addMonthsToDate(
    probationStart,
    staff.confirmationMonths || staff.probationMonths || 3,
  );
};

/**
 * Throws-free check: returns null if `checkDate` is on/after the staff
 * member's confirmation date (leave is allowed), or a ready-to-use error
 * message string if it falls before that date (still on probation).
 * `checkDate` should be a Date/parsable date for the specific leave day
 * being validated.
 */
export const getProbationLeaveBlockMessage = (staff, checkDate) => {
  const confirmationDate = getEffectiveConfirmationDate(staff);
  if (!confirmationDate) return null; // no joining date on file — don't block

  // Compare India (IST) calendar days, not server-local midnights. A
  // confirmation date saved as "2026-08-19T18:30:00Z" is 20 Aug in India;
  // the old setHours(0) comparison on a UTC server read it as 19 Aug and
  // let 19 Aug through as "confirmed".
  if (istDayKey(checkDate) >= istDayKey(confirmationDate)) return null;

  const formatted = new Date(confirmationDate).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  return `Leave cannot be applied during internship or probation. This staff member becomes eligible for leave from ${formatted} onward (after confirmation).`;
};

/**
 * Returns true if `checkDate` falls strictly before the staff member's
 * effective confirmation date (still on probation), false otherwise
 * (confirmed, or no joining date on file to determine probation from).
 *
 * Before confirmation there is NO Paid / Sick / Casual entitlement, so any
 * leave on such a day must be Unpaid.
 */
export const isBeforeConfirmation = (staff, checkDate) => {
  const confirmationDate = getEffectiveConfirmationDate(staff);
  if (!confirmationDate) return false; // no joining date on file — don't restrict
  return istDayKey(checkDate) < istDayKey(confirmationDate);
};

// "YYYY-MM-DD" of the India calendar day a Date / date string falls on.
// A plain "YYYY-MM-DD" string is returned as-is.
export const istDayKey = (value) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ist = new Date(new Date(value).getTime() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(
    ist.getUTCDate(),
  ).padStart(2, "0")}`;
};

// Which calendar day an Attendance record belongs to. Every record saved
// since the `date` field was added carries the exact IST day; older ones
// fall back to the IST day of loginTime. NEVER use loginTime's UTC day —
// a Half Day / Absent marker is stored with a login of 00:00 IST, which is
// 18:30 UTC on the PREVIOUS day (6 Aug half day showed up on 5 Aug).
export const attendanceDayKey = (rec) =>
  (rec?.date && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : null) ||
  istDayKey(rec.loginTime);

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

/**
 * Same worked-time math as getClampedWorkingMinutes, but reports minutes
 * worked past shift end separately instead of discarding them at the
 * boundary. `netMinutes` is time inside the shift window with lunch
 * subtracted (identical to getClampedWorkingMinutes). `overtimeMinutes` is
 * time worked after shift end — if login itself is after shift end, the
 * whole login→logout span counts as overtime and netMinutes is 0, so the
 * two never double-count the same minute.
 */
export const getWorkedMinutesBreakdown = (
  loginTime,
  logoutTime,
  shiftStartTime = DEFAULT_SHIFT_START,
  shiftEndTime = DEFAULT_SHIFT_END,
) => {
  const netMinutes = getClampedWorkingMinutes(
    loginTime,
    logoutTime,
    shiftStartTime,
    shiftEndTime,
  );

  const loginIST = toIST(loginTime);
  const logoutIST = toIST(logoutTime);
  const { hour: endH, minute: endM } = parseHM(shiftEndTime, DEFAULT_SHIFT_END);
  const windowEnd = istClockOn(loginIST, endH, endM);

  const overtimeStart = loginIST > windowEnd ? loginIST : windowEnd;
  const overtimeMinutes =
    logoutIST > overtimeStart
      ? Math.floor((logoutIST - overtimeStart) / 60000)
      : 0;

  return { netMinutes, overtimeMinutes };
};

/** Resolves the shift window to use for a user, falling back to the office default. */
export const getUserShift = (user) => ({
  shiftStartTime: user?.shiftStartTime || DEFAULT_SHIFT_START,
  shiftEndTime: user?.shiftEndTime || DEFAULT_SHIFT_END,
});

/**
 * Resolves the shift window to use for computing worked minutes on a given
 * calendar day: the real Saturday office hours (10:00 AM – 4:00 PM, see
 * SATURDAY_SHIFT_START/END above) for a qualifying Saturday, otherwise the
 * normal weekday/user shift passed in. Centralizing this means every place
 * that measures worked minutes for manual entry, imports, and admin edits
 * agrees on which window applies to a Saturday, instead of only the final
 * full/half/short classification knowing about it while the underlying
 * minutes were clamped against the wrong (weekday) window.
 */
export const resolveEffectiveShift = (
  referenceDate,
  shiftStartTime = DEFAULT_SHIFT_START,
  shiftEndTime = DEFAULT_SHIFT_END,
) => {
  if (isShortSaturday(referenceDate)) {
    return { shiftStartTime: SATURDAY_SHIFT_START, shiftEndTime: SATURDAY_SHIFT_END };
  }
  return { shiftStartTime, shiftEndTime };
};

// A Saturday with NO attendance record at all, from March 2026 onward, is
// treated as an (unplanned) company holiday instead of being left blank or
// ever risking being read as an absence — Saturdays here are optional
// working days, so nobody showing up means the office was effectively
// closed that day, not that staff were absent. `dateObj` should be a pure
// calendar-day Date (midnight UTC on the intended day, e.g. built with
// Date.UTC(year, monthIndex, day)) rather than a login/logout timestamp
// that would need IST correction.
export const UNWORKED_SATURDAY_HOLIDAY_EFFECTIVE_FROM = new Date(
  Date.UTC(2026, 2, 1),
); // Mar 1, 2026

export const isUnworkedSaturdayHoliday = (dateObj) =>
  dateObj.getUTCDay() === 6 && dateObj >= UNWORKED_SATURDAY_HOLIDAY_EFFECTIVE_FROM;

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

// ── Manual / import attendance field builder ────────────────────────────
// Used by recordAttendance() and importAttendance() in controllers/leave.js
// to turn a (userId, date, loginTime/logoutTime OR marker status) input
// into a full Attendance field set, using the same worked-minutes math as
// the self sign-in/out flow (see checkOut() above) so manually entered and
// imported records stay consistent with self-tracked ones.
export const buildAttendanceFields = ({
  userId,
  dateString,
  status,
  loginTime,
  logoutTime,
  source = "manual",
  bankMinutesAvailable = 0,
}) => {
  // If the admin (manual entry) or an imported row doesn't specify a time,
  // fall back to the office's default shift window — the real Saturday
  // hours (10:00 AM–4:00 PM) for a qualifying Saturday, otherwise the
  // normal 10:00 AM–6:30 PM window — instead of rejecting the record.
  const fallbackShift = resolveEffectiveShift(new Date(`${dateString}T00:00:00`));
  if (!loginTime) loginTime = new Date(`${dateString}T${fallbackShift.shiftStartTime}:00`);
  if (!logoutTime && status !== "absent" && status !== "half-day") {
    logoutTime = new Date(`${dateString}T${fallbackShift.shiftEndTime}:00`);
  }

  // "absent" / "half-day" marker rows have no real login/logout pair —
  // just a date and a status picked by the admin.
  if (status === "absent") {
    return {
      userId,
      date: dateString,
      loginTime,
      totalTime: "00:00:00",
      sessionMinutes: 0,
      attendanceType: "absent",
      extraHours: "00:00:00",
      extraHoursInMinutes: 0,
      status: "absent",
      source,
    };
  }

  if (status === "half-day") {
    const halfDayMinutes = 4 * 60;
    return {
      userId,
      date: dateString,
      loginTime,
      totalTime: formatMinutesToTimeString(halfDayMinutes),
      sessionMinutes: halfDayMinutes,
      attendanceType: "half",
      extraHours: "00:00:00",
      extraHoursInMinutes: 0,
      status: "present",
      source,
    };
  }

  // Normal case: real login/logout times — compute worked minutes (net
  // shift time + overtime) the same way checkOut() does for self sign-out,
  // then classify using whatever bank minutes are available to cover a
  // shortfall.
  const { shiftStartTime, shiftEndTime } = resolveEffectiveShift(loginTime);
  const { netMinutes, overtimeMinutes } = getWorkedMinutesBreakdown(
    loginTime,
    logoutTime,
    shiftStartTime,
    shiftEndTime,
  );
  const effectiveMinutes = netMinutes + overtimeMinutes;
  const totalTime = formatMinutesToTimeString(effectiveMinutes);
  const { type: attendanceType, bankMinutesUsed, extraMinutesEarned } =
    classifyWorkedMinutes(effectiveMinutes, bankMinutesAvailable, loginTime);

  return {
    userId,
    date: dateString,
    loginTime,
    logoutTime,
    totalTime,
    sessionMinutes: effectiveMinutes,
    attendanceType,
    extraHours: formatMinutesToTimeString(extraMinutesEarned),
    extraHoursInMinutes: extraMinutesEarned,
    bankMinutesUsed,
    status: "present",
    source,
  };
};

// ── Staff email -> login User._id resolver ──────────────────────────────
// Attendance.userId points at the login User account while Leave.userId
// points directly at Staff — the only reliable bridge between the two is
// email (same approach getAllAttendance() above uses in the other
// direction). Takes a list of staff emails and returns a lowercase
// email -> User._id map; missing/unmatched emails are simply absent from
// the result.
export const resolveUserIdByEmail = async (emails) => {
  const normalized = [
    ...new Set((emails || []).filter(Boolean).map((e) => String(e).toLowerCase())),
  ];
  if (normalized.length === 0) return {};

  const users = await User.find({ email: { $in: normalized } })
    .select("email")
    .lean();

  const userIdByEmail = {};
  users.forEach((u) => {
    if (u.email) userIdByEmail[u.email.toLowerCase()] = String(u._id);
  });
  return userIdByEmail;
};

// ── Staff email -> Staff._id resolver ────────────────────────────────────
// Leave.userId points directly at the Staff record (not the login User —
// see resolveUserIdByEmail above for that side). Takes a list of staff
// emails and returns a lowercase email -> Staff._id map so importLeaves()
// can accept a "Staff Email" column instead of requiring a pre-picked
// staff for the whole file.
export const resolveStaffIdByEmail = async (emails) => {
  const normalized = [
    ...new Set((emails || []).filter(Boolean).map((e) => String(e).toLowerCase())),
  ];
  if (normalized.length === 0) return {};

  // Staff.email has no `lowercase: true` schema option (unlike User.email),
  // so matching is done in JS rather than assuming DB values are already
  // normalized.
  const staffList = await Staff.find({ email: { $exists: true, $ne: null } })
    .select("email")
    .lean();

  const staffIdByEmail = {};
  staffList.forEach((s) => {
    if (s.email && normalized.includes(s.email.toLowerCase())) {
      staffIdByEmail[s.email.toLowerCase()] = String(s._id);
    }
  });
  return staffIdByEmail;
};

export const resolveStaffIdByUserId = async (userId) => {
  if (!userId) return null;
  const user = await User.findById(userId).select("email").lean();
  if (!user?.email) return null;
  const map = await resolveStaffIdByEmail([user.email]);
  return map[user.email.toLowerCase()] || null;
};

export { Attendance, Leave, Holiday, Staff, mongoose };