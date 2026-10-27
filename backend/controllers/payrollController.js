import Payroll from "../models/Payroll.js";
import Staff from "../models/Staff.js";
import StaffBasicPayroll from "../models/StaffBasicPayroll.js";
import StaffAdvance from "../models/StaffAdvance.js";
import Account from "../models/Account.js";
import Leave from "../models/Leave.js";
import Attendance from "../models/Attendance.js";
import User from "../models/User.js";
import {
  isHolidayOrSunday,
  warmHolidayWindow,
  attendanceDayKey,
} from "../services/leave.js";
import Holiday from "../models/holiday.js";
import SaturdayHolidayRule from "../models/saturdayHolidayRule.js";
import { getRemainingForType } from "../services/leaveBalance.js";
import { buildLateSummary, isLateDeductionEnabled, getShiftForUser } from "../services/lateDeduction.js";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";
import { getCompanyProfile, formatMoney } from "../services/companyProfile.js";
import { isAdminRole } from "../config/permissions.js";
import { calculateReferralCommission } from "../utils/referral.js";
import {
  getOrCompute,
  registerCacheWarmer,
} from "../services/responseCache.js";

// Helper functions
const toFixedAmount = (value) => {
  const num = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(num)) return 0;
  return Math.round(num * 100) / 100;
};

const toExactAmount = (value) => {
  const num = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(num)) return 0;
  return num;
};

// "2026-10-10" / Date / "" / null -> Date or null (invalid -> null).
const parseOptionalDate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

// Turns the payment rows sent by the form — [{ date: "2026-08-12",
// amount: 2000, note? }, ...] — into clean payment entries, each keeping the
// date it was ACTUALLY paid (not the date it was entered). Rows with an
// empty / 0 amount are skipped. Result is sorted oldest first.
// Throws on a negative amount, a bad date, or a date in the future.
const FUTURE_DATE_GRACE_MS = 24 * 60 * 60 * 1000; // timezone slack
const normalizePaymentEntries = (entries) => {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((p, i) => {
      const raw = p?.amount;
      if (raw === undefined || raw === null || raw === "") return null;
      if (isNaN(raw) || Number(raw) < 0) {
        throw new Error(`Payment ${i + 1}: amount must be a positive number`);
      }
      const amount = toFixedAmount(raw);
      if (amount <= 0) return null;

      let date = new Date();
      if (p?.date) {
        date = parseOptionalDate(p.date);
        if (!date) throw new Error(`Payment ${i + 1}: invalid Paid On date`);
      }
      if (date.getTime() > Date.now() + FUTURE_DATE_GRACE_MS) {
        throw new Error(`Payment ${i + 1}: Paid On date can't be in the future`);
      }
      const note = p?.note ? String(p.note).trim() : "";
      return { amount, date, note: note || undefined };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);
};

const sumPayments = (entries) =>
  toFixedAmount(entries.reduce((sum, p) => sum + p.amount, 0));

// Records saved before the `payments` list existed only have a paidAmount.
// Before adding a new part, turn that into one "earlier payment" entry so the
// history still adds up to paidAmount.
const backfillLegacyPayment = (payroll) => {
  if (!Array.isArray(payroll.payments)) payroll.payments = [];
  const listed = payroll.payments.reduce(
    (sum, p) => sum + (Number(p.amount) || 0),
    0,
  );
  const missing = toFixedAmount((payroll.paidAmount || 0) - listed);
  if (missing > 0) {
    payroll.payments.unshift({
      amount: missing,
      date: payroll.paymentDate || payroll.createdAt || new Date(),
      method: payroll.paymentMethod,
      note: "Earlier payment",
    });
  }
};

const generatePayrollCode = async () => {
  const latest = await Payroll.findOne({}).sort({ createdAt: -1 });
  let nextNumber = 1;
  if (latest?.payrollCode) {
    const match = latest.payrollCode.match(/PR-(\d+)/);
    if (match) nextNumber = parseInt(match[1]) + 1;
  }
  return `PR-${nextNumber.toString().padStart(4, "0")}`;
};

// "YYYY-MM" -> next "YYYY-MM"
const getNextPeriod = (period) => {
  const [year, month] = period.split("-").map(Number);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, "0")}`;
};

// "YYYY-MM" -> previous "YYYY-MM"
const getPreviousPeriod = (period) => {
  const [year, month] = period.split("-").map(Number);
  const d = new Date(year, month - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Runs `fn` over `items` with at most `limit` running at the same time.
// Much faster than a sequential for/await loop, without flooding the DB
// the way an unbounded Promise.all can.
const mapWithLimit = async (items, limit, fn) => {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
};

// Picks the basic salary that was actually in effect for a given payroll
// period, instead of always using whatever the *current* basic salary is.
// A staff member's basic salary can be revised (e.g. 25000 -> 25500 from
// 1 Dec 2025 -> 26500 from 1 Feb 2026); if the admin generates/previews
// payroll for an earlier month (e.g. Oct or Nov 2025), that month must use
// the amount that was effective back then, not today's latest amount.
//
// Rule: among all salaryHistory entries whose effectiveFrom is on or
// before the last day of the requested period, pick the one with the
// latest effectiveFrom (i.e. the revision that was "current" as of that
// month). Falls back to currentBasicSalary if there's no usable history
// (e.g. legacy records saved before salaryHistory existed).
export const getBasicSalaryForPeriod = (basicPayroll, periodEnd) => {
  const history = Array.isArray(basicPayroll.salaryHistory)
    ? basicPayroll.salaryHistory
    : [];

  const applicable = history
    .filter(
      (h) => h && h.effectiveFrom && new Date(h.effectiveFrom) <= periodEnd,
    )
    .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom));

  if (applicable.length > 0) {
    return toExactAmount(applicable[0].basicSalary);
  }

  // No history entry is old enough to apply to this period (e.g. previewing
  // a month before the very first revision). Fall back to the earliest
  // known revision if one exists, otherwise the current basic salary.
  if (history.length > 0) {
    const earliest = [...history].sort(
      (a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom),
    )[0];
    return toExactAmount(earliest.basicSalary);
  }

  return toExactAmount(basicPayroll.currentBasicSalary || 0);
};

// ── Company holiday handling ─────────────────────────────────────────────
// Company-declared holidays are always paid, even if they fall between two
// leave days. Set to true only if your policy applies the sandwich rule to
// company holidays too. Sundays keep the sandwich rule either way.
const SANDWICH_APPLIES_TO_COMPANY_HOLIDAYS = false;

// ── Saturday holidays (decided by admin, per month) ──────────────────────
// Stored in the "saturdayholidayrules" collection, one document per month:
//   { year: 2026, month: 10, occurrences: [...] }
// month is 1–12 (10 = October). occurrences lists which Saturdays of that
// month are holidays. Supported entry formats:
//   2 or "2"                      → the 2nd Saturday of the month
//   "last"                        → the last Saturday of the month
//   Date / "2026-10-10"           → that exact date
//   { occurrence: 2 } / { week: 2 } / { nth: 2 } / { date: ... }
// No document, or an empty occurrences array → no Saturday holidays that
// month (all Saturdays are working days).
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

// Any Date -> IST calendar day "YYYY-MM-DD" (handles dates saved at UTC
// midnight AND dates saved at IST midnight, e.g. 2026-10-09T18:30Z).
const toIstDayKey = (value) => {
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
};

const parseSaturdayOccurrences = (occurrences) => {
  const rule = { nths: new Set(), dates: new Set(), last: false };
  if (!Array.isArray(occurrences)) return rule;

  const addOne = (item) => {
    if (item === null || item === undefined) return;

    if (typeof item === "number") {
      rule.nths.add(item);
      return;
    }
    if (typeof item === "string") {
      const s = item.trim().toLowerCase();
      if (s === "last") {
        rule.last = true;
      } else if (/^\d{1,2}$/.test(s)) {
        rule.nths.add(Number(s));
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        rule.dates.add(s); // plain calendar date, use as-is
      } else {
        const key = toIstDayKey(item);
        if (key) rule.dates.add(key);
      }
      return;
    }
    if (item instanceof Date) {
      const key = toIstDayKey(item);
      if (key) rule.dates.add(key);
      return;
    }
    if (typeof item === "object") {
      if (item.date)
        addOne(item.date instanceof Date ? item.date : String(item.date));
      const nth =
        item.occurrence ?? item.week ?? item.nth ?? item.number ?? item.value;
      if (nth !== undefined)
        addOne(typeof nth === "number" ? nth : String(nth));
    }
  };

  occurrences.forEach(addOne);
  return rule;
};

// Loads the admin's Saturday-holiday rule for one month.
const loadSaturdayRule = async (year, month) => {
  const doc = await mongoose.connection
    .collection("saturdayholidayrules")
    .findOne({
      year: { $in: [year, String(year)] },
      month: { $in: [month, String(month)] },
    });
  return parseSaturdayOccurrences(doc?.occurrences);
};

const isSaturdayOff = (utcDate, rule) => {
  if (!rule) return false;
  const key = utcDate.toISOString().slice(0, 10);
  if (rule.dates.has(key)) return true;
  if (utcDate.getUTCDay() !== 6) return false;

  const dayOfMonth = utcDate.getUTCDate();
  const nthSaturday = Math.ceil(dayOfMonth / 7); // 1st, 2nd, 3rd...
  if (rule.nths.has(nthSaturday)) return true;

  if (rule.last) {
    const daysInMonth = new Date(
      Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth() + 1, 0),
    ).getUTCDate();
    if (dayOfMonth + 7 > daysInMonth) return true;
  }
  return false;
};

// Accepts the different shapes a holiday lookup may return
// (true, { isHoliday }, { holiday }, { isPublicHoliday }, { type: "holiday" }).
const looksLikeHoliday = (h) =>
  h === true ||
  !!(
    h &&
    (h.isHoliday ||
      h.isPublicHoliday ||
      h.isCompanyHoliday ||
      h.holiday ||
      h.type === "holiday")
  );

const NOON_MS = 12 * 3600 * 1000;

// Returns a cached checker: key "YYYY-MM-DD" -> { isSunday, isCompanyHoliday, isDayOff }
// The cache stores the PROMISE, so parallel calls for the same day share a
// single lookup instead of each hitting the holiday service.
// Every day the attendance CALENDAR paints as "Holiday" for this window,
// read the same way the calendar reads it (declared holidays + the admin's
// Saturday rule dates), as "YYYY-MM-DD" keys. A day the staff member sees
// as a yellow holiday must never be docked as "absent" by payroll just
// because the holiday service answered differently (e.g. a holiday saved at
// IST midnight, or a stale cache entry).
const loadCalendarHolidayKeys = async (fromUTC, toUTC) => {
  const keys = new Set();
  const dayKeyOf = (d) => new Date(d).toISOString().slice(0, 10);
  const [holidays, ...saturdayLists] = await Promise.all([
    Holiday.find({
      enabled: true,
      startDate: { $lte: new Date(toUTC.getTime() + 86400000) },
      endDate: { $gte: new Date(fromUTC.getTime() - 86400000) },
    })
      .select("startDate endDate")
      .lean(),
    ...[
      ...new Set([fromUTC.getUTCFullYear(), toUTC.getUTCFullYear()]),
    ].map((y) => SaturdayHolidayRule.getComputedDatesForYear(y)),
  ]);
  for (
    let c = new Date(dayKeyOf(fromUTC) + "T00:00:00Z");
    c <= toUTC;
    c = new Date(c.getTime() + 86400000)
  ) {
    const key = dayKeyOf(c);
    const hit = holidays.some((h) => {
      const s = new Date(h.startDate);
      const e = new Date(h.endDate || h.startDate);
      // Calendar rule (UTC midnight inside the span) OR the India day of
      // the saved start/end dates — either way it is shown as a holiday.
      if (c >= s && c <= e) return true;
      const sk = toIstDayKey(s);
      const ek = toIstDayKey(e);
      return !!sk && !!ek && key >= sk && key <= ek;
    });
    if (hit) keys.add(key);
  }
  saturdayLists.flat().forEach(({ date }) => keys.add(dayKeyOf(date)));
  return keys;
};

const createDayOffChecker = (saturdayRule, calendarHolidayKeys = null) => {
  const cache = new Map();
  const compute = async (key) => {
    const utcMidnight = new Date(`${key}T00:00:00Z`);
    const isSunday = utcMidnight.getUTCDay() === 0;

    // Saturday holiday — as set by the admin for this month.
    const saturdayOff = isSaturdayOff(utcMidnight, saturdayRule);

    // Declared holidays (festivals etc.). Probe at 12:00 UTC (17:30 IST):
    // that instant is the same calendar day whether the holiday service
    // reads it in UTC, IST or server-local time.
    let declaredHoliday = !!calendarHolidayKeys?.has(key);
    if (!isSunday && !saturdayOff && !declaredHoliday) {
      const h = await isHolidayOrSunday(
        new Date(utcMidnight.getTime() + NOON_MS),
      );
      declaredHoliday = looksLikeHoliday(h);
    }

    const isCompanyHoliday = !isSunday && (saturdayOff || declaredHoliday);

    return {
      isSunday,
      isCompanyHoliday,
      isDayOff: isSunday || isCompanyHoliday,
    };
  };
  return (key) => {
    if (!cache.has(key)) {
      const p = compute(key).catch((err) => {
        cache.delete(key); // don't cache a failure
        throw err;
      });
      cache.set(key, p);
    }
    return cache.get(key);
  };
};

// ── Advance recovery helpers ────────────────────────────────────────────
// Advances still owing (pending/approved with a balance left), given on or
// before the end of `periodEnd`, oldest first so the earliest advance is
// cleared first.
const getOutstandingAdvances = async (employeeId, periodEnd, session) => {
  const cutoff = new Date(periodEnd);
  cutoff.setHours(23, 59, 59, 999);
  const advances = await StaffAdvance.find({
    employeeId,
    status: { $in: ["pending", "approved"] },
    date: { $lte: cutoff },
  })
    .sort({ date: 1, createdAt: 1 })
    .session(session);
  return advances.filter(
    (a) => toExactAmount(a.amount) - toExactAmount(a.repaidAmount) > 0,
  );
};

const sumOutstanding = (advances) =>
  toExactAmount(
    advances.reduce(
      (sum, a) =>
        sum +
        Math.max(0, toExactAmount(a.amount) - toExactAmount(a.repaidAmount)),
      0,
    ),
  );

// Applies `amount` of recovery across the advances (oldest first) and
// returns the [{ advanceId, amount }] breakdown stored on the payroll so it
// can be reversed later.
const applyAdvanceRecovery = async (advances, amount, session) => {
  let remaining = toExactAmount(amount);
  const used = [];
  for (const advance of advances) {
    if (remaining <= 0) break;
    const outstanding = Math.max(
      0,
      toExactAmount(advance.amount) - toExactAmount(advance.repaidAmount),
    );
    if (outstanding <= 0) continue;
    const applied = Math.min(outstanding, remaining);
    advance.repaidAmount = toExactAmount(
      toExactAmount(advance.repaidAmount) + applied,
    );
    if (advance.repaidAmount >= advance.amount) advance.status = "repaid";
    await advance.save({ session });
    used.push({ advanceId: advance._id, amount: toFixedAmount(applied) });
    remaining = toExactAmount(remaining - applied);
  }
  return used;
};

// Undoes whatever a payroll's `advances` breakdown had recovered, so the
// advance balance goes back up by exactly that much.
const reverseAdvanceRecovery = async (usedAdvances = [], session) => {
  for (const used of usedAdvances || []) {
    const advance = await StaffAdvance.findById(used.advanceId).session(
      session,
    );
    if (!advance) continue;
    advance.repaidAmount = Math.max(
      0,
      toExactAmount(advance.repaidAmount) - toExactAmount(used.amount),
    );
    if (advance.repaidAmount < advance.amount && advance.status === "repaid") {
      advance.status = "approved";
    }
    await advance.save({ session });
  }
};

const calculateSalary = async (
  employeeId,
  period,
  session,
  manualBasicSalary = null,
  advanceDeductionInput = null,
) => {
  const employee = await Staff.findById(employeeId).session(session);
  if (!employee) throw new Error("Employee not found");

  // A manually-entered basic salary (typed directly on the Add Payroll form)
  // takes priority and doesn't require a pre-existing Staff Basic Payroll
  // record. Otherwise fall back to the stored basic payroll record, as before.
  const [year, month] = period.split("-").map(Number);
  const periodEnd = new Date(year, month, 0);

  let fullBasicSalary;
  if (manualBasicSalary !== null && manualBasicSalary !== undefined) {
    fullBasicSalary = toExactAmount(manualBasicSalary);
  } else {
    const basicPayroll = await StaffBasicPayroll.findOne({
      employeeId,
    }).session(session);
    if (!basicPayroll) throw new Error("Basic payroll not found");
    // Use whichever revision was actually in effect during this period,
    // not just whatever the latest/current amount happens to be today.
    fullBasicSalary = getBasicSalaryForPeriod(basicPayroll, periodEnd);
  }
  const totalDaysInMonth = new Date(year, month, 0).getDate();
  const perDaySalary = fullBasicSalary / totalDaysInMonth;

  // ── Period bounds, in UTC ────────────────────────────────────────────
  // Leave.leaveDate is stored at UTC midnight and the calendar reads it
  // with UTC getters, so payroll must use the SAME UTC day boundaries.
  const monthStartUTC = new Date(Date.UTC(year, month - 1, 1));
  const monthEndUTC = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const dayKey = (d) => new Date(d).toISOString().slice(0, 10); // UTC "YYYY-MM-DD"

  // If this staff member joined during (or after) this period, only pay
  // from their joining date onward instead of the full month. Mirrors the
  // relievingDate trimming below, but from the start of the range.
  let payableDays = totalDaysInMonth;
  let rangeStartUTC = monthStartUTC;
  let rangeEndUTC = monthEndUTC;
  // Joining / relieving dates are read as the INDIA calendar day. A date
  // picked on the website is often saved as IST midnight, e.g. 30 Sep
  // 00:00 IST = 29 Sep 18:30 UTC. Reading that with UTC getters made the
  // last day (or first day) fall one day early, so a full month showed
  // "29/30 days paid" and ₹29,000 instead of ₹30,000 even though every day
  // was present on the calendar.
  const istDayStart = (value) => {
    const t = new Date(new Date(value).getTime() + IST_OFFSET_MS);
    return new Date(
      Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()),
    );
  };
  if (employee.date) {
    const joinDayStart = istDayStart(employee.date);
    if (joinDayStart > monthEndUTC) {
      // Hasn't joined yet as of this period — nothing payable.
      payableDays = 0;
    } else if (joinDayStart > monthStartUTC) {
      payableDays = totalDaysInMonth - joinDayStart.getUTCDate() + 1;
      rangeStartUTC = joinDayStart;
    }
  }

  // If this staff member's last working day falls inside (or before) this
  // period, only pay through that date (inclusive) instead of the full month.
  //
  // BUGFIX: only when the staff member is actually "Relieved" — the same
  // rule the attendance calendar, createPayroll and the settlement use.
  // The Staff model deliberately KEEPS an old relievingDate when the status
  // changes back (e.g. a withdrawn resignation, or Relieved -> Confirmation),
  // and payroll used to apply it anyway: September was paid "29/30 days"
  // (₹29,000 instead of ₹30,000) while the calendar showed all 30 days
  // present, because a leftover relieving date of 29 Sep cut the month.
  const relievingApplies =
    employee.status === "Relieved" && !!employee.relievingDate;
  let payableNote = null;
  if (payableDays > 0 && relievingApplies) {
    const relDayStart = istDayStart(employee.relievingDate);
    if (relDayStart < rangeStartUTC) {
      // Already left before the payable range started — nothing payable.
      payableDays = 0;
    } else if (relDayStart <= monthEndUTC) {
      payableDays =
        Math.round((relDayStart.getTime() - rangeStartUTC.getTime()) / 86400000) + 1;
      rangeEndUTC = new Date(relDayStart.getTime() + 86400000 - 1);
      payableNote = `Paid up to the relieving date (${dayKey(relDayStart)})`;
    }
  }

  // A month that hasn't finished yet can only ever have salary EARNED
  // through today — days that haven't happened yet can't be "present" or
  // "on leave", so a live estimate must never project the whole month as
  // paid just because nothing has marked the remaining days absent. This
  // caps the payable range to today (IST) whenever part of it is still in
  // the future; a month that has already fully elapsed is never affected,
  // since today will already be past its rangeEndUTC.
  if (payableDays > 0) {
    const todayKeyStr = new Date(Date.now() + IST_OFFSET_MS)
      .toISOString()
      .slice(0, 10);
    const todayEndUTC = new Date(`${todayKeyStr}T23:59:59.999Z`);
    if (todayEndUTC < rangeStartUTC) {
      // The whole payable range is still in the future — nothing earned yet.
      payableDays = 0;
    } else if (todayEndUTC < rangeEndUTC) {
      // Part of the range hasn't happened yet — pay only through today.
      payableDays =
        Math.floor(
          (todayEndUTC.getTime() - rangeStartUTC.getTime()) / 86400000,
        ) + 1;
      rangeEndUTC = todayEndUTC;
    }
  }

  // Why fewer days than the month has are payable (shown under the salary
  // as "29/30 days paid — …" so a short month is never a mystery).
  if (payableDays === 0) {
    payableNote = payableNote || "Nothing payable in this period";
  } else if (payableDays < totalDaysInMonth && !payableNote) {
    if (rangeStartUTC > monthStartUTC) {
      payableNote = `Paid from the joining date (${dayKey(rangeStartUTC)})`;
    } else if (rangeEndUTC < monthEndUTC) {
      payableNote = `Month not finished — paid up to today (${dayKey(rangeEndUTC)})`;
    }
  }

  const startKey = dayKey(rangeStartUTC);
  const endKey = dayKey(rangeEndUTC);

  // ── Unpaid leave days — counted exactly the way the calendar shows them ──
  //   0. an approved company-paid leave on the same date wins over Unpaid;
  //   1. a company holiday is never deducted (unless admin override);
  //      a leave on a Sunday only counts as a sandwich bridge / override;
  //   2. a leave on a day with real FULL attendance is ignored (a worked
  //      half day only keeps a genuine half-day top-up);
  //   3. one date is one cell — it can never cost more than one day.
  const unpaidByDate = new Map();
  const unmarkedDates = []; // past working days with no attendance/leave/holiday
  const halfDayDates = []; // Half Day attendance with nothing covering the other half
  // Late-coming (see services/lateDeduction.js) — filled in below once we
  // know which days are holidays / unpaid.
  let lateSummary = null;
  let attendanceRecordsForLate = [];
  let lateUserId = null;
  let lateDayOffKeys = new Set();
  if (payableDays > 0) {
    // Attendance date key: the stored IST "YYYY-MM-DD" when present, else
    // derived from loginTime in IST (never the server's local time).
    // Same key the calendar uses (attendanceDayKey): a `date` that isn't a
    // clean "YYYY-MM-DD" (older imports, e.g. "2026-9-5") falls back to the
    // IST day of loginTime. Using it as-is made that day look "unmarked"
    // here — docked as absent — while the calendar showed it Present.
    const attKey = (rec) => attendanceDayKey(rec);

    // One query for all approved leaves; unpaid ones are filtered in memory.
    const allLeaves = await Leave.find({
      userId: employeeId,
      leaveDate: { $gte: rangeStartUTC, $lte: rangeEndUTC },
      status: "approved",
    }).session(session);
    const unpaidLeaves = allLeaves.filter((l) => l.leaveType === "unpaid");
    const leaveKeys = new Set(allLeaves.map((l) => dayKey(l.leaveDate)));

    // Dates that also carry an approved company-paid leave (Paid / Sick /
    // Casual / Swap). An older Unpaid record left behind on the same date
    // must NOT be deducted.
    const PAID_LEAVE_TYPES = ["paid", "sick", "casual", "swapleave", "swap"];
    const paidLeaveKeys = new Set(
      allLeaves
        .filter((l) => PAID_LEAVE_TYPES.includes(l.leaveType))
        .map((l) => dayKey(l.leaveDate)),
    );
    // Dates an admin turned into a Holiday for THIS staff member (Edit Day
    // -> Holiday). A holiday is always a paid day: any Unpaid record still
    // sitting on the same date (e.g. an old sandwich day) must never be
    // deducted, otherwise changing Unpaid -> Holiday leaves the month's
    // salary unchanged.
    const staffHolidayKeys = new Set(
      allLeaves
        .filter((l) => l.leaveType === "holiday")
        .map((l) => dayKey(l.leaveDate)),
    );

    // Real attendance (not an "absent" marker, not a leave placeholder) for
    // the window, keyed by day: "present" | "half".
    const attendanceByDate = new Map();
    const staffUser = employee.email
      ? await User.findOne({ email: employee.email.toLowerCase() })
          .select("_id")
          .session(session)
      : null;
    if (staffUser) {
      const padMs = 86400000;
      const records = await Attendance.find({
        userId: staffUser._id,
        isLeaveDay: { $ne: true },
        loginTime: {
          $gte: new Date(monthStartUTC.getTime() - padMs),
          $lte: new Date(rangeEndUTC.getTime() + padMs),
        },
      })
        .select("date loginTime logoutTime status attendanceType isLeaveDay lateDeductionWaived lunchSkipped lunchTakenMinutes")
        .session(session);
      attendanceRecordsForLate = records;
      lateUserId = staffUser._id;
      records.forEach((rec) => {
        if (rec.status === "absent" || rec.attendanceType === "absent") return;
        const key = attKey(rec);
        if (key < startKey || key > endKey) return;
        if (attendanceByDate.get(key) === "present") return;
        attendanceByDate.set(
          key,
          rec.attendanceType === "half" ? "half" : "present",
        );
      });
    }

    try {
      await warmHolidayWindow(monthStartUTC, rangeEndUTC);
    } catch (_) {
      /* best effort — falls back to per-day lookups */
    }

    // One cached Sunday / company-holiday checker for this calculation.
    const saturdayRule = await loadSaturdayRule(year, month);
    let calendarHolidayKeys = null;
    try {
      calendarHolidayKeys = await loadCalendarHolidayKeys(
        rangeStartUTC,
        rangeEndUTC,
      );
    } catch (_) {
      /* best effort — the holiday service below still runs */
    }
    const getDayOff = createDayOffChecker(saturdayRule, calendarHolidayKeys);

    // Look up every day of the range IN PARALLEL once, up front. Every later
    // getDayOff(key) call below is then an instant cache hit instead of a
    // separate sequential holiday lookup per day.
    const allKeys = [];
    for (
      let c = new Date(startKey + "T00:00:00Z");
      dayKey(c) <= endKey;
      c = new Date(c.getTime() + 86400000)
    ) {
      allKeys.push(dayKey(c));
    }
    await Promise.all(allKeys.map((k) => getDayOff(k)));
    for (const k of allKeys) {
      const off = await getDayOff(k); // cached — instant
      if (off?.isDayOff) lateDayOffKeys.add(k);
    }

    // Half-day Unpaid entries are tracked separately so that — and ONLY when
    // they add up to less than a full day — they can be auto-covered by an
    // available Paid leave balance instead of docking salary.
    const halfDayUnpaidByDate = new Map();

    for (const l of unpaidLeaves) {
      const key = dayKey(l.leaveDate);
      const value = l.dayValue ?? 1;

      // Rule 0: company-paid leave or a staff-only holiday on the same
      // date wins over Unpaid.
      if (paidLeaveKeys.has(key) || staffHolidayKeys.has(key)) continue;

      // Rule 1: a company holiday is a paid day, never deducted (unless an
      // admin explicitly overrode it). Sundays only count as a sandwich bridge.
      const dayOff = await getDayOff(key);
      if (dayOff.isCompanyHoliday) {
        const deductAnyway =
          l.isAdminOverride ||
          (l.isSandwich && SANDWICH_APPLIES_TO_COMPANY_HOLIDAYS);
        if (!deductAnyway) continue;
      } else if (dayOff.isSunday) {
        if (!l.isSandwich && !l.isAdminOverride) continue;
      }

      // Rule 2: real attendance on that date wins over the leave.
      const worked = attendanceByDate.get(key);
      if (worked === "present") continue;
      if (worked === "half") {
        const isLegitTopUp = l.isHalfDayTopUp === true || value <= 0.5;
        if (!isLegitTopUp) continue;
      }

      // Rule 3: never more than one day per calendar date.
      const newTotal = Math.min(1, (unpaidByDate.get(key) || 0) + value);
      unpaidByDate.set(key, newTotal);
      if (value < 1) {
        halfDayUnpaidByDate.set(
          key,
          Math.min(1, (halfDayUnpaidByDate.get(key) || 0) + value),
        );
      }
    }

    // ── Pay only for days the staff member is actually accounted for ─────
    // A past working day with no attendance, no leave and no holiday is
    // treated as absent (unpaid). Sundays and company holidays stay paid,
    // and only days BEFORE today (in IST) on/after the joining date are
    // considered.
    const todayKey = new Date(Date.now() + IST_OFFSET_MS)
      .toISOString()
      .slice(0, 10);
    const joinKey = employee.date ? dayKey(istDayStart(employee.date)) : startKey;
    const scanFrom = joinKey > startKey ? joinKey : startKey;
    let scanTo = endKey;
    const yesterday = new Date(
      new Date(todayKey + "T00:00:00Z").getTime() - 86400000,
    )
      .toISOString()
      .slice(0, 10);
    if (yesterday < scanTo) scanTo = yesterday;

    for (
      let c = new Date(scanFrom + "T00:00:00Z");
      dayKey(c) <= scanTo;
      c = new Date(c.getTime() + 86400000)
    ) {
      const key = dayKey(c);
      if (unpaidByDate.has(key)) continue; // already deducted as unpaid leave
      if (leaveKeys.has(key)) continue; // covered by paid/sick/casual/swap/etc.
      const worked = attendanceByDate.get(key);
      if (worked === "present") continue; // came in for the full day
      const dayOff = await getDayOff(key); // cached — instant
      if (dayOff.isDayOff) continue; // Sunday / company holiday is a paid day off
      if (worked === "half") {
        // BUGFIX: a Half Day (worked only half, nothing filed for the other
        // half) used to count as a full paid day, so two half days on the
        // calendar took nothing off the salary. The unworked half is now
        // deducted (0.5 day). A half day topped up with Paid / Sick /
        // Casual / Swap / Unpaid leave is skipped above (leaveKeys /
        // unpaidByDate) — that leave decides the other half.
        unpaidByDate.set(key, 0.5);
        halfDayDates.push(key);
        continue;
      }
      unpaidByDate.set(key, 1);
      unmarkedDates.push(key);
    }

    // ── Auto-cover half-day Unpaid leave with an available Paid balance ──
    // This only ever waives salary deduction here; it never rewrites the
    // underlying Leave documents' leaveType.
    const halfDayUnpaidTotal = [...halfDayUnpaidByDate.values()].reduce(
      (a, b) => a + b,
      0,
    );
    if (halfDayUnpaidTotal > 0) {
      let paidRemaining = 0;
      try {
        paidRemaining = await getRemainingForType(
          employeeId,
          employee.confirmationDate ?? null,
          "paid",
          periodEnd,
          relievingApplies ? employee.relievingDate : null,
        );
      } catch (_) {
        // No usable balance info (e.g. no confirmation date yet) — fall
        // back to no offset rather than guessing.
        paidRemaining = 0;
      }

      let offsetRemaining = Math.min(
        halfDayUnpaidTotal,
        Math.max(0, paidRemaining || 0),
      );
      for (const [key, val] of halfDayUnpaidByDate) {
        if (offsetRemaining <= 0) break;
        const covered = Math.min(val, offsetRemaining);
        if (covered <= 0) continue;
        const remainingOnDate = toFixedAmount(
          (unpaidByDate.get(key) || 0) - covered,
        );
        if (remainingOnDate <= 0) {
          unpaidByDate.delete(key);
        } else {
          unpaidByDate.set(key, remainingOnDate);
        }
        offsetRemaining = toFixedAmount(offsetRemaining - covered);
      }
    }
  }

  const unpaidLeaveDates = [...unpaidByDate.keys()].sort();
  const unpaidLeaveDays = [...unpaidByDate.values()].reduce((a, b) => a + b, 0);
  const leaveDeduction = unpaidLeaveDays * perDaySalary;
  const effectiveDays = Math.max(0, payableDays - unpaidLeaveDays);

  // ── Late coming (per-minute, after the 15-minute buffer) ─────────────
  // Minutes signed in late past the buffer are deducted at the per-minute
  // rate, minus any time the staff member stayed after shift end that same
  // day. The super admin can switch it off for the month or waive single
  // dates on the attendance calendar. Sundays / holidays / days already
  // unpaid are never charged again.
  if (payableDays > 0 && lateUserId) {
    const [lateEnabled, lateShift] = await Promise.all([
      isLateDeductionEnabled(employeeId, period, session),
      getShiftForUser(lateUserId, session),
    ]);
    const skipKeys = new Set([...lateDayOffKeys, ...unpaidByDate.keys()]);
    lateSummary = buildLateSummary({
      records: attendanceRecordsForLate.map((r) => (r.toObject ? r.toObject() : r)),
      ...lateShift,
      perDaySalary,
      enabled: lateEnabled,
      fromKey: startKey,
      toKey: endKey,
      skipKeys,
    });
  }
  const lateDeduction = lateSummary ? lateSummary.totalDeduction : 0;
  const earnedBeforeReferral = Math.max(
    0,
    perDaySalary * effectiveDays - lateDeduction,
  );

  // ── Referral organisation commission (first month only) ─────────────
  // e.g. 20,000 basic, Navkar 25% -> 5,000 goes to Navkar. Taken from the
  // full basic salary, only in the commission month, never below zero.
  const referralCalc =
    payableDays > 0
      ? calculateReferralCommission(
          employee,
          period,
          fullBasicSalary,
          earnedBeforeReferral,
        )
      : { referral: null, applies: false, commission: 0, commissionFull: 0, capped: false };
  const referralCommission = referralCalc.commission;
  const netSalary = Math.max(0, earnedBeforeReferral - referralCommission);

  // ── Advance recovery (admin-controlled) ──────────────────────────────
  // The outstanding advance is NOT deducted automatically any more. The
  // admin decides how much to recover each month (0, 500, 2000, or the
  // full balance). Nothing entered = nothing deducted, and the balance
  // simply stays outstanding for the following months until it reaches 0.
  const advances = await getOutstandingAdvances(employeeId, periodEnd, session);
  const outstandingAdvance = sumOutstanding(advances);
  // Can't recover more than is owed, nor more than this month's salary.
  const maxAdvanceDeduction = toExactAmount(
    Math.min(outstandingAdvance, netSalary),
  );
  const requestedAdvance =
    advanceDeductionInput === null ||
    advanceDeductionInput === undefined ||
    advanceDeductionInput === ""
      ? 0
      : toExactAmount(advanceDeductionInput);
  if (requestedAdvance < 0) {
    throw new Error("Advance deduction can't be negative");
  }
  const advanceDeduction = Math.min(requestedAdvance, maxAdvanceDeduction);
  // True when the admin asked for more than can be recovered this month —
  // createPayroll turns this into a clear error instead of silently
  // deducting less than what was typed.
  const advanceDeductionCapped = requestedAdvance > maxAdvanceDeduction;
  const advanceBalanceAfter = toExactAmount(
    Math.max(0, outstandingAdvance - advanceDeduction),
  );
  const finalSalary = Math.max(0, netSalary - advanceDeduction);

  // Any unpaid balance from last period's payroll rolls forward
  const previousPeriod = getPreviousPeriod(period);
  const previousPayroll = await Payroll.findOne({
    employeeId,
    period: previousPeriod,
    enabled: true,
  }).session(session);
  const previousPendingAmount = toExactAmount(
    previousPayroll?.pendingAmount || 0,
  );

  return {
    employee,
    basicSalary: fullBasicSalary,
    perDaySalary,
    totalDaysInMonth,
    payableDays,
    payableNote,
    unpaidLeaveDays,
    unpaidLeaveDates,
    unmarkedDates,
    halfDayDates,
    leaveDeduction,
    effectiveDays,
    lateDeduction,
    lateDeductionEnabled: lateSummary ? lateSummary.enabled : true,
    lateMinutes: lateSummary ? lateSummary.totalDeductibleMinutes : 0,
    lateDays: lateSummary ? lateSummary.deductedDays : 0,
    lateSummary,
    earnedBeforeReferral,
    referralCommission,
    referralCommissionFull: referralCalc.commissionFull,
    referralCommissionCapped: referralCalc.capped,
    referralApplies: referralCalc.applies,
    referralOrganization: referralCalc.referral?.organizationName || "",
    referralPercent: referralCalc.referral?.percent || 0,
    referralPeriod: referralCalc.referral?.period || null,
    netSalary,
    advances,
    outstandingAdvance,
    maxAdvanceDeduction,
    advanceDeduction,
    advanceDeductionRequested: requestedAdvance,
    advanceDeductionCapped,
    advanceBalanceAfter,
    finalSalary,
    previousPendingAmount,
    totalPayable: toExactAmount(finalSalary + previousPendingAmount),
  };
};

// Referral fields stored on a Payroll doc, from calculateSalary()'s result.
const referralPayrollFields = (salaryData) => ({
  referralCommission: toFixedAmount(salaryData.referralCommission || 0),
  referral: salaryData.referralApplies
    ? {
        organizationName: salaryData.referralOrganization,
        percent: salaryData.referralPercent,
        period: salaryData.referralPeriod,
      }
    : undefined,
});

// Shared with the Full & Final Settlement (services/settlementService.js),
// so the settlement uses exactly the same month salary as payroll.
export { calculateSalary };

// Re-runs a still-PENDING saved payroll for `period` ("YYYY-MM") from the
// current attendance/leave data. Called after an admin edits a calendar
// day, so the saved month figure (e.g. 14,516.13) follows the calendar
// (e.g. back to 15,000 when an Unpaid day becomes a Holiday). Paid /
// partial records are never rewritten — real money has moved on them; the
// calendar shows the live figure and the difference instead.
// Returns true when a record was updated.
export const refreshPendingPayrollForPeriod = async (employeeId, period) => {
  const payroll = await Payroll.findOne({
    employeeId,
    period,
    status: "pending",
    enabled: { $ne: false },
  });
  if (!payroll) return false;

  // Keep the advance amount the admin chose for this payroll. Put back what
  // it had recovered first so the balance is seen in full, then re-apply
  // (capped only if the recalculated salary is now lower than that amount).
  await reverseAdvanceRecovery(payroll.advances, null);
  const salaryData = await calculateSalary(
    employeeId,
    period,
    null,
    null,
    payroll.advanceDeduction || 0,
  );
  payroll.advances = await applyAdvanceRecovery(
    salaryData.advances,
    salaryData.advanceDeduction,
    null,
  );
  payroll.advanceBalanceAfter = toFixedAmount(salaryData.advanceBalanceAfter);
  const totalAllowance = payroll.totalAllowance || 0;
  const deductionAmount = payroll.totalDeduction || 0;
  const netSalaryExact = Math.max(
    0,
    salaryData.finalSalary + totalAllowance - deductionAmount,
  );
  const totalPayable = toFixedAmount(
    netSalaryExact + salaryData.previousPendingAmount,
  );

  payroll.basicSalary = toFixedAmount(salaryData.basicSalary);
  payroll.adjustedBasicSalary = toFixedAmount(salaryData.finalSalary);
  payroll.netSalary = toFixedAmount(netSalaryExact);
  payroll.netSalaryExact = netSalaryExact;
  payroll.advanceDeduction = toFixedAmount(salaryData.advanceDeduction);
  payroll.previousPendingAmount = toFixedAmount(salaryData.previousPendingAmount);
  Object.assign(payroll, referralPayrollFields(salaryData));
  payroll.totalPayable = totalPayable;
  payroll.paidAmount = 0;
  payroll.pendingAmount = totalPayable;
  payroll.attendanceInfo = {
    ...(payroll.attendanceInfo?.toObject?.() || payroll.attendanceInfo || {}),
    totalWorkingDays: salaryData.totalDaysInMonth,
    payableDays: salaryData.payableDays,
    unpaidLeaves: salaryData.unpaidLeaveDays,
    perDaySalary: salaryData.perDaySalary,
    effectiveDays: salaryData.effectiveDays,
    leaveDeduction: toFixedAmount(salaryData.leaveDeduction),
    lateDeduction: toFixedAmount(salaryData.lateDeduction),
    lateMinutes: salaryData.lateMinutes,
    lateDays: salaryData.lateDays,
    lateDeductionEnabled: salaryData.lateDeductionEnabled,
    referralCommission: toFixedAmount(salaryData.referralCommission || 0),
    isFull:
      salaryData.unpaidLeaveDays === 0 &&
      salaryData.payableDays === salaryData.totalDaysInMonth,
  };
  await payroll.save();
  return true;
};

// @desc    Export payroll records as CSV (same filters as getPayrolls, plus
//          employeeId for a single staff member's full salary history)
// @route   GET /api/hrm/payroll/export/csv
// @access  Private
export const exportPayrollsCSV = async (req, res) => {
  try {
    const { status, period, periodFrom, periodTo, search, employeeId } =
      req.query;
    const query = { enabled: true };

    if (status) query.status = status;
    if (employeeId) query.employeeId = employeeId;
    if (period) {
      query.period = period;
    } else if (periodFrom || periodTo) {
      query.period = {};
      if (periodFrom) query.period.$gte = periodFrom;
      if (periodTo) query.period.$lte = periodTo;
    }
    if (search) {
      const staff = await Staff.find({
        $or: [
          { staffName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      query.employeeId = { $in: staff.map((s) => s._id) };
    }

    const payrolls = await Payroll.find(query)
      .populate("employeeId", "staffName email projectName contactNo")
      .sort({ period: -1, createdAt: -1 })
      .lean();

    const header = [
      "Employee",
      "Period",
      "Basic Salary",
      "Total Allowance",
      "Deductions",
      "Advance Deduction",
      "Referral Organisation",
      "Referral Commission",
      "Net Salary",
      "Paid Amount",
      "Pending Amount",
      "Status",
    ];

    const escapeCsv = (value) => {
      const str = String(value ?? "");
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const rows = payrolls.map((p) =>
      [
        p.employeeId?.staffName || "",
        p.period,
        p.adjustedBasicSalary ?? p.basicSalary,
        p.totalAllowance,
        p.totalDeduction,
        p.advanceDeduction,
        p.referral?.organizationName || "",
        p.referralCommission || 0,
        p.netSalary,
        p.paidAmount,
        p.pendingAmount,
        p.status,
      ]
        .map(escapeCsv)
        .join(","),
    );

    const csv = [header.join(","), ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="payroll_export.csv"`,
    );
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to export payroll",
      error: error.message,
    });
  }
};

// @desc    Overall "Pending" amount for the Payroll dashboard card.
//          Adds up two things, for every active/relevant staff member,
//          across every period in the requested range:
//            1. An existing payroll record that isn't fully paid yet
//               (its own `pendingAmount`, which already accounts for any
//               partial payment already made).
//            2. A month that has fully passed with NO payroll record
//               created at all — counted using that staff member's Basic
//               Salary for that month (from Staff Basic Payroll), since
//               nothing has been paid toward it whatsoever.
//          The CURRENT month is skipped for both cases — it isn't "late"
//          until it's actually over — UNLESS the staff member has left
//          the organization (status "Relieved"), in which case even their
//          current month is due immediately since there's no future
//          payroll run left to catch it.
//
//          PERFORMANCE: Full & Final settlements (the expensive part) are
//          now computed in parallel (a few at a time) and ONLY for relieved
//          staff whose employment overlaps the requested range. Invalid or
//          absurdly old joining dates no longer make the loop run for decades.
// @route   GET /api/payroll/pending-summary?periodFrom=&periodTo=
// @access  Private
export const getPendingPayrollSummary = async (req, res) => {
  try {
    const { periodFrom, periodTo } = req.query;
    // The result is the same for every caller and only changes when data
    // is written (or the month rolls over), so serve it from the response
    // cache — the Payroll tab and the dashboard both request it on load.
    let data = await getOrCompute(pendingSummaryCacheKey(periodFrom, periodTo), () =>
      buildPendingPayrollSummary(periodFrom, periodTo),
    );

    // Plain staff (role "user") may only see THEIR OWN pending amount, never
    // anyone else's. The cached result covers every staff member, so narrow
    // it down here (without touching the shared cached object) and recompute
    // the totals from just this person's rows. This is what feeds the
    // "Pending Payroll" card on the staff dashboard.
    if (!isAdminRole(req.user?.role)) {
      const ownStaff = await Staff.findOne({
        email: req.user?.email?.toLowerCase().trim(),
      })
        .select("_id")
        .lean();
      const ownId = ownStaff ? String(ownStaff._id) : null;
      const ownDetails = ownId
        ? (data.details || []).filter((d) => String(d.employeeId) === ownId)
        : [];
      data = {
        totalPending: toFixedAmount(
          ownDetails.reduce((sum, d) => sum + Number(d.amount || 0), 0),
        ),
        pendingCount: ownDetails.filter((d) => d.amount > 0).length,
        details: ownDetails,
      };
    }

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("[pending-summary] Failed:", error);
    res.status(500).json({
      success: false,
      message: "Failed to calculate pending payroll summary",
      error: error.message,
    });
  }
};

// Cache key for the default (no period filter) pending summary — the one
// both the Payroll tab and the dashboard ask for on load.
const pendingSummaryCacheKey = (periodFrom, periodTo) => {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
  return `pending-summary:${periodFrom || ""}|${periodTo || ""}|${monthKey}`;
};

// Rebuild the default pending summary in the background after data changes
// (and once at server start) so the page never waits for it.
registerCacheWarmer(() =>
  getOrCompute(pendingSummaryCacheKey("", ""), () =>
    buildPendingPayrollSummary("", ""),
  ),
);

// Builds { totalPending, pendingCount, details } for getPendingPayrollSummary.
const buildPendingPayrollSummary = async (periodFrom, periodTo) => {
  {
    const toPeriod = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const isValidDate = (v) => !!v && !isNaN(new Date(v).getTime());
    const isValidPeriod = (p) =>
      typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
    // Anything earlier than this is treated as bad data, not a real month.
    const MIN_PERIOD = "2015-01";

    const currentPeriod = toPeriod(new Date());

    const staffList = await Staff.find({ enabled: true })
      .select("staffName date relievingDate status")
      .lean();
    const emptyResponse = () => ({
      totalPending: 0,
      pendingCount: 0,
      details: [],
    });
    if (staffList.length === 0) return emptyResponse();

    const staffIds = staffList.map((s) => s._id);

    // Default lower bound: the earliest (valid) staff joining month, so we
    // don't loop over decades of empty periods.
    const joinPeriods = staffList
      .filter((s) => isValidDate(s.date))
      .map((s) => toPeriod(new Date(s.date)))
      .filter((p) => p >= MIN_PERIOD);
    const earliestJoinPeriod = joinPeriods.sort()[0] || currentPeriod;

    const rangeFrom =
      isValidPeriod(periodFrom) && periodFrom >= MIN_PERIOD
        ? periodFrom
        : earliestJoinPeriod;
    // Never look past the current month here — a month that hasn't
    // started yet can't have a pending salary.
    const rangeTo =
      isValidPeriod(periodTo) && periodTo < currentPeriod
        ? periodTo
        : currentPeriod;
    if (rangeFrom > rangeTo) return emptyResponse();

    // ── Full & Final settlements: parallel, and only where relevant ──────
    const relievedToSettle = staffList.filter(
      (s) =>
        s.status === "Relieved" &&
        isValidDate(s.relievingDate) &&
        toPeriod(new Date(s.relievingDate)) >= rangeFrom,
    );
    const settlementByStaff = new Map();
    if (relievedToSettle.length > 0) {
      let computeFinalSettlement = null;
      try {
        // Dynamic import avoids a circular import at module load time
        // (settlementService imports calculateSalary from this file).
        ({ computeFinalSettlement } = await import(
          "../services/settlementService.js"
        ));
      } catch (err) {
        console.error(
          "[pending-summary] Could not load settlementService:",
          err.message,
        );
      }
      if (computeFinalSettlement) {
        const results = await mapWithLimit(relievedToSettle, 4, async (s) => {
          try {
            return [String(s._id), await computeFinalSettlement(s._id)];
          } catch (err) {
            console.error(
              `[pending-summary] Settlement failed for ${s.staffName}:`,
              err.message,
            );
            return [String(s._id), null];
          }
        });
        results.forEach(([id, settlement]) =>
          settlementByStaff.set(id, settlement),
        );
      }
    }

    const [basicPayrolls, existingPayrolls] = await Promise.all([
      StaffBasicPayroll.find({ employeeId: { $in: staffIds } }).lean(),
      Payroll.find({
        employeeId: { $in: staffIds },
        period: { $gte: rangeFrom, $lte: rangeTo },
        enabled: true,
      })
        .select("employeeId period status pendingAmount")
        .lean(),
    ]);

    const basicByStaff = new Map(
      basicPayrolls.map((b) => [String(b.employeeId), b]),
    );
    const payrollKey = (empId, period) => `${empId}_${period}`;
    const payrollMap = new Map(
      existingPayrolls.map((p) => [
        payrollKey(String(p.employeeId), p.period),
        p,
      ]),
    );

    // Every "YYYY-MM" period from rangeFrom to rangeTo, inclusive.
    const periods = [];
    let [y, m] = rangeFrom.split("-").map(Number);
    const [toY, toM] = rangeTo.split("-").map(Number);
    while (y < toY || (y === toY && m <= toM)) {
      periods.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }

    let totalPending = 0;
    let pendingCount = 0;
    const details = [];
    const inRange = (p) => p >= rangeFrom && p <= rangeTo;

    for (const staff of staffList) {
      const hasLeft = staff.status === "Relieved";
      const joinPeriod = isValidDate(staff.date)
        ? toPeriod(new Date(staff.date))
        : null;
      const relievedPeriod =
        hasLeft && isValidDate(staff.relievingDate)
          ? toPeriod(new Date(staff.relievingDate))
          : null;

      // Staff who have LEFT: use the Full & Final Settlement figures, so this
      // card always matches the settlement PDF. The generic fallback below
      // uses the full monthly basic for every month with no payroll record,
      // which overstates the amount (it ignores the relieving date, unpaid
      // days and Paid Leave encashment).
      if (hasLeft && relievedPeriod) {
        // Left before the selected range → nothing pending inside it.
        if (relievedPeriod < rangeFrom) continue;

        const settlement = settlementByStaff.get(String(staff._id)) || null;
        if (settlement) {
          const fs = settlement.finalSettlement || {};
          const staffDetails = [];

          (settlement.pendingMonths || []).forEach((pm) => {
            if (pm.pending > 0 && inRange(pm.period)) {
              staffDetails.push({
                period: pm.period,
                amount: toFixedAmount(pm.pending),
              });
            }
          });

          // Leave encashment and advance recovery belong to the relieving month.
          if (inRange(relievedPeriod)) {
            if (fs.leaveEncashment > 0) {
              staffDetails.push({
                period: relievedPeriod,
                type: "leaveEncashment",
                amount: toFixedAmount(fs.leaveEncashment),
              });
            }
            if (fs.outstandingAdvance > 0) {
              const subtotal = staffDetails.reduce((s, d) => s + d.amount, 0);
              // Never let the advance recovery push the balance below zero.
              const recovery = Math.min(fs.outstandingAdvance, subtotal);
              if (recovery > 0) {
                staffDetails.push({
                  period: relievedPeriod,
                  type: "advanceRecovery",
                  amount: toFixedAmount(-recovery),
                });
              }
            }
          }

          staffDetails.forEach((d) => {
            if (!d.amount) return;
            totalPending = toFixedAmount(totalPending + d.amount);
            if (d.amount > 0) pendingCount += 1;
            details.push({
              employeeId: staff._id,
              staffName: staff.staffName,
              ...d,
            });
          });
          continue; // settlement handled this staff member
        }
        // If the settlement couldn't be computed, fall through to the
        // month-by-month estimate below.
      }

      const basicPayroll = basicByStaff.get(String(staff._id));

      for (const period of periods) {
        // Not employed yet this month.
        if (joinPeriod && period < joinPeriod) continue;
        // Already left before this month started — nothing owed.
        if (relievedPeriod && period > relievedPeriod) continue;
        // Current month isn't late yet, unless they've already left.
        if (period === currentPeriod && !hasLeft) continue;

        const existing = payrollMap.get(payrollKey(String(staff._id), period));

        let amount = 0;
        if (existing) {
          if (existing.status !== "paid") {
            amount = toFixedAmount(existing.pendingAmount);
          }
        } else if (basicPayroll) {
          const [py, pm] = period.split("-").map(Number);
          const periodEnd = new Date(py, pm, 0);
          amount = getBasicSalaryForPeriod(basicPayroll, periodEnd);
        }

        if (amount > 0) {
          totalPending = toFixedAmount(totalPending + amount);
          pendingCount += 1;
          details.push({
            employeeId: staff._id,
            staffName: staff.staffName,
            period,
            amount,
          });
        }
      }
    }

    return { totalPending, pendingCount, details };
  }
};

// @desc    Get all payrolls
// @route   GET /api/payroll
// @access  Private
export const getPayrolls = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 1000,
      status,
      period,
      periodFrom,
      periodTo,
      search,
      employeeId,
    } = req.query;
    const query = { enabled: true };

    if (status) query.status = status;
    if (employeeId) query.employeeId = employeeId;
    // Exact single-period match (kept for backward compatibility) OR a
    // "YYYY-MM" range match — period strings sort lexically the same as
    // chronologically, so a plain $gte/$lte comparison works.
    if (period) {
      query.period = period;
    } else if (periodFrom || periodTo) {
      query.period = {};
      if (periodFrom) query.period.$gte = periodFrom;
      if (periodTo) query.period.$lte = periodTo;
    }

    if (search) {
      const staff = await Staff.find({
        $or: [
          { staffName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      query.employeeId = { $in: staff.map((s) => s._id) };
    }

    // Non-admin callers (staff self-service, e.g. the "My Payslips" screen)
    // may only ever see their own payroll records.
    if (!isAdminRole(req.user?.role)) {
      const ownStaff = await Staff.findOne({
        email: req.user?.email?.toLowerCase().trim(),
      }).select("_id");
      // No linked Staff profile → no records, not an error.
      query.employeeId = ownStaff ? ownStaff._id : null;
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 1000);
    const skip = (pageNum - 1) * limitNum;

    const [payrolls, total] = await Promise.all([
      Payroll.find(query)
        // `status` (Staff's employment status, e.g. "Relieved") is included
        // so the frontend can tell a staff member who has left the
        // organization from one who is simply mid-month — see the pending
        // count rule in usePayroll.js.
        .populate(
          "employeeId",
          "staffName email projectName contactNo staffId status",
        )
        .sort({ period: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Payroll.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: payrolls,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch payrolls",
      error: error.message,
    });
  }
};

// @desc    Get single payroll
// @route   GET /api/payroll/:id
// @access  Private
export const getPayroll = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id)
      .populate("employeeId", "staffName email projectName staffId")
      .populate("createdBy", "name email");

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: "Payroll not found",
      });
    }

    // Staff may only open their OWN payroll record (same rule as getPayrolls
    // and the payslip download). Before this, any logged-in staff member
    // could read anyone's salary by guessing/sharing a record id.
    if (!isAdminRole(req.user?.role)) {
      const ownStaff = await Staff.findOne({
        email: req.user?.email?.toLowerCase().trim(),
      }).select("_id");
      if (!ownStaff || String(ownStaff._id) !== String(payroll.employeeId?._id)) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to view this payroll",
        });
      }
    }

    res.status(200).json({
      success: true,
      data: payroll,
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid payroll ID",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to fetch payroll",
      error: error.message,
    });
  }
};

// "YYYY-MM" -> "Month YYYY", e.g. "2026-07" -> "July 2026"
const formatPeriodLabel = (period) => {
  const [year, month] = period.split("-").map(Number);
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${monthNames[(month || 1) - 1] || ""} ${year}`.trim();
};

// @desc    Download a single payroll record as a PDF payslip
// @route   GET /api/hrm/payroll/:id/payslip-export
// @access  Private (self can only download their own; admins can download any)
export const exportPayslipPdf = async (req, res) => {
  try {
    const company = await getCompanyProfile();
    // Amounts on the payslip use the currency chosen on the Settings page.
    const formatCurrency = (value) => formatMoney(value, company);
    const payroll = await Payroll.findById(req.params.id).populate(
      "employeeId",
      "staffName email projectName staffId contactNo employmentType",
    );

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: "Payroll not found",
      });
    }

    // Same self-service scoping used by getPayrolls: non-admins may only
    // download their own payslip, matched by email -> Staff profile.
    if (!isAdminRole(req.user?.role)) {
      const ownStaff = await Staff.findOne({
        email: req.user?.email?.toLowerCase().trim(),
      }).select("_id");
      if (
        !ownStaff ||
        String(ownStaff._id) !== String(payroll.employeeId?._id)
      ) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to download this payslip",
        });
      }
    }

    const staff = payroll.employeeId || {};
    const periodLabel = formatPeriodLabel(payroll.period);
    // File name = staff name + month name, e.g. "Suraj_Pal_October_2026.pdf".
    const fileName = `${(staff.staffName || "Staff").trim().replace(/[^\w-]+/g, "_")}_${periodLabel.replace(/\s+/g, "_")}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const doc = new PDFDocument({ size: "A4", margin: 0 });
    doc.on("error", (err) => {
      console.error("[payslip] PDF stream error:", err);
      if (!res.writableEnded) res.end();
    });
    doc.pipe(res);

    // ── Palette (matches the "Employee Payslip" reference template) ────────
    const NAVY = "#1B3A5C";
    const GOLD = "#C9A24B";
    const CREAM = "#F5E9C8";
    const TEXT_DARK = "#1B1B1B";

    const pageWidth = doc.page.width; // 595.28 for A4
    const marginX = 50;
    const contentWidth = pageWidth - marginX * 2;

    // ── Decorative header band with a wavy bottom edge ──────────────────────
    const drawWaveBand = (topY, height, color, flip = false) => {
      const baseY = flip ? topY : topY + height;
      const amp = 14;
      doc.save();
      doc.moveTo(0, topY);
      doc.lineTo(pageWidth, topY);
      doc.lineTo(pageWidth, baseY - amp);
      doc.bezierCurveTo(
        pageWidth * 0.75,
        baseY + amp,
        pageWidth * 0.55,
        baseY - amp * 1.6,
        pageWidth * 0.35,
        baseY,
      );
      doc.bezierCurveTo(
        pageWidth * 0.2,
        baseY + amp,
        pageWidth * 0.08,
        baseY - amp,
        0,
        baseY - amp * 0.4,
      );
      doc.closePath();
      doc.fill(color);
      doc.restore();
    };

    drawWaveBand(0, 78, NAVY);

    // Title
    doc
      .fontSize(22)
      .fillColor(NAVY)
      .font("Helvetica-Bold")
      .text("EMPLOYEE PAYSLIP", marginX, 108, {
        width: contentWidth,
        align: "center",
      });

    // Gold accent line with small diamond ends, under the title
    const lineY = 140;
    doc
      .moveTo(marginX + 10, lineY)
      .lineTo(pageWidth - marginX - 10, lineY)
      .strokeColor(GOLD)
      .lineWidth(1.5)
      .stroke();
    [marginX, pageWidth - marginX].forEach((x) => {
      doc
        .polygon([x - 5, lineY], [x, lineY - 5], [x + 5, lineY], [x, lineY + 5])
        .fill(GOLD);
    });

    // ── Employee details ────────────────────────────────────────────────────
    let y = 162;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(TEXT_DARK);
    const detailRows = [
      ["Month", periodLabel],
      ["Employee Name", staff.staffName || "-"],
      ["Employee ID", staff.staffId || "NA"],
      ["Department", staff.projectName || "NA"],
      ["Designation", staff.employmentType || "NA"],
      ["Pay Date", "10th/month"],
    ];
    const labelX = marginX;
    const colonX = marginX + 120;
    detailRows.forEach(([label, value]) => {
      doc
        .font("Helvetica-Bold")
        .fillColor(TEXT_DARK)
        .text(label, labelX, y, { width: 118 });
      doc
        .font("Helvetica")
        .fillColor(TEXT_DARK)
        .text(`: ${value}`, colonX, y, { width: contentWidth - 120 });
      y += 16;
    });
    y += 10;

    // ── Section ribbon tab (flag-style navy tab with white label) ──────────
    const drawRibbon = (label, ribbonY) => {
      const w = 130;
      const h = 20;
      doc.save();
      doc
        .moveTo(marginX, ribbonY)
        .lineTo(marginX + w, ribbonY)
        .lineTo(marginX + w - 8, ribbonY + h / 2)
        .lineTo(marginX + w, ribbonY + h)
        .lineTo(marginX, ribbonY + h)
        .closePath()
        .fill(NAVY);
      doc.restore();
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor("#FFFFFF")
        .text(label, marginX + 14, ribbonY + 5, { width: w - 20 });
      return ribbonY + h;
    };

    // ── Cream line-item box: rows of "label : amount", ending in a bold total bar ──
    const drawLineItemBox = (rows, totalLabel, totalValueText, boxTopY) => {
      const rowH = 18;
      // Long labels (e.g. "Basic Salary (after late coming …, Navkar
      // commission 25% …)") wrap onto extra lines instead of overlapping.
      doc.font("Helvetica").fontSize(9.5);
      const heights = rows.map(([label]) =>
        Math.max(rowH, doc.heightOfString(label, { width: 220 }) + 6),
      );
      const boxHeight = heights.reduce((a, b) => a + b, 0) + 10;
      doc.rect(marginX, boxTopY, contentWidth, boxHeight).fill(CREAM);

      let rowY = boxTopY + 6;
      doc.font("Helvetica").fontSize(9.5).fillColor(TEXT_DARK);
      rows.forEach(([label, amount], i) => {
        doc.text(label, marginX + 14, rowY, { width: 220 });
        doc.text(":", marginX + 240, rowY);
        doc.text(amount, marginX + contentWidth - 110, rowY, {
          width: 96,
          align: "right",
        });
        rowY += heights[i];
      });

      const totalY = boxTopY + boxHeight + 4;
      doc.rect(marginX, totalY, contentWidth, 22).fill(CREAM);
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(TEXT_DARK)
        .text(totalLabel, marginX + 14, totalY + 6, { width: 220 });
      doc.text(totalValueText, marginX + contentWidth - 110, totalY + 6, {
        width: 96,
        align: "right",
      });

      return totalY + 22;
    };

    // Earnings — the FULL monthly basic; everything taken off it (leave,
    // late coming, referral commission, advance…) is itemised under
    // Deductions, so the payslip adds up: Basic + allowances − deductions =
    // Net. e.g. 20,000.00 − 1,333.33 leave − 5,000.00 Navkar = 13,666.67.
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const basic = payroll.basicSalary ?? payroll.adjustedBasicSalary ?? 0;
    const adjusted = payroll.adjustedBasicSalary ?? payroll.basicSalary ?? 0;
    const leaveCut = Number(payroll.attendanceInfo?.leaveDeduction) || 0;
    const lateCut = Number(payroll.attendanceInfo?.lateDeduction) || 0;
    const referralCut = Number(payroll.referralCommission) || 0;
    const advanceCut = Number(payroll.advanceDeduction) || 0;
    const unpaidDays = Number(payroll.attendanceInfo?.unpaidLeaves) || 0;
    // Days before joining / after leaving (not leave — simply not employed).
    const notPayable = r2(basic - leaveCut - lateCut - referralCut - (adjusted + advanceCut));

    const earningsRows = [["Basic Salary", formatCurrency(basic)]];
    (payroll.allowances || []).forEach((a) =>
      earningsRows.push([a.type, formatCurrency(a.amount)]),
    );
    if (earningsRows.length === 1)
      earningsRows.push(["No additional allowances", "NA"]);

    y = drawRibbon("Earnings", y);
    y = drawLineItemBox(
      earningsRows,
      "Total Earnings",
      formatCurrency((payroll.totalAllowance || 0) + basic),
      y + 4,
    );
    y += 14;

    // Deductions
    const deductionRows = (payroll.deductions || []).map((d) => [
      d.type,
      formatCurrency(d.amount),
    ]);
    if (leaveCut > 0)
      deductionRows.push([
        `Leave Deduction (${r2(unpaidDays)} day${unpaidDays === 1 ? "" : "s"})`,
        formatCurrency(leaveCut),
      ]);
    if (lateCut > 0) deductionRows.push(["Late Coming Deduction", formatCurrency(lateCut)]);
    if (referralCut > 0)
      deductionRows.push([
        `${payroll.referral?.organizationName || "Referral"} Commission${
          payroll.referral?.percent ? ` (${r2(payroll.referral.percent)}%)` : ""
        }`,
        formatCurrency(referralCut),
      ]);
    if (advanceCut > 0) deductionRows.push(["Advance Recovery", formatCurrency(advanceCut)]);
    if (notPayable > 0.009)
      deductionRows.push(["Days not employed this month", formatCurrency(notPayable)]);
    if (deductionRows.length === 0) deductionRows.push(["No deductions", "NA"]);

    y = drawRibbon("Deductions", y);
    const totalDeductions =
      (payroll.totalDeduction || 0) +
      leaveCut +
      lateCut +
      referralCut +
      advanceCut +
      (notPayable > 0.009 ? notPayable : 0);
    y = drawLineItemBox(
      deductionRows,
      "Total Deductions",
      formatCurrency(totalDeductions),
      y + 4,
    );
    y += 18;

    // ── Net Salary Received bar ─────────────────────────────────────────────
    doc.rect(marginX, y, contentWidth, 26).fill(CREAM);
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(TEXT_DARK)
      .text("Net Salary Received", marginX + 14, y + 7, { width: 260 });
    doc.text(
      formatCurrency(payroll.netSalaryExact ?? payroll.netSalary),
      marginX + contentWidth - 130,
      y + 7,
      { width: 116, align: "right" },
    );
    y += 46;

    // ── Payment details (left) + Prepared by (right) ────────────────────────
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(TEXT_DARK);
    const paymentRows = [
      [
        "Net Pay",
        `: ${formatCurrency(payroll.netSalaryExact ?? payroll.netSalary)}`,
      ],
      ["Bank Account", `: ${payroll.bankAccount || "NA"}`],
      [
        "Payment Mode",
        `: ${payroll.paymentMethod === "bank" ? "Bank Transfer" : payroll.paymentMethod || "NA"}`,
      ],
    ];
    let leftY = y;
    paymentRows.forEach(([label, value]) => {
      doc.font("Helvetica-Bold").text(label, marginX, leftY, { width: 90 });
      doc.font("Helvetica").text(value, marginX + 92, leftY, { width: 180 });
      leftY += 16;
    });

    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(TEXT_DARK)
      .text("Prepared by:", marginX + 330, y);

    y = Math.max(leftY, y + 16) + 26;

    doc.font("Helvetica-Bold").fontSize(9.5).text("Authorized by:", marginX, y);
    y += 14;
    doc
      .font("Helvetica")
      .text(`${company.financeTitle} \u2013 ${company.name}`, marginX, y);
    y += 26;

    doc.font("Helvetica").text("Created by \u2013 Accounts team", marginX, y);
    y += 14;
    doc.font("Helvetica").text("Approved by Admin", marginX, y);

    // Signature block, right-aligned, roughly level with "Authorized by"
    doc
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .text(req.user?.name || "Accounts Team", marginX + 330, y - 40, {
        width: 160,
      });
    doc
      .font("Helvetica")
      .text(company.name, marginX + 330, y - 26, { width: 160 });

    // ── Footer wave band ─────────────────────────────────────────────────────
    const footerHeight = 60;
    drawWaveBand(doc.page.height - footerHeight, footerHeight, NAVY, true);

    doc.end();
  } catch (error) {
    // Once the PDF has started streaming, headers are already sent — we
    // can't switch to a JSON error any more, so just close the response
    // (otherwise the download hangs forever).
    if (res.headersSent) {
      console.error("[payslip] Failed mid-stream:", error);
      if (!res.writableEnded) res.end();
      return;
    }
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid payroll ID",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to generate payslip PDF",
      error: error.message,
    });
  }
};

// @desc    Preview/calculate a staff member's salary for a period before saving
// @route   GET /api/hrm/payroll/calculate/:employeeId/:period
// @access  Private
export const previewPayroll = async (req, res) => {
  try {
    const { employeeId, period } = req.params;

    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({
        success: false,
        message: "Period must be in YYYY-MM format",
      });
    }

    // Optional ?advanceDeduction= lets the form preview a chosen recovery
    // amount; without it nothing is deducted (the admin decides).
    const salaryData = await calculateSalary(
      employeeId,
      period,
      null,
      null,
      req.query.advanceDeduction ?? null,
    );

    const responseData = {
      basicSalary: toFixedAmount(salaryData.basicSalary),
      perDaySalary: toFixedAmount(salaryData.perDaySalary),
      totalDaysInMonth: salaryData.totalDaysInMonth,
      payableDays: salaryData.payableDays,
      payableNote: salaryData.payableNote,
      unpaidLeaveDays: salaryData.unpaidLeaveDays,
      unpaidLeaveDates: salaryData.unpaidLeaveDates,
      unmarkedDates: salaryData.unmarkedDates,
      leaveDeduction: toFixedAmount(salaryData.leaveDeduction),
      lateDeduction: toFixedAmount(salaryData.lateDeduction),
      lateMinutes: salaryData.lateMinutes,
      lateDays: salaryData.lateDays,
      lateDeductionEnabled: salaryData.lateDeductionEnabled,
      lateSummary: salaryData.lateSummary,
      effectiveDays: salaryData.effectiveDays,
      // Referral organisation commission (first month only).
      earnedBeforeReferral: toFixedAmount(salaryData.earnedBeforeReferral),
      referralCommission: toFixedAmount(salaryData.referralCommission),
      referralCommissionFull: toFixedAmount(salaryData.referralCommissionFull),
      referralCommissionCapped: salaryData.referralCommissionCapped,
      referralApplies: salaryData.referralApplies,
      referralOrganization: salaryData.referralOrganization,
      referralPercent: salaryData.referralPercent,
      referralPeriod: salaryData.referralPeriod,
      netSalary: toFixedAmount(salaryData.netSalary),
      // Advance recovery is chosen by the admin — these tell the form how
      // much is still owed and the most that can be taken this month.
      outstandingAdvance: toFixedAmount(salaryData.outstandingAdvance),
      maxAdvanceDeduction: toFixedAmount(salaryData.maxAdvanceDeduction),
      advanceDeduction: toFixedAmount(salaryData.advanceDeduction),
      advanceBalanceAfter: toFixedAmount(salaryData.advanceBalanceAfter),
      finalSalary: toFixedAmount(salaryData.finalSalary),
      previousPendingAmount: toFixedAmount(salaryData.previousPendingAmount),
      totalPayable: toFixedAmount(salaryData.totalPayable),
      employeeName: salaryData.employee.staffName,
    };

    res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to calculate salary",
    });
  }
};

// @desc    Create payroll (supports partial payment — any unpaid balance
//          automatically rolls forward into next month's previousPendingAmount)
// @route   POST /api/payroll
// @access  Private/Admin
export const createPayroll = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      employeeId,
      period,
      basicSalary, // optional — manual override, doesn't require a Staff Basic Payroll record
      allowances = [],
      deductions = [], // itemized [{ type, amount }], e.g. Provident Fund, Professional Tax
      paymentMethod = "bank",
      bankAccount = "",
      remarks = "",
      paidAmount, // optional — defaults to full amount owed if omitted
      // optional — each payment with the date it was actually paid:
      // [{ date: "2026-08-12", amount: 2000 }, { date: "2026-08-18", amount: 3500 }]
      // When sent, paidAmount is the sum of these (paidAmount is ignored).
      payments: paymentRows,
      sourceAccountId = null,
      // optional — how much of the outstanding advance to recover from
      // this month's salary. Omitted / 0 = nothing is deducted this month.
      advanceDeduction = 0,
      // optional — date the pending (unpaid) part is expected to be paid
      pendingDate = null,
    } = req.body;

    if (
      advanceDeduction !== null &&
      advanceDeduction !== "" &&
      (isNaN(advanceDeduction) || Number(advanceDeduction) < 0)
    ) {
      throw new Error("Advance deduction must be 0 or a positive number");
    }

    // Validate — Staff and Period are required since they identify the record.
    if (!employeeId || !period) {
      throw new Error("Employee ID and period are required");
    }

    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new Error("Period must be in YYYY-MM format");
    }

    // A relieved staff member has no employment past their relieving
    // month, so payroll can't be raised for anything after it.
    const employeeForPeriodCheck = await Staff.findById(employeeId)
      .select("relievingDate status")
      .session(session);
    if (
      employeeForPeriodCheck?.status === "Relieved" &&
      employeeForPeriodCheck.relievingDate
    ) {
      const relievingDate = new Date(employeeForPeriodCheck.relievingDate);
      const [pYear, pMonth] = period.split("-").map(Number);
      const periodStart = new Date(pYear, pMonth - 1, 1);
      if (relievingDate < periodStart) {
        throw new Error(
          "This staff member left the organization before this period — payroll can't be raised for a month after they left",
        );
      }
    }

    const hasManualBasicSalary =
      basicSalary !== undefined && basicSalary !== null && basicSalary !== "";
    if (
      hasManualBasicSalary &&
      (isNaN(basicSalary) || Number(basicSalary) < 0)
    ) {
      throw new Error("Basic Salary must be a valid positive number");
    }

    // Check existing payroll
    const existing = await Payroll.findOne({ employeeId, period }).session(
      session,
    );
    if (existing) {
      throw new Error("Payroll already exists for this period");
    }

    // Calculate salary (includes leave deduction, advance deduction, and
    // any pending balance carried over from the previous period).
    const salaryData = await calculateSalary(
      employeeId,
      period,
      session,
      hasManualBasicSalary ? Number(basicSalary) : null,
      advanceDeduction,
    );

    if (salaryData.advanceDeductionCapped) {
      throw new Error(
        `Advance deduction (${toFixedAmount(salaryData.advanceDeductionRequested)}) can't be more than ${toFixedAmount(salaryData.maxAdvanceDeduction)} — outstanding advance is ${toFixedAmount(salaryData.outstandingAdvance)} and this month's salary is ${toFixedAmount(salaryData.netSalary)}`,
      );
    }

    // Process allowances/deductions on top of the calculated basic salary
    const processedAllowances = (allowances || []).map((a) => ({
      type: a.type,
      amount: toFixedAmount(a.amount),
    }));
    const totalAllowance = processedAllowances.reduce(
      (sum, a) => sum + a.amount,
      0,
    );
    const processedDeductions = (deductions || []).map((d) => ({
      type: d.type,
      amount: toFixedAmount(d.amount),
    }));
    const deductionAmount = processedDeductions.reduce(
      (sum, d) => sum + d.amount,
      0,
    );

    const netSalaryExact = Math.max(
      0,
      salaryData.finalSalary + totalAllowance - deductionAmount,
    );
    const totalPayable = toFixedAmount(
      netSalaryExact + salaryData.previousPendingAmount,
    );

    // Date-wise payments (preferred): paidAmount = sum of the rows, each
    // row keeps its own Paid On date.
    const paymentEntries = normalizePaymentEntries(paymentRows);
    const hasPaymentRows = Array.isArray(paymentRows);

    // Partial payment support: paidAmount defaults to the full amount owed,
    // but can be any value from 0 up to totalPayable.
    let paidAmountValue;
    if (hasPaymentRows) {
      paidAmountValue = sumPayments(paymentEntries);
      if (paidAmountValue > totalPayable + 0.01) {
        throw new Error(
          `Payments add up to ${paidAmountValue.toLocaleString()} but only ${totalPayable.toLocaleString()} is payable for this month`,
        );
      }
      paidAmountValue = Math.min(paidAmountValue, totalPayable);
    } else {
      paidAmountValue =
        paidAmount === undefined || paidAmount === null || paidAmount === ""
          ? totalPayable
          : toFixedAmount(paidAmount);
      paidAmountValue = Math.min(Math.max(0, paidAmountValue), totalPayable);
    }
    const pendingAmount = toFixedAmount(totalPayable - paidAmountValue);

    const status =
      pendingAmount <= 0 ? "paid" : paidAmountValue > 0 ? "partial" : "pending";

    // If a source account is provided, withdraw the amount actually paid
    let sourceAccountData = null;
    if (sourceAccountId && paidAmountValue > 0) {
      const account = await Account.findById(sourceAccountId).session(session);
      if (!account) throw new Error("Source account not found");
      if (account.totalAmount < paidAmountValue) {
        throw new Error(`Insufficient balance in ${account.name}`);
      }
      account.totalAmount = toExactAmount(
        account.totalAmount - paidAmountValue,
      );
      await account.save({ session });
      sourceAccountData = { accountId: account._id, accountName: account.name };
    }

    // Recover only the amount the admin chose; the rest of the advance stays
    // outstanding for later months.
    const usedAdvances = await applyAdvanceRecovery(
      salaryData.advances,
      salaryData.advanceDeduction,
      session,
    );

    const payrollCode = await generatePayrollCode();

    const payroll = new Payroll({
      payrollCode,
      employeeId,
      period,
      basicSalary: toFixedAmount(salaryData.basicSalary),
      adjustedBasicSalary: toFixedAmount(salaryData.finalSalary),
      allowances: processedAllowances,
      totalAllowance: toFixedAmount(totalAllowance),
      deductions: processedDeductions,
      totalDeduction: toFixedAmount(deductionAmount),
      netSalary: toFixedAmount(netSalaryExact),
      netSalaryExact,
      advanceDeduction: toFixedAmount(salaryData.advanceDeduction),
      advanceBalanceAfter: toFixedAmount(salaryData.advanceBalanceAfter),
      ...referralPayrollFields(salaryData),
      previousPendingAmount: toFixedAmount(salaryData.previousPendingAmount),
      totalPayable,
      paidAmount: paidAmountValue,
      pendingAmount,
      status,
      paymentMethod,
      sourceAccount: sourceAccountData,
      bankAccount,
      // Latest date money was actually paid on this month.
      paymentDate: hasPaymentRows
        ? paymentEntries.length
          ? paymentEntries[paymentEntries.length - 1].date
          : null
        : paidAmountValue > 0
          ? new Date()
          : null,
      payments: hasPaymentRows
        ? paymentEntries.map((p) => ({
            amount: p.amount,
            date: p.date,
            method: paymentMethod,
            accountName: sourceAccountData?.accountName,
            note: p.note || (paymentEntries.length === 1 ? remarks : "") || undefined,
          }))
        : paidAmountValue > 0
          ? [
              {
                amount: paidAmountValue,
                date: new Date(),
                method: paymentMethod,
                accountName: sourceAccountData?.accountName,
                note: remarks || undefined,
              },
            ]
          : [],
      pendingDate: pendingAmount > 0 ? parseOptionalDate(pendingDate) : null,
      remarks,
      advances: usedAdvances,
      createdBy: req.user.id,
      attendanceInfo: {
        totalWorkingDays: salaryData.totalDaysInMonth,
        payableDays: salaryData.payableDays,
        unpaidLeaves: salaryData.unpaidLeaveDays,
        perDaySalary: salaryData.perDaySalary,
        effectiveDays: salaryData.effectiveDays,
        leaveDeduction: toFixedAmount(salaryData.leaveDeduction),
        lateDeduction: toFixedAmount(salaryData.lateDeduction),
        lateMinutes: salaryData.lateMinutes,
        lateDays: salaryData.lateDays,
        lateDeductionEnabled: salaryData.lateDeductionEnabled,
        referralCommission: toFixedAmount(salaryData.referralCommission || 0),
        isFull:
          salaryData.unpaidLeaveDays === 0 &&
          salaryData.payableDays === salaryData.totalDaysInMonth,
      },
    });

    await payroll.save({ session });
    await session.commitTransaction();

    const populatedPayroll = await Payroll.findById(payroll._id).populate(
      "employeeId",
      "staffName email projectName",
    );

    res.status(201).json({
      success: true,
      message:
        status === "paid"
          ? "Payroll created and paid in full"
          : `Payroll created — ${pendingAmount.toLocaleString()} remains pending and will carry over to next month`,
      data: populatedPayroll,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({
      success: false,
      message: "Failed to create payroll",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// @desc    Update payroll — status/remarks, or record an additional payment
//          against the pendingAmount (e.g. paying off a previous partial payroll)
// @route   PUT /api/payroll/:id
// @access  Private/Admin
export const updatePayroll = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      status,
      paymentMethod,
      bankAccount,
      remarks,
      additionalPayment,
      // optional — one or more further payments, each with the date it was
      // actually paid: [{ date: "2026-08-18", amount: 3500 }, ...]
      additionalPayments,
      // optional — Paid On date for a single `additionalPayment`
      paymentDate,
      sourceAccountId,
      advanceDeduction,
      pendingDate,
      // optional note stored with an additional payment ("2nd part", etc.)
      paymentNote,
    } = req.body;
    const payroll = await Payroll.findById(req.params.id).session(session);

    if (!payroll) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Payroll not found",
      });
    }

    // Changing how much advance is recovered on this payroll. Only while
    // nothing has been paid on it yet — once money has moved, the numbers
    // are locked (same rule as recalculate).
    const hasAdvanceChange =
      advanceDeduction !== undefined &&
      advanceDeduction !== null &&
      advanceDeduction !== "" &&
      toFixedAmount(advanceDeduction) !==
        toFixedAmount(payroll.advanceDeduction || 0);
    if (hasAdvanceChange) {
      if (isNaN(advanceDeduction) || Number(advanceDeduction) < 0) {
        throw new Error("Advance deduction must be 0 or a positive number");
      }
      if (payroll.status !== "pending" || (payroll.paidAmount || 0) > 0) {
        throw new Error(
          "Advance deduction can only be changed on a pending (unpaid) payroll",
        );
      }

      // Salary before any advance was taken off
      const salaryBeforeAdvance = toExactAmount(
        (payroll.adjustedBasicSalary || 0) + (payroll.advanceDeduction || 0),
      );

      await reverseAdvanceRecovery(payroll.advances, session);
      const [pYear, pMonth] = payroll.period.split("-").map(Number);
      const advances = await getOutstandingAdvances(
        payroll.employeeId,
        new Date(pYear, pMonth, 0),
        session,
      );
      const outstanding = sumOutstanding(advances);
      const maxAllowed = toExactAmount(
        Math.min(outstanding, salaryBeforeAdvance),
      );
      const newDeduction = toExactAmount(advanceDeduction);
      if (newDeduction > maxAllowed) {
        throw new Error(
          `Advance deduction can't be more than ${toFixedAmount(maxAllowed)} — outstanding advance is ${toFixedAmount(outstanding)}`,
        );
      }

      payroll.advances = await applyAdvanceRecovery(
        advances,
        newDeduction,
        session,
      );
      payroll.advanceDeduction = toFixedAmount(newDeduction);
      payroll.advanceBalanceAfter = toFixedAmount(outstanding - newDeduction);
      payroll.adjustedBasicSalary = toFixedAmount(
        Math.max(0, salaryBeforeAdvance - newDeduction),
      );
      const netSalaryExact = Math.max(
        0,
        salaryBeforeAdvance -
          newDeduction +
          (payroll.totalAllowance || 0) -
          (payroll.totalDeduction || 0),
      );
      payroll.netSalaryExact = netSalaryExact;
      payroll.netSalary = toFixedAmount(netSalaryExact);
      payroll.totalPayable = toFixedAmount(
        netSalaryExact + (payroll.previousPendingAmount || 0),
      );
      payroll.paidAmount = 0;
      payroll.pendingAmount = payroll.totalPayable;
    }

    // Recording further payment(s) against the outstanding pendingAmount.
    // Each one keeps the date it was actually paid on.
    const hasSinglePayment =
      additionalPayment !== undefined &&
      additionalPayment !== null &&
      additionalPayment !== "";
    const hasPaymentList =
      Array.isArray(additionalPayments) && additionalPayments.length > 0;
    if (hasPaymentList || hasSinglePayment) {
      const newEntries = hasPaymentList
        ? normalizePaymentEntries(additionalPayments)
        : normalizePaymentEntries([
            { amount: additionalPayment, date: paymentDate, note: paymentNote },
          ]);
      let amount = sumPayments(newEntries);
      const pendingNow = toFixedAmount(payroll.pendingAmount || 0);
      if (amount > pendingNow + 0.01) {
        throw new Error(
          `Payments add up to ${amount.toLocaleString()} but only ${pendingNow.toLocaleString()} is left to pay for this month`,
        );
      }
      amount = Math.min(amount, pendingNow);

      // Once next month's payroll exists, this month's unpaid balance has
      // already been carried into it (previousPendingAmount). Paying it
      // here as well would count the same money twice.
      if (amount > 0) {
        const carriedInto = await Payroll.findOne({
          employeeId: payroll.employeeId,
          period: getNextPeriod(payroll.period),
          enabled: { $ne: false },
          previousPendingAmount: { $gt: 0 },
        })
          .select("period")
          .session(session);
        if (carriedInto) {
          throw new Error(
            `This month's remaining balance was already carried into the ${carriedInto.period} payroll — record the payment there instead.`,
          );
        }
      }

      if (amount > 0) {
        if (sourceAccountId) {
          const account =
            await Account.findById(sourceAccountId).session(session);
          if (!account) throw new Error("Source account not found");
          if (account.totalAmount < amount) {
            throw new Error(`Insufficient balance in ${account.name}`);
          }
          account.totalAmount = toExactAmount(account.totalAmount - amount);
          await account.save({ session });
          payroll.sourceAccount = {
            accountId: account._id,
            accountName: account.name,
          };
        }

        backfillLegacyPayment(payroll);
        newEntries.forEach((p) => {
          payroll.payments.push({
            amount: p.amount,
            date: p.date,
            method: paymentMethod || payroll.paymentMethod,
            accountName: payroll.sourceAccount?.accountName,
            note:
              p.note || (newEntries.length === 1 ? paymentNote : "") || undefined,
          });
        });
        // Keep the history in the order the money was actually paid.
        payroll.payments.sort(
          (a, b) => new Date(a.date || 0) - new Date(b.date || 0),
        );
        payroll.paidAmount = toFixedAmount(payroll.paidAmount + amount);
        payroll.pendingAmount = toFixedAmount(payroll.pendingAmount - amount);
        payroll.status = payroll.pendingAmount <= 0 ? "paid" : "partial";
        const lastPaidOn = payroll.payments.length
          ? payroll.payments[payroll.payments.length - 1].date
          : null;
        payroll.paymentDate = lastPaidOn || new Date();
      }
    } else if (status) {
      payroll.status = status;
      if (status === "paid") {
        // "Mark as paid" settles whatever was still due as one payment.
        const remaining = toFixedAmount(payroll.pendingAmount || 0);
        if (remaining > 0) {
          backfillLegacyPayment(payroll);
          payroll.payments.push({
            amount: remaining,
            date: new Date(),
            method: paymentMethod || payroll.paymentMethod,
            note: paymentNote || undefined,
          });
        }
        payroll.pendingAmount = 0;
        payroll.paidAmount = payroll.totalPayable;
        payroll.paymentDate = new Date();
      }
    }

    if (paymentMethod) payroll.paymentMethod = paymentMethod;
    if (bankAccount !== undefined) payroll.bankAccount = bankAccount;
    if (remarks !== undefined) payroll.remarks = remarks;
    if (pendingDate !== undefined) {
      payroll.pendingDate = parseOptionalDate(pendingDate);
    }
    // Nothing left to pay → no pending date.
    if ((payroll.pendingAmount || 0) <= 0) payroll.pendingDate = null;

    await payroll.save({ session });
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Payroll updated successfully",
      data: payroll,
    });
  } catch (error) {
    await session.abortTransaction();
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid payroll ID",
      });
    }
    res.status(400).json({
      success: false,
      message: "Failed to update payroll",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// @desc    Recalculate a saved payroll record from current attendance/leave
//          data. ROOT CAUSE this fixes: a Payroll document's
//          attendance-derived fields (payableDays, unpaidLeaveDays,
//          effectiveDays, netSalary, ...) are computed once by
//          calculateSalary() at the moment createPayroll() runs, then just
//          saved as plain numbers on the document — nothing ever calls
//          calculateSalary() for that period again. If a payroll gets
//          generated early (e.g. an admin opens "Add Payroll" for a staff
//          member only a few days after their joining date, before the
//          rest of that month's attendance has been marked), the low
//          payableDays/netSalary from that moment is what's saved, and it
//          is what the app will show forever after — even once the month
//          is long over and the calendar shows a full month of attendance.
//          createPayroll() also refuses to run again for a period that
//          already has a record ("Payroll already exists for this
//          period"), and updatePayroll() only ever touches
//          status/payment/remarks, never the attendance-derived numbers —
//          so before this endpoint there was no way to refresh a stale
//          record at all short of deleting it and starting over.
//          Only allowed while status is "pending": a "partial"/"paid"
//          record already has real money moved against it and must not be
//          silently rewritten after the fact; "cancelled" is left alone too.
// @route   PUT /api/hrm/payroll/:id/recalculate
// @access  Private/Admin
export const recalculatePayroll = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payroll = await Payroll.findById(req.params.id).session(session);
    if (!payroll) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Payroll not found",
      });
    }

    if (payroll.status !== "pending") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Cannot recalculate a "${payroll.status}" payroll — only a pending (unpaid) record can be refreshed. Delete and re-add it instead if it truly needs to change.`,
      });
    }

    // Re-run the exact same calculation createPayroll used originally,
    // against today's attendance/leave data, keeping any manually-entered
    // allowances/deductions already on the record.
    // Advance: keep the amount the admin chose on this payroll (or use a new
    // one sent as { advanceDeduction }). Put back what it had recovered
    // first so the full balance is visible, then re-apply below.
    const requestedAdvance =
      req.body?.advanceDeduction !== undefined &&
      req.body?.advanceDeduction !== null &&
      req.body?.advanceDeduction !== ""
        ? req.body.advanceDeduction
        : payroll.advanceDeduction || 0;
    await reverseAdvanceRecovery(payroll.advances, session);
    const salaryData = await calculateSalary(
      payroll.employeeId,
      payroll.period,
      session,
      null,
      requestedAdvance,
    );
    payroll.advances = await applyAdvanceRecovery(
      salaryData.advances,
      salaryData.advanceDeduction,
      session,
    );
    payroll.advanceBalanceAfter = toFixedAmount(salaryData.advanceBalanceAfter);

    const totalAllowance = payroll.totalAllowance || 0;
    const deductionAmount = payroll.totalDeduction || 0;
    const netSalaryExact = Math.max(
      0,
      salaryData.finalSalary + totalAllowance - deductionAmount,
    );
    const totalPayable = toFixedAmount(
      netSalaryExact + salaryData.previousPendingAmount,
    );
    // Nothing has been paid against a "pending" record yet, so the full
    // recalculated amount is what's now owed.
    const paidAmountValue = 0;
    const pendingAmount = toFixedAmount(totalPayable - paidAmountValue);

    payroll.basicSalary = toFixedAmount(salaryData.basicSalary);
    payroll.adjustedBasicSalary = toFixedAmount(salaryData.finalSalary);
    payroll.netSalary = toFixedAmount(netSalaryExact);
    payroll.netSalaryExact = netSalaryExact;
    payroll.advanceDeduction = toFixedAmount(salaryData.advanceDeduction);
    payroll.previousPendingAmount = toFixedAmount(
      salaryData.previousPendingAmount,
    );
    Object.assign(payroll, referralPayrollFields(salaryData));
    payroll.totalPayable = totalPayable;
    payroll.paidAmount = paidAmountValue;
    payroll.pendingAmount = pendingAmount;
    payroll.status = "pending";
    payroll.attendanceInfo = {
      totalWorkingDays: salaryData.totalDaysInMonth,
      payableDays: salaryData.payableDays,
      unpaidLeaves: salaryData.unpaidLeaveDays,
      perDaySalary: salaryData.perDaySalary,
      effectiveDays: salaryData.effectiveDays,
      leaveDeduction: toFixedAmount(salaryData.leaveDeduction),
      lateDeduction: toFixedAmount(salaryData.lateDeduction),
      lateMinutes: salaryData.lateMinutes,
      lateDays: salaryData.lateDays,
      lateDeductionEnabled: salaryData.lateDeductionEnabled,
      referralCommission: toFixedAmount(salaryData.referralCommission || 0),
      isFull:
        salaryData.unpaidLeaveDays === 0 &&
        salaryData.payableDays === salaryData.totalDaysInMonth,
    };

    await payroll.save({ session });
    await session.commitTransaction();

    const populatedPayroll = await Payroll.findById(payroll._id).populate(
      "employeeId",
      "staffName email projectName",
    );

    res.status(200).json({
      success: true,
      message: "Payroll recalculated from current attendance data",
      data: populatedPayroll,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({
      success: false,
      message: "Failed to recalculate payroll",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// @desc    Delete payroll
// @route   DELETE /api/payroll/:id
// @access  Private/Admin
export const deletePayroll = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payroll = await Payroll.findById(req.params.id).session(session);
    if (!payroll) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Payroll not found",
      });
    }

    // Restore the source account balance for whatever was actually paid out
    if (payroll.sourceAccount?.accountId && payroll.paidAmount > 0) {
      const account = await Account.findById(
        payroll.sourceAccount.accountId,
      ).session(session);
      if (account) {
        account.totalAmount = toExactAmount(
          account.totalAmount + payroll.paidAmount,
        );
        await account.save({ session });
      }
    }

    // Reverse any advance repayments this payroll had applied
    await reverseAdvanceRecovery(payroll.advances, session);

    await Payroll.findByIdAndDelete(req.params.id).session(session);

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Payroll deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid payroll ID",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to delete payroll",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// @desc    Salary slips for the mobile "Salary Slip" tab — only PAID months
// @route   GET /api/hrm/payroll/salary-slips
// @access  Private (staff: own slips; admin: ?employeeId= or all)
// Each item can be downloaded with GET /api/hrm/payroll/:id/payslip-export
export const getMySalarySlips = async (req, res) => {
  try {
    const query = { enabled: true, status: "paid" };
    if (isAdminRole(req.user?.role)) {
      if (req.query.employeeId) query.employeeId = req.query.employeeId;
    } else {
      const ownStaff = await Staff.findOne({
        email: req.user?.email?.toLowerCase().trim(),
      }).select("_id");
      if (!ownStaff) return res.json({ success: true, count: 0, data: [] });
      query.employeeId = ownStaff._id;
    }

    const rows = await Payroll.find(query)
      .select(
        "payrollCode employeeId period basicSalary adjustedBasicSalary totalAllowance totalDeduction advanceDeduction referralCommission referral attendanceInfo netSalary netSalaryExact paidAmount paymentDate paymentMethod status payments",
      )
      .populate("employeeId", "staffName staffId projectName")
      .sort({ period: -1 })
      .lean();

    const data = rows.map((p) => {
      const lastPayment = (p.payments || []).reduce(
        (latest, x) => (!latest || new Date(x.date) > new Date(latest) ? x.date : latest),
        null,
      );
      return {
        _id: p._id,
        payrollCode: p.payrollCode,
        period: p.period,
        periodLabel: formatPeriodLabel(p.period),
        employee: p.employeeId,
        basicSalary: p.adjustedBasicSalary ?? p.basicSalary,
        totalAllowance: p.totalAllowance || 0,
        totalDeduction:
          Math.round(((p.totalDeduction || 0) + (p.advanceDeduction || 0)) * 100) / 100,
        leaveDeduction: p.attendanceInfo?.leaveDeduction || 0,
        lateDeduction: p.attendanceInfo?.lateDeduction || 0,
        advanceDeduction: p.advanceDeduction || 0,
        referralCommission: p.referralCommission || 0,
        referralOrganization: p.referral?.organizationName || "",
        referralPercent: p.referral?.percent || 0,
        netSalary: Math.round((p.netSalaryExact ?? p.netSalary ?? 0) * 100) / 100,
        paidAmount: p.paidAmount,
        paidOn: p.paymentDate || lastPayment || null,
        paymentMethod: p.paymentMethod,
        status: p.status,
        downloadUrl: `/api/hrm/payroll/${p._id}/payslip-export`,
      };
    });

    res.json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch salary slips",
      error: error.message,
    });
  }
};
