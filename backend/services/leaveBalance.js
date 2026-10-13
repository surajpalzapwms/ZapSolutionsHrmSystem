import mongoose from "mongoose";
import Leave from "../models/Leave.js";
import LeavePolicy from "../models/LeavePolicy.js";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import Attendance from "../models/Attendance.js";
import { getEffectiveConfirmationDate, isHolidayOrSunday, warmHolidayWindow } from "./leave.js";

const yearRangeUTC = (year) => ({
  start: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
  end: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
});
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// `upperBound` caps how far into the year this counts — pass the `asOf`
// date so a balance check "as of" e.g. 2026-01-12 doesn't get dragged down
// by some other same-type record dated later in that same year (2026-03-06,
// say) that happens to already exist in the DB. That can genuinely happen
// during a bulk import: rows aren't guaranteed to be processed in
// chronological order (an admin's sheet can list May before January), so a
// later-dated row may get inserted before an earlier-dated one is checked.
// Without this cap, "taken so far" silently included leave that, from the
// point of view of the date being checked, hadn't happened yet. Omit
// `upperBound` (or leave it after the year's end) to sum the whole year, as
// callers computing a fully-completed past year still want.
const countTaken = async (userId, leaveType, year, upperBound = null) => {
  const { start, end } = yearRangeUTC(year);
  const cappedEnd = upperBound && upperBound < end ? upperBound : end;
  // Sums dayValue instead of counting documents, so a half-day leave
  // (dayValue: 0.5) only deducts half a day from the staff member's
  // Paid/Sick/Casual balance instead of a full day. `$ifNull` covers
  // records saved before dayValue existed, which default to a full day.
  const result = await Leave.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        leaveType,
        status: "approved",
        leaveDate: { $gte: start, $lte: cappedEnd },
      },
    },
    { $group: { _id: null, total: { $sum: { $ifNull: ["$dayValue", 1] } } } },
  ]);
  return result[0]?.total || 0;
};

// ─── Accrual rule ────────────────────────────────────────────────────────
// Paid / Sick / Casual start accruing on the staff member's CONFIRMATION
// date (not joining date). Accrual is credited by CALENDAR MONTH, not by
// monthly anniversary day: the moment any day of a month has been worked/
// on-record, that whole month's perYear / 12 is credited — a staff member
// confirmed on 26 Sep 2025 gets all of September's 1.5 paid / 0.5 sick /
// 0.5 casual from day one (not from 26 Oct), and the moment even a single
// day of the NEXT calendar month arrives (1 Oct, no need to reach the
// 26th), that month credits too. Being present for just one date inside a
// month is enough to earn that entire month's leave across all three
// types (policy 18 / 6 / 6 => 1.5 / 0.5 / 0.5 per month).
//
//   Confirmed 26 Sep 2025, checked on 11 Sep 2026
//   -> Sep 2025, Oct 2025, Nov 2025, ... , Aug 2026, Sep 2026 (11-th day
//      already reached, so this month counts too)
//   -> 13 calendar months credited
//   -> Paid 13 x 1.5 = 19.5, Sick 13 x 0.5 = 6.5, Casual 13 x 0.5 = 6.5
//
// This is a pure calendar-month difference — no anniversary-day check, no
// "did we reach day 26 yet" gate. Every later year's accrual is still the
// plain difference between two completedMonths calls (see accruedMonths),
// so a month is only ever credited once even though the formula itself
// has no special-cased "+1".
//
// All date math is done on the India (IST) calendar day so dates saved as
// "2025-09-29T18:30:00Z" (= 30 Sep IST) and "2025-09-30T00:00:00Z" both
// read as 30 Sep.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const toParts = (date) => {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return null;
  const x = new Date(t + IST_OFFSET_MS);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate() };
};
const cmpParts = (a, b) => a.y - b.y || a.m - b.m || a.d - b.d;
const minParts = (...list) =>
  list.filter(Boolean).reduce((a, b) => (cmpParts(a, b) <= 0 ? a : b));
const yearEndParts = (year) => ({ y: year, m: 11, d: 31 });

// Whole calendar months credited between `start` (confirmation) and `end`
// (both day-parts) — a straight month-index difference, plus 1 so the
// starting month itself counts. No anniversary-day gate: as soon as `end`
// falls anywhere inside a given month (even the 1st), that month is fully
// credited. e.g. start = 26 Sep 2025, end = 1 Oct 2025 -> 2 months
// (September AND October), not 1.
const completedMonths = (start, end) => {
  if (!start || !end || cmpParts(end, start) < 0) return 0;
  const months = (end.y - start.y) * 12 + (end.m - start.m);
  return Math.max(0, months) + 1; // starting month credits immediately
};

// Cut-off for accrual = earliest of asOf / relieving date / optional cap.
const accrualCutoff = (asOf, relievingDate, cap = null) =>
  minParts(toParts(asOf) || toParts(new Date()), toParts(relievingDate), cap);

// Total completed months since confirmation, up to the cut-off.
const monthsSinceConfirmation = (confirmationDate, relievingDate, asOf) =>
  completedMonths(toParts(confirmationDate), accrualCutoff(asOf, relievingDate));

// Completed months that fall inside calendar year `year` (credited in that
// year), up to the cut-off. Used to split accrual per year for the
// carry-forward chain.
const accruedMonths = (confirmationDate, relievingDate, year, asOf) => {
  const start = toParts(confirmationDate);
  if (!start) return 0; // no confirmation date -> nothing accrued
  const cutoff = accrualCutoff(asOf, relievingDate, yearEndParts(year));
  if (cutoff.y < year) return 0;
  const upToCutoff = completedMonths(start, cutoff);
  const upToPrevYearEnd = completedMonths(start, yearEndParts(year - 1));
  return Math.max(0, upToCutoff - upToPrevYearEnd);
};

const accruedAllowance = (perYear, months) => round2((perYear * months) / 12);

const confirmationYearOf = (confirmationDate, currentYear) => {
  const parts = toParts(confirmationDate);
  return parts ? parts.y : currentYear; // not confirmed -> nothing to carry in
};

// Callers pass `staff.confirmationDate ?? null`. When that field was never
// saved (staff imported/created as "Probation" and never re-saved, missing
// probationEndDate so auto-confirm never fired, etc.) the old code treated
// the person as NEVER confirmed -> 0 balance forever -> every absence fell
// through to Unpaid. Fall back to the same effective confirmation date the
// leave-apply checks already use (joining date + confirmation/probation
// months), so balances and the "can apply after confirmation" rule agree.
const resolveAccrualStartDate = async (userId, confirmationDate) => {
  if (confirmationDate) return confirmationDate;
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;
  const staff = await Staff.findById(userId)
    .select(
      "date status internshipMonths internshipEndDate confirmationDate confirmationMonths probationMonths",
    )
    .lean();
  return getEffectiveConfirmationDate(staff);
};

// ─── Last-month-worked rule ─────────────────────────────────────────────
// Company policy: when a staff member leaves, their very last (partial)
// calendar month — the one their relieving date falls in — only earns a
// fresh Paid/Sick/Casual entitlement if they were actually "in service"
// (worked, or on a declared holiday / weekly-off) for at least
// MIN_WORKED_DAYS_LAST_MONTH days of it, counting from the 1st of that
// month through the relieving date inclusive. Fall short of that and the
// whole month is dropped from accrual — every month before it is
// untouched, and leave actually taken during that final month still
// deducts from the balance as normal (see how the result of this check is
// used in computeLeaveBalances: it only ever moves the ACCRUAL cutoff
// back, never the `asOf` used for counting leave taken).
export const MIN_WORKED_DAYS_LAST_MONTH = 20;

export const qualifiesForRelievingMonthAccrual = async (staffId, relievingDate) => {
  const rel = new Date(relievingDate);
  if (!Number.isFinite(rel.getTime())) return true;
  const year = rel.getUTCFullYear();
  const month = rel.getUTCMonth();
  const dayOfMonth = rel.getUTCDate();
  const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

  // Attendance is keyed by the linked User account, not the Staff record —
  // same lookup buildStaffCalendarPayload uses to find a staff member's
  // attendance history.
  let attendanceUserId = null;
  if (staffId && mongoose.Types.ObjectId.isValid(String(staffId))) {
    const staff = await Staff.findById(staffId).select("email").lean();
    if (staff?.email) {
      const user = await User.findOne({ email: staff.email.toLowerCase() })
        .select("_id")
        .lean();
      attendanceUserId = user?._id || null;
    }
  }

  const attendanceDays = new Set();
  if (attendanceUserId) {
    const records = await Attendance.find({
      userId: attendanceUserId,
      loginTime: { $gte: monthStart, $lte: rel },
      isLeaveDay: { $ne: true },
    })
      .select("loginTime")
      .lean();
    records.forEach((r) => attendanceDays.add(new Date(r.loginTime).getUTCDate()));
  }

  // Best-effort cache warm so the day-by-day isHolidayOrSunday calls below
  // hit memory instead of the database — see warmHolidayWindow's own
  // comment for why this matters. Falls back to per-day DB lookups if it
  // fails for any reason.
  try {
    await warmHolidayWindow(monthStart, rel);
  } catch {
    // non-fatal — isHolidayOrSunday still works without a warmed cache
  }

  let qualifyingDays = 0;
  for (let d = 1; d <= dayOfMonth; d++) {
    if (attendanceDays.has(d)) {
      qualifyingDays++;
      continue;
    }
    const { isHoliday } = await isHolidayOrSunday(new Date(Date.UTC(year, month, d)));
    if (isHoliday) qualifyingDays++;
  }
  return qualifyingDays >= MIN_WORKED_DAYS_LAST_MONTH;
};

// Given the real relieving date, returns the date accrual math should use
// instead: unchanged if the last-month-worked rule above is satisfied (or
// doesn't apply), otherwise rolled back to noon UTC on the last day of the
// PREVIOUS month so every accrual helper below (which only ever look at
// which month a cutoff date falls in) treats the final, disqualified month
// as if it never happened.
const resolveAccrualRelievingDate = async (staffId, relievingDate) => {
  if (!relievingDate) return relievingDate;
  const qualifies = await qualifiesForRelievingMonthAccrual(staffId, relievingDate);
  if (qualifies) return relievingDate;
  const rel = toParts(relievingDate);
  return new Date(Date.UTC(rel.y, rel.m, 0, 12, 0, 0, 0)); // day 0 of `rel.m` = last day of the previous month
};

// Year-over-year carry-forward chain. Only ever called for "paid" (see
// computeLeaveBalances — Sick/Casual don't carry forward, so they skip this
// entirely and are just each year's own accrual). Each year's own accrual
// is added to whatever rolled in from the year before, approved leave taken
// that year is subtracted, and the leftover rolls into the next year — all
// the way up to (but not including) `currentYear`.
const computeCarryForward = async (
  userId,
  leaveType,
  confirmationDate,
  relievingDate,
  currentYear,
  perYear,
) => {
  const firstYear = confirmationYearOf(confirmationDate, currentYear);
  let carryIn = 0; // nothing rolls in before the staff member's own confirmation year
  for (let y = firstYear; y < currentYear; y++) {
    // Noon UTC on 31 Dec is still 31 Dec in IST (23:59Z would roll into 1 Jan).
    const yearEnd = new Date(Date.UTC(y, 11, 31, 12, 0, 0, 0));
    const months = accruedMonths(confirmationDate, relievingDate, y, yearEnd);
    if (months <= 0) {
      // Not confirmed at all during year `y` (e.g. confirmation straddling
      // a year boundary) — nothing accrued and nothing to carry out of it
      // either, so the chain resets rather than silently keeping a stale
      // carryIn alive across a gap year.
      carryIn = 0;
      continue;
    }
    const accrued = accruedAllowance(perYear, months);
    const availableThatYear = round2(accrued + carryIn); // this year's own accrual + whatever rolled in
    const taken = await countTaken(userId, leaveType, y);
    // Leftover rolls into the NEXT year. It may be NEGATIVE: paid leave
    // taken in advance in the confirmation year (see advancePaidLimit) is
    // more than was really earned, and that shortfall is a debt deducted
    // from next year's accrual. e.g. confirmed Nov 2025 -> earned 2 x 1.5
    // = 3, took 15 -> carries -12 into 2026.
    carryIn = round2(availableThatYear - taken);
  }
  return carryIn; // this is what finally rolls into `currentYear`
};


// ─── Shared Sick + Casual pool & half-day rounding ──────────────────────
// Rule (asked for by the business, policy 16.5 / 3.5 / 3.5):
//
//   1. Sick and Casual share ONE pool = sickAllotted + casualAllotted
//      (3.5 + 3.5 = 7). Staff can split it 3 sick + 4 casual, 4 + 3,
//      3.5 + 3.5 … as long as the two together never exceed the pool.
//      Each type may go over its own allotment only up to the next whole
//      day (3.5 -> max 4), so the pool can't be spent entirely on one type.
//
//   2. Paid may also round UP to the next whole day (16.5 -> 17) by
//      borrowing the missing fraction from the Sick + Casual pool. What
//      paid borrows is removed from the pool, so the grand total stays
//      16.5 + 3.5 + 3.5 = 23.5 — nobody gets extra days, the half days
//      just stop being wasted.
//
//   3. The pool never lends to Paid beyond that rounding fraction, and
//      Paid never lends to Sick/Casual (unused Paid carries forward,
//      Sick/Casual expire on 31 Dec, so borrowing that way would cost
//      the staff member carried-forward days).
//
// Half-day leaves (dayValue 0.5) work the same way — everything is in days.
const EPS = 1e-9;
const roundUpToWholeDay = (n) => Math.ceil(round2(n) - EPS);

const applySharedPool = ({
  paidAllotted,
  sickAllotted,
  casualAllotted,
  paidTaken,
  sickTaken,
  casualTaken,
}) => {
  const poolAllotted = round2(sickAllotted + casualAllotted);

  // Anything Paid has already taken above its own allotment came out of
  // the pool.
  const paidBorrowed = round2(Math.max(0, paidTaken - paidAllotted));
  const poolRemaining = round2(
    Math.max(0, poolAllotted - sickTaken - casualTaken - paidBorrowed),
  );

  // Paid: own balance + (rounding fraction, only if the pool can cover it).
  const paidOwnRemaining = round2(Math.max(0, paidAllotted - paidTaken));
  const paidCap = roundUpToWholeDay(paidAllotted); // 16.5 -> 17
  const paidRemaining = round2(
    Math.max(0, Math.min(paidCap - paidTaken, paidOwnRemaining + poolRemaining)),
  );
  const paidBorrowable = round2(Math.max(0, paidRemaining - paidOwnRemaining));
  // Paid days recorded beyond what the rules allow (own allotment rounded up
  // to a whole day). Should be 0 — anything above it needs to be changed to
  // Unpaid by an admin.
  const paidOverLimit = round2(Math.max(0, paidTaken - paidCap));

  // Sick / Casual: limited by the shared pool, and each by its own
  // allotment rounded up to a whole day (3.5 -> 4).
  const sickRemaining = round2(
    Math.max(0, Math.min(roundUpToWholeDay(sickAllotted) - sickTaken, poolRemaining)),
  );
  const casualRemaining = round2(
    Math.max(0, Math.min(roundUpToWholeDay(casualAllotted) - casualTaken, poolRemaining)),
  );

  return {
    poolAllotted,
    poolRemaining,
    paidBorrowed,
    paidOwnRemaining,
    paidBorrowable,
    paidRemaining,
    paidOverLimit,
    sickRemaining,
    casualRemaining,
  };
};


// `confirmationDate` (Staff.confirmationDate) is what gates ALL accrual here
// — Paid, Sick, and Casual alike. A staff member still on Probation (no
// confirmationDate set) has 0 accrued for every type; the moment they're
// confirmed, all three types start accruing together from that date
// (1.5/month paid, 0.5/month sick, 0.5/month casual by default policy —
// pro-rated by whatever the current LeavePolicy actually says).
//
// Carry-forward differs by type (see the field comments on LeavePolicy):
// only PAID leave rolls unused days into the next year. Sick and Casual
// are "use it or lose it" — whatever's unused when the calendar year ends
// is gone; each new year's Sick/Casual balance is just that year's own
// accrual, nothing more.
// Months of `year` that count when the FULL annual entitlement applies
// (see `fullYearEntitlement` below): every month of that year from the
// confirmation month through December (or through the relieving month).
//
// In the confirmation year only the real months are counted here; the
// extra paid leave allowed in advance for that year comes from
// policy.advancePaidLimit (see computeLeaveBalances).
const fullYearMonths = (confirmationDate, relievingDate, year) => {
  const start = toParts(confirmationDate);
  if (!start || start.y > year) return 0;
  const rel = toParts(relievingDate);
  if (rel && rel.y < year) return 0;
  const firstMonth = start.y === year ? start.m : 0; // confirmation month counts
  const lastMonth = rel && rel.y === year ? rel.m : 11;
  return Math.max(0, lastMonth - firstMonth + 1);
};

// Noon UTC on 31 Dec is still 31 Dec in IST (23:59Z would roll into 1 Jan).
export const yearEndAsOf = (year) => new Date(Date.UTC(year, 11, 31, 12, 0, 0, 0));

// options.fullYearEntitlement — when true, the year of `asOf` is credited
// with the WHOLE policy allowance (e.g. 13.5 paid / 3.5 sick / 3.5 casual)
// instead of only the months since the confirmation date. Used for
// backfilling leave that already happened (Excel import and the sandwich
// days it creates): a staff member confirmed in September who is entitled
// to 13.5 paid days a year must still be able to have 24–27 Nov recorded
// as Paid. Live apply/approve requests don't pass this, so they keep
// pacing by the real month-by-month accrual.
//
// options.takenThroughYearEnd — accrual (what is EARNED) still stops at
// `asOf` (month by month from the confirmation month), but approved leave
// dated later in the same year (e.g. imported / pre-approved Nov-Dec leave)
// is also counted as TAKEN. Used by the Leave page and the calendar balance
// line so they show "earned so far" and still don't offer days that are
// already booked.
//
// options.includeMonthly — also return `monthly` (month-by-month ledger).
export const computeLeaveBalances = async (
  userId,
  confirmationDate,
  policy,
  asOf = new Date(),
  relievingDate = null,
  options = {},
) => {
  const p = policy || (await LeavePolicy.getSingleton());
  const currentYear = toParts(asOf)?.y ?? asOf.getFullYear();

  confirmationDate = await resolveAccrualStartDate(userId, confirmationDate);

  // Accrual (month-crediting) math uses `accrualRelievingDate`, which rolls
  // back to exclude the final month entirely when the staff member didn't
  // meet the last-month-worked rule — see resolveAccrualRelievingDate. Any
  // leave actually TAKEN still uses the real `relievingDate`/`asOf` further
  // down (countTaken, computeCarryForward's own `taken` lookups), so this
  // only ever affects how much NEW leave is earned for that final month,
  // never what was already used.
  const accrualRelievingDate = await resolveAccrualRelievingDate(userId, relievingDate);

  const currentYearMonths = options.fullYearEntitlement
    ? fullYearMonths(confirmationDate, accrualRelievingDate, currentYear)
    : accruedMonths(confirmationDate, accrualRelievingDate, currentYear, asOf);
  const totalMonths = monthsSinceConfirmation(confirmationDate, accrualRelievingDate, asOf);
  // Months actually earned as of TODAY (capped to `asOf`). When `asOf` is
  // 31 Dec (the yearly view) this tells the UI how much of the year's
  // entitlement has already been credited month-by-month.
  const now = new Date();
  const earnedAsOf = now < new Date(asOf) ? now : asOf;
  const monthsEarnedToDate =
    toParts(earnedAsOf)?.y === currentYear
      ? accruedMonths(confirmationDate, accrualRelievingDate, currentYear, earnedAsOf)
      : currentYearMonths;

  // Where "taken" stops counting for the current year.
  const takenUpTo = options.takenThroughYearEnd ? yearEndAsOf(currentYear) : asOf;

  const [paidTaken, sickTaken, casualTaken, paidCarry] =
    await Promise.all([
      // Capped at `asOf` — see countTaken's comment on why the current
      // (possibly still-in-progress-from-this-row's-perspective) year
      // can't just sum the whole year like a completed past year can.
      countTaken(userId, "paid", currentYear, takenUpTo),
      countTaken(userId, "sick", currentYear, takenUpTo),
      countTaken(userId, "casual", currentYear, takenUpTo),
      computeCarryForward(
        userId,
        "paid",
        confirmationDate,
        accrualRelievingDate,
        currentYear,
        p.paidPerYear,
      ),
    ]);
  // Sick and Casual never carry forward — each year starts at 0 rolled-in
  // balance, no matter how much was left unused the year before.
  const sickCarry = 0;
  const casualCarry = 0;

  // ── Own balances (what each type earned on its own) ─────────────────
  const paidAccrued = accruedAllowance(p.paidPerYear, currentYearMonths);
  // paidCarry < 0 means advance leave from last year is still being paid
  // back: it eats this year's accrual first, and until it is covered the
  // paid balance stays at 0 (so new leave is recorded as Unpaid).
  let paidAllotted = round2(Math.max(0, paidAccrued + paidCarry));
  const advanceDebt = round2(Math.max(0, -paidCarry));
  const debtStillOpen = round2(Math.max(0, -(paidAccrued + paidCarry)));

  // Advance leave: in the CONFIRMATION year, backfill/year views
  // (fullYearEntitlement) may record paid leave up to advancePaidLimit
  // (default 15) even though only a few months were earned. The part above
  // real accrual becomes next year's debt via computeCarryForward.
  const confirmationYear = toParts(confirmationDate)?.y ?? null;
  const advanceLimit = Number(p.advancePaidLimit ?? 15) || 0;
  let paidAdvanceAllowed = 0;
  if (
    options.fullYearEntitlement &&
    confirmationYear === currentYear &&
    advanceLimit > paidAllotted
  ) {
    paidAdvanceAllowed = round2(advanceLimit - paidAllotted);
    paidAllotted = round2(advanceLimit);
  }
  const sickAccrued = accruedAllowance(p.sickPerYear, currentYearMonths);
  const sickAllotted = round2(sickAccrued + sickCarry);
  const casualAccrued = accruedAllowance(p.casualPerYear, currentYearMonths);
  const casualAllotted = round2(casualAccrued + casualCarry);

  // ── Paid totals since confirmation (all years together) ─────────────
  // The Leave page shows paid leave as ONE running total from the
  // confirmation date to today / the relieving date, e.g.
  //   2025: earned 4.5 (Oct-Dec), taken 12 (7.5 in advance)
  //   2026: earned 10.5 (Jan-Jul), taken 3
  //   total: earned 15, taken 15, remaining 0
  const paidByYear = [];
  const firstPaidYear = toParts(confirmationDate)?.y;
  if (firstPaidYear !== undefined && firstPaidYear <= currentYear) {
    for (let y = firstPaidYear; y <= currentYear; y++) {
      const isCurrent = y === currentYear;
      const months = isCurrent
        ? currentYearMonths
        : accruedMonths(confirmationDate, accrualRelievingDate, y, yearEndAsOf(y));
      const taken = isCurrent ? paidTaken : await countTaken(userId, "paid", y);
      if (months <= 0 && taken <= 0) continue;
      paidByYear.push({
        year: y,
        earned: accruedAllowance(p.paidPerYear, months),
        taken: round2(taken),
      });
    }
  }
  const paidTotalEarned = round2(paidByYear.reduce((a, r) => a + r.earned, 0));
  const paidTotalTaken = round2(paidByYear.reduce((a, r) => a + r.taken, 0));

  // ── Shared Sick + Casual pool & half-day rounding ───────────────────
  // See applySharedPool below for the full rule. With a 16.5 / 3.5 / 3.5
  // policy a full year gives:
  //   Paid          : up to 17   (16.5 own + 0.5 borrowed from the pool)
  //   Sick + Casual : 7 shared   (3 + 4, 4 + 3, 3.5 + 3.5 …)
  //   Grand total   : never more than 23.5 days overall.
  const shared = applySharedPool({
    paidAllotted,
    sickAllotted,
    casualAllotted,
    paidTaken,
    sickTaken,
    casualTaken,
  });

  // Optional month-by-month statement (confirmation month -> asOf /
  // relieving month). Only built when asked for, e.g. by the Full & Final
  // Settlement, because it runs one extra aggregation.
  const monthly = options.includeMonthly
    ? await buildMonthlyLedger({
        userId,
        confirmationDate,
        accrualRelievingDate,
        relievingDate,
        asOf,
        takenUpTo,
        policy: p,
      })
    : undefined;

    return {
    year: currentYear,
    ...(monthly ? { monthly } : {}),
    // Effective date accrual started from (stored or derived confirmation date).
    accrualStartDate: confirmationDate ? new Date(confirmationDate) : null,
    // Whether the staff member's final (relieving) calendar month met the
    // "worked/holiday at least 20 days of it" rule and so earned a fresh
    // month's Paid/Sick/Casual accrual. `null` when there's no relieving
    // date at all (rule doesn't apply / staff hasn't left).
    relievingMonthAccrualQualified: relievingDate
      ? accrualRelievingDate.getTime() === new Date(relievingDate).getTime()
      : null,
    // Completed months credited in `year` / since confirmation overall.
    monthsAccrued: currentYearMonths,
    monthsSinceConfirmation: totalMonths,
    monthsEarnedToDate,
    paid: {
      perYear: p.paidPerYear,
      perMonth: round2(p.paidPerYear / 12),
      accruedThisYear: paidAccrued,
      // Part of this year's accrual already credited as of today.
      earnedToDate: accruedAllowance(p.paidPerYear, monthsEarnedToDate),
      // Negative = advance leave from last year being paid back.
      carriedForward: paidCarry,
      // Advance paid leave from the previous year still owed at the start
      // of this year, and how much of it this year's accrual has not yet
      // covered (as of `asOf`).
      advanceDebt,
      advanceDebtRemaining: debtStillOpen,
      // Extra paid allowed in advance this (confirmation) year, above what
      // is really earned. Becomes next year's debt once used.
      advanceAllowed: paidAdvanceAllowed,
      allotted: paidAllotted,
      taken: paidTaken,
      // Left from paid's OWN allotment (no borrowing).
      ownRemaining: shared.paidOwnRemaining,
      // Extra that can be borrowed from the Sick + Casual pool right now
      // to round paid up to a whole day (e.g. 0.5 when allotted is 16.5).
      borrowable: shared.paidBorrowable,
      // Already borrowed from the pool this year (paid taken above allotted).
      borrowed: shared.paidBorrowed,
      // What can actually still be taken as Paid (own + borrowable). This
      // is the number every apply / approve / import check uses.
      remaining: shared.paidRemaining,
      // Paid days recorded above the allowed limit (should be 0).
      overLimit: shared.paidOverLimit,
      // Running total from the confirmation date across all years.
      sinceConfirmation: {
        earned: paidTotalEarned,
        taken: paidTotalTaken,
        byYear: paidByYear,
      },
    },
    sick: {
      perYear: p.sickPerYear,
      perMonth: round2(p.sickPerYear / 12),
      accruedThisYear: sickAccrued,
      carriedForward: sickCarry,
      allotted: sickAllotted,
      taken: sickTaken,
      takenThisYear: sickTaken,
      // Max that can still be taken as Sick (shares the pool with Casual).
      remaining: shared.sickRemaining,
    },
    casual: {
      perYear: p.casualPerYear,
      perMonth: round2(p.casualPerYear / 12),
      accruedThisYear: casualAccrued,
      carriedForward: casualCarry,
      allotted: casualAllotted,
      taken: casualTaken,
      takenThisYear: casualTaken,
      // Max that can still be taken as Casual (shares the pool with Sick).
      remaining: shared.casualRemaining,
    },
    // Combined Sick + Casual pool. `remaining` here is the real number of
    // days left across BOTH types — sick.remaining and casual.remaining
    // must NOT be added together (they come out of the same pool).
    sickCasualPool: {
      allotted: shared.poolAllotted,
      taken: round2(sickTaken + casualTaken),
      usedByPaid: shared.paidBorrowed,
      remaining: shared.poolRemaining,
    },
  };
};

// ─── Month-by-month leave statement ─────────────────────────────────────
// Explains how the final balance was reached, one row per calendar month
// from the confirmation month to the asOf / relieving month:
//
//   Sep 2025  earned 1.5 P + 0.5 S + 0.5 C = 2.5   taken 1 P        bal P 0.5  S+C 1
//   ...
//   Jan 2026  (Paid 3.5 carried forward from 2025, Sick+Casual 2 lapsed)
//
// Uses exactly the same rules as computeLeaveBalances / computeCarryForward:
//   * a month earns perYear / 12 of each type once any day of it is reached
//     (monthly amounts are taken as differences of the yearly accrued
//     total, so they always add up to the same figure the balance uses);
//   * the relieving month earns nothing if the 20-day rule failed
//     (accrualRelievingDate already rolls back for that);
//   * only Paid carries into the next year (a negative carry = advance
//     leave being paid back); Sick + Casual lapse on 31 Dec;
//   * leave is summed by dayValue (half days = 0.5), approved only.
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;

const buildMonthlyLedger = async ({
  userId,
  confirmationDate,
  accrualRelievingDate,
  relievingDate,
  asOf,
  takenUpTo = null,
  policy,
}) => {
  const start = toParts(confirmationDate);
  if (!start) return { months: [], years: [], totals: null };

  // Last month shown = the month of asOf, or of the real relieving date if
  // that is earlier (leave taken in the final month is always shown, even
  // when that month earned nothing).
  let end = minParts(toParts(asOf) || toParts(new Date()), toParts(relievingDate));
  if (cmpParts(end, start) < 0) return { months: [], years: [], totals: null };

  // Accrual stops at the (possibly rolled-back) relieving date.
  const accrualEnd = accrualCutoff(asOf, accrualRelievingDate);

  // All approved Paid/Sick/Casual/Unpaid leave from 1 Jan of the
  // confirmation year up to asOf, grouped by calendar month. Leave dates are
  // stored as UTC midnight, the same basis countTaken uses.
  const rangeStart = new Date(Date.UTC(start.y, 0, 1, 0, 0, 0, 0));
  const upper = takenUpTo ? new Date(takenUpTo) : asOf ? new Date(asOf) : new Date();
  const rows = await Leave.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        status: "approved",
        leaveType: { $in: ["paid", "sick", "casual", "unpaid"] },
        leaveDate: { $gte: rangeStart, $lte: upper },
      },
    },
    {
      $group: {
        _id: {
          y: { $year: "$leaveDate" },
          m: { $month: "$leaveDate" },
          t: "$leaveType",
        },
        total: { $sum: { $ifNull: ["$dayValue", 1] } },
      },
    },
  ]);
  const takenMap = new Map(); // "YYYY-MM" -> { paid, sick, casual, unpaid }
  rows.forEach((r) => {
    const key = monthKey(r._id.y, r._id.m - 1);
    if (!takenMap.has(key)) takenMap.set(key, { paid: 0, sick: 0, casual: 0, unpaid: 0 });
    takenMap.get(key)[r._id.t] = round2(r.total);
  });
  const takenFor = (y, m) => takenMap.get(monthKey(y, m)) || { paid: 0, sick: 0, casual: 0, unpaid: 0 };

  // Leave that is already approved for a LATER month of the final year (see
  // takenThroughYearEnd) gets its own row — those months earn nothing yet
  // (`credited: false`) but the days are already used, so the ledger's
  // closing balance matches the headline numbers.
  if (takenUpTo) {
    for (const key of takenMap.keys()) {
      const [ky, km] = key.split("-").map(Number);
      const cand = { y: ky, m: km - 1, d: 1 };
      if (ky === end.y && cmpParts(cand, { ...end, d: 1 }) > 0) end = cand;
    }
  }

  const months = [];
  const years = [];
  let paidCarry = 0; // rolls from one year into the next (Paid only)

  for (let y = start.y; y <= end.y; y++) {
    const firstM = y === start.y ? start.m : 0;
    const lastM = y === end.y ? end.m : 11;

    // Paid carried in from last year; Sick+Casual left over last year lapse.
    const prevYear = years[years.length - 1];
    const carriedIn = y === start.y ? 0 : paidCarry;
    const lapsed = prevYear ? Math.max(0, prevYear.closing.sickCasual) : 0;

    let paidBal = carriedIn;
    let scBal = 0;
    let creditedInYear = 0; // months credited so far this year
    const yr = {
      year: y,
      paidCarriedIn: round2(carriedIn),
      sickCasualLapsed: round2(lapsed),
      earned: { paid: 0, sick: 0, casual: 0, total: 0 },
      taken: { paid: 0, sick: 0, casual: 0, total: 0, unpaid: 0 },
      closing: null,
    };

    // Leave taken in the confirmation year BEFORE the confirmation month
    // still counts against that year (computeCarryForward counts the whole
    // year), so show it on its own rows rather than silently dropping it.
    if (y === start.y) {
      for (let m = 0; m < firstM; m++) {
        const t = takenFor(y, m);
        if (!(t.paid || t.sick || t.casual || t.unpaid)) continue;
        paidBal = round2(paidBal - t.paid);
        scBal = round2(scBal - t.sick - t.casual);
        const takenTotal = round2(t.paid + t.sick + t.casual);
        months.push({
          period: monthKey(y, m),
          label: `${MONTH_SHORT[m]} ${y}`,
          beforeConfirmation: true,
          credited: false,
          earned: { paid: 0, sick: 0, casual: 0, total: 0 },
          taken: { ...t, total: takenTotal },
          balance: { paid: paidBal, sickCasual: scBal, total: round2(paidBal + scBal) },
        });
        yr.taken.paid += t.paid;
        yr.taken.sick += t.sick;
        yr.taken.casual += t.casual;
        yr.taken.unpaid += t.unpaid;
      }
    }

    for (let m = firstM; m <= lastM; m++) {
      const credited = cmpParts({ y, m, d: 1 }, { ...accrualEnd, d: 1 }) <= 0;
      let earned = { paid: 0, sick: 0, casual: 0 };
      if (credited) {
        const before = creditedInYear;
        creditedInYear += 1;
        const diff = (perYear) =>
          round2(accruedAllowance(perYear, creditedInYear) - accruedAllowance(perYear, before));
        earned = {
          paid: diff(policy.paidPerYear),
          sick: diff(policy.sickPerYear),
          casual: diff(policy.casualPerYear),
        };
      }
      const t = takenFor(y, m);
      paidBal = round2(paidBal + earned.paid - t.paid);
      scBal = round2(scBal + earned.sick + earned.casual - t.sick - t.casual);

      const earnedTotal = round2(earned.paid + earned.sick + earned.casual);
      const takenTotal = round2(t.paid + t.sick + t.casual);
      months.push({
        period: monthKey(y, m),
        label: `${MONTH_SHORT[m]} ${y}`,
        credited,
        // First month of a new year: Paid carried in, Sick+Casual lapsed.
        ...(m === firstM && y !== start.y
          ? { paidCarriedIn: round2(carriedIn), sickCasualLapsed: round2(lapsed) }
          : {}),
        earned: { ...earned, total: earnedTotal },
        taken: { ...t, total: takenTotal },
        balance: { paid: paidBal, sickCasual: scBal, total: round2(paidBal + scBal) },
      });

      yr.earned.paid += earned.paid;
      yr.earned.sick += earned.sick;
      yr.earned.casual += earned.casual;
      yr.taken.paid += t.paid;
      yr.taken.sick += t.sick;
      yr.taken.casual += t.casual;
      yr.taken.unpaid += t.unpaid;
    }

    ["paid", "sick", "casual"].forEach((k) => {
      yr.earned[k] = round2(yr.earned[k]);
      yr.taken[k] = round2(yr.taken[k]);
    });
    yr.taken.unpaid = round2(yr.taken.unpaid);
    yr.earned.total = round2(yr.earned.paid + yr.earned.sick + yr.earned.casual);
    yr.taken.total = round2(yr.taken.paid + yr.taken.sick + yr.taken.casual);
    yr.closing = { paid: paidBal, sickCasual: scBal, total: round2(paidBal + scBal) };
    years.push(yr);

    // Same chain as computeCarryForward: a year with no credited month
    // resets the carry instead of keeping a stale one alive.
    paidCarry = creditedInYear > 0 ? paidBal : 0;
  }

  const sum = (pick) => round2(years.reduce((a, yr) => a + pick(yr), 0));
  const last = years[years.length - 1];
  const totals = {
    earned: {
      paid: sum((r) => r.earned.paid),
      sick: sum((r) => r.earned.sick),
      casual: sum((r) => r.earned.casual),
      total: sum((r) => r.earned.total),
    },
    taken: {
      paid: sum((r) => r.taken.paid),
      sick: sum((r) => r.taken.sick),
      casual: sum((r) => r.taken.casual),
      total: sum((r) => r.taken.total),
      unpaid: sum((r) => r.taken.unpaid),
    },
    // Paid carried into the final year and Sick+Casual that lapsed over
    // all the year-ends.
    paidCarriedIntoFinalYear: last.paidCarriedIn,
    sickCasualLapsed: sum((r) => r.sickCasualLapsed),
    finalYear: last.year,
    finalYearEarned: last.earned,
    finalYearTaken: last.taken,
    closing: last.closing,
  };

  return { months, years, totals };
};

// Remaining days available for a specific balance-tracked type. Used by the
// apply/approve flows to block over-drawing a balance. Already accounts for
// the shared Sick + Casual pool and Paid's half-day round-up, so callers
// don't need to do anything special.
export const getRemainingForType = async (
  userId,
  confirmationDate,
  leaveType,
  asOf = new Date(),
  relievingDate = null,
  options = {},
) => {
  const balances = await computeLeaveBalances(userId, confirmationDate, null, asOf, relievingDate, options);
  if (leaveType === "paid") return balances.paid.remaining;
  if (leaveType === "sick") return balances.sick.remaining;
  if (leaveType === "casual") return balances.casual.remaining;
  return Infinity;
};

// Real days left in the shared Sick + Casual pool. Use this instead of
// adding sick.remaining + casual.remaining (that would count the pool twice).
export const getSickCasualPoolRemaining = async (
  userId,
  confirmationDate,
  asOf = new Date(),
  relievingDate = null,
  options = {},
) => {
  const balances = await computeLeaveBalances(userId, confirmationDate, null, asOf, relievingDate, options);
  return balances.sickCasualPool.remaining;
};

// Unpaid leave is only meant to be a last resort — a staff member should
// draw down Sick, Casual, and Paid first. This returns the first of those
// three (checked in Sick, Casual, Paid order) that still has at least
// `minRemaining` day(s) left, or null if all three are exhausted and Unpaid
// is genuinely the only option. Used to gate the "unpaid" leaveType on the
// apply endpoints the same way `getRemainingForType` gates paid/sick/casual.
export const getBlockingTrackedTypeForUnpaid = async (
  userId,
  confirmationDate,
  relievingDate = null,
  asOf = new Date(),
  minRemaining = 0.01,
) => {
  const balances = await computeLeaveBalances(
    userId,
    confirmationDate,
    null,
    asOf,
    relievingDate,
  );
  const priorityOrder = ["sick", "casual", "paid"];
  for (const type of priorityOrder) {
    if ((balances[type]?.remaining ?? 0) >= minRemaining) return type;
  }
  return null;
};
