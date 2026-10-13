// backend/services/leaveAutomation.js

import Leave from "../models/Leave.js";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import Attendance from "../models/Attendance.js";
import {
  isHolidayOrSunday,
  getDayRange,
  getEffectiveConfirmationDate,
  istDayKey,
  attendanceDayKey,
} from "./leave.js";
import {
  computeLeaveBalances,
  getRemainingForType,
} from "./leaveBalance.js";

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const BRIDGEABLE_TYPES = ["paid", "sick", "casual", "unpaid"];

// Balance-tracked types that must ALL still have something pending for a
// Sat+Mon style bracket to leave the Sunday/holiday as a normal holiday.
const BALANCE_TYPES = ["paid", "sick", "casual"];

/*
 * SANDWICH RULE
 * -------------
 * A "block" is one or more consecutive Sundays/holidays. It is judged by
 * the approved (non-sandwich) leave that touches it on each side:
 *
 * 1. Long PAID leave: Paid leave right before AND right after the block,
 *    and the continuous Paid leave run through it is MORE THAN
 *    PAID_RUN_THRESHOLD (3) days (Sundays/holidays inside are not counted):
 *      - Paid balance covers EVERY day of the block -> whole block PAID.
 *      - otherwise                                  -> falls through to rule 2.
 *    (A block is never split into some Paid + some Unpaid days.)
 *
 * 2. Any leave right BEFORE and right AFTER the block (only Sat + Mon, or a
 *    longer continuous leave):
 *      - any one of Paid / Sick / Casual has nothing pending
 *          -> the block becomes UNPAID leave.
 *      - Paid, Sick AND Casual all still have balance pending
 *          -> the block stays a normal Sunday/holiday.
 *
 * 3. "Joining": continuous leave of MORE THAN JOINING_RUN_THRESHOLD (3)
 *    days — i.e. 4 or more; Sundays/holidays inside are stepped over, not
 *    counted — right BEFORE the block, and the staff member joins back on
 *    the next working day (no leave after it, e.g. leave Mon-Sat, joins
 *    Monday):
 *      - NONE of Paid / Sick / Casual has any balance left
 *          -> the block becomes UNPAID leave.
 *      - any balance still left -> the block stays a normal Sunday/holiday.
 *    A short leave (e.g. only Fri + Sat, then present on Monday) never
 *    makes the Sunday leave.
 *
 *    "Starting" (the mirror case: leave starts right AFTER the block, with
 *    no leave before it) uses the same check, but only when
 *    APPLY_STARTING_RULE is true. It is switched OFF.
 *
 * 4. Anything else (a single leave day on one side only, or no leave
 *    around it) -> holiday only.
 */
const MIN_BRACKET_RUN = 1;

// Continuous Paid leave must be MORE than this many days for the
// Sunday/holiday inside it to count as Paid leave (i.e. 4 or more).
const PAID_RUN_THRESHOLD = 3;

// Rule 3: the continuous leave on one side must be MORE than this many
// days (i.e. 4 or more) for the Sunday/holiday next to it to count.
const JOINING_RUN_THRESHOLD = 3;

// Rule 3 mirror case (leave starting right after the Sunday/holiday with
// no leave before it). Switched off; set to true to apply it.
const APPLY_STARTING_RULE = false;

const SANDWICH_TYPES = ["paid", "sick", "casual", "unpaid"];

const addDaysUTC = (date, days) => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

const dateKey = (date) => new Date(date).toISOString().slice(0, 10);

const findLeaveOn = async (userId, date, statuses, session = null) => {
  const { start, end } = getDayRange(date);
  let q = Leave.findOne({
    userId,
    leaveDate: { $gte: start, $lte: end },
    ...(statuses ? { status: { $in: statuses } } : {}),
  });
  if (session) q = q.session(session);
  return q;
};

const findRealLeaveOn = async (userId, date, session = null) => {
  const { start, end } = getDayRange(date);
  let q = Leave.findOne({
    userId,
    leaveDate: { $gte: start, $lte: end },
    status: "approved",
    isSandwich: { $ne: true },
    leaveType: { $in: BRIDGEABLE_TYPES },
  });
  if (session) q = q.session(session);
  return q;
};

// Walks from `date` in direction `step` over Sundays/holidays and returns
// the first working day reached (the day that brackets the block).
const findBracketDay = async (date, step) => {
  let cursor = addDaysUTC(date, step);
  for (let guard = 0; guard < 30; guard++) {
    if (!(await isHolidayOrSunday(cursor)).isHoliday) break;
    cursor = addDaysUTC(cursor, step);
  }
  return cursor;
};

// DB-backed count of consecutive real approved leave days starting at
// `startDate` and walking in `step` direction. Stops at 2 because the rule
// only needs to know whether there is leave on that side at all.
const countRealLeaveRunFromDb = async (userId, startDate, step, session) => {
  let count = 0;
  let cursor = new Date(startDate);
  while (count < 2) {
    const lv = await findRealLeaveOn(userId, cursor, session);
    if (!lv) break;
    count += 1;
    cursor = addDaysUTC(cursor, step);
  }
  return count;
};

// Single-leave entry point. Delegates to the range-based reconciler over a
// small window around this leave's date, so single apply/edit/approve/delete
// and bulk range/import flows all share exactly the same rule.
export const reconcileSandwichLeave = async (leave, session = null) => {
  if (!leave || !BRIDGEABLE_TYPES.includes(leave.leaveType)) return [];
  const WINDOW_DAYS = 14;
  return reconcileSandwichLeaveForRange(
    leave.userId,
    addDaysUTC(leave.leaveDate, -WINDOW_DAYS),
    addDaysUTC(leave.leaveDate, WINDOW_DAYS),
    session,
  );
};

/**
 * Order-independent sandwich reconciler for one staff member over
 * `fromDate`..`toDate` (padded). Applies the SANDWICH RULE above to every
 * Sunday/holiday block in the span: creates the Unpaid sandwich day(s) a
 * block needs, and removes sandwich day(s) a block no longer needs (e.g.
 * the Monday leave was deleted, a Tuesday leave was added making it a
 * longer run, or the balance situation changed). Idempotent.
 * Returns the array of newly created sandwich Leave documents.
 */
export const reconcileSandwichLeaveForRange = async (
  userId,
  fromDate,
  toDate,
  session = null,
) => {
  const PAD_DAYS = 14;
  const LOOKAROUND_DAYS = 31;
  const rangeStart = addDaysUTC(fromDate, -PAD_DAYS);
  const rangeEnd = addDaysUTC(toDate, PAD_DAYS);
  const fetchStart = addDaysUTC(rangeStart, -LOOKAROUND_DAYS);
  const fetchEnd = addDaysUTC(rangeEnd, LOOKAROUND_DAYS);

  let q = Leave.find({
    userId,
    leaveDate: { $gte: fetchStart, $lte: fetchEnd },
  });
  if (session) q = q.session(session);
  const existingLeaves = await q;

  // Real (non-sandwich) approved leave per date, and sandwich records per
  // date (a date can hold more than one record from older split days).
  const realByDate = new Map();
  const sandwichByDate = new Map();
  // Dates an admin explicitly marked as a holiday for this staff member
  // (leaveType "holiday"). They count as non-working days, and a sandwich
  // leave is never put on them.
  const adminHolidayDates = new Set();
  for (const lv of existingLeaves) {
    const key = dateKey(lv.leaveDate);
    if (lv.leaveType === "holiday") {
      if (lv.status === "approved") adminHolidayDates.add(key);
    } else if (lv.isSandwich) {
      if (!sandwichByDate.has(key)) sandwichByDate.set(key, []);
      sandwichByDate.get(key).push(lv);
    } else if (
      lv.status === "approved" &&
      BRIDGEABLE_TYPES.includes(lv.leaveType)
    ) {
      realByDate.set(key, lv);
    }
  }

  let staffQuery = Staff.findById(userId)
    .select(
      "date status relievingDate internshipMonths internshipEndDate confirmationDate confirmationMonths probationMonths",
    )
    .lean();
  if (session) staffQuery = staffQuery.session(session);
  const staffRecord = await staffQuery;
  const confirmationDate = staffRecord?.confirmationDate ?? null;
  const relievingDate =
    staffRecord?.status === "Relieved" && staffRecord?.relievingDate
      ? staffRecord.relievingDate
      : null;
  // Same balance basis the rest of the sandwich/import flow uses: full-year
  // entitlement (as of 31 Dec) once confirmed, otherwise as of the date.
  const effectiveConfirmation = getEffectiveConfirmationDate(staffRecord);
  const balanceArgsFor = (date) => {
    const d = new Date(date);
    const yearEnd = new Date(Date.UTC(d.getUTCFullYear(), 11, 31, 12, 0, 0, 0));
    const fullYearEntitlement =
      !!effectiveConfirmation &&
      getDayRange(d).start >= getDayRange(effectiveConfirmation).start;
    return fullYearEntitlement
      ? { asOf: yearEnd, options: { fullYearEntitlement: true } }
      : { asOf: d, options: {} };
  };

  // Balance lookups, cached per balance date. Unpaid sandwich days never
  // change the balance; the cache is cleared whenever a Paid sandwich day
  // is created or deleted, because that does.
  const balanceCache = new Map();
  const balancesFor = async (date) => {
    const bal = balanceArgsFor(date);
    const cacheKey = `${dateKey(bal.asOf)}|${!!bal.options.fullYearEntitlement}`;
    if (!balanceCache.has(cacheKey)) {
      balanceCache.set(
        cacheKey,
        await computeLeaveBalances(
          userId,
          confirmationDate,
          null,
          bal.asOf,
          relievingDate,
          bal.options,
        ),
      );
    }
    return balanceCache.get(cacheKey);
  };

  // True only when Paid, Sick AND Casual each still have balance pending.
  const hasAllBalancesPending = async (date) => {
    const balances = await balancesFor(date);
    return BALANCE_TYPES.every((t) => (balances?.[t]?.remaining ?? 0) > 0);
  };

  // True only when Paid, Sick AND Casual are ALL used up.
  const hasNoBalanceLeft = async (date) => {
    const balances = await balancesFor(date);
    return BALANCE_TYPES.every((t) => (balances?.[t]?.remaining ?? 0) <= 0);
  };

  const paidRemaining = async (date) =>
    (await balancesFor(date))?.paid?.remaining ?? 0;

  // Consecutive real approved leave days from `anchor` in direction `step`.
  // Capped at 2 — the rule only needs to know whether there is any.
  const realLeaveRun = (anchor, step) => {
    let count = 0;
    let cursor = new Date(anchor);
    while (count < 2 && realByDate.has(dateKey(cursor))) {
      count += 1;
      cursor = addDaysUTC(cursor, step);
    }
    return count;
  };

  // A block day is a Sunday/holiday (or an admin-marked holiday for this
  // staff member) with no real leave recorded on it.
  const isBlockDay = async (date) =>
    !realByDate.has(dateKey(date)) &&
    (adminHolidayDates.has(dateKey(date)) ||
      (await isHolidayOrSunday(date)).isHoliday);

  // Days of a block that may carry a sandwich leave (admin-marked holidays
  // never do).
  const leaveableDays = (block) =>
    block.dates.filter((d) => !adminHolidayDates.has(dateKey(d)));

  // Continuous real leave days (any type) from `anchor` in direction
  // `step`. Sundays/holidays inside the run are stepped over, not counted,
  // so e.g. Paid 12-17 Jan with a holiday on the 15th still counts as 5.
  const leaveRunLength = async (anchor, step) => {
    let count = 0;
    let cursor = new Date(anchor);
    for (let guard = 0; guard < 400; guard++) {
      if (realByDate.has(dateKey(cursor))) count += 1;
      else if (!(await isBlockDay(cursor))) break;
      cursor = addDaysUTC(cursor, step);
    }
    return count;
  };

  // Continuous PAID leave days from `anchor` in direction `step`. Sundays/
  // holidays in the middle of the run are stepped over (not counted), so a
  // two-week Paid leave counts as one continuous run.
  const paidLeaveRun = async (anchor, step) => {
    let count = 0;
    let cursor = new Date(anchor);
    for (let guard = 0; guard < 400; guard++) {
      const lv = realByDate.get(dateKey(cursor));
      if (lv) {
        if (lv.leaveType !== "paid") break;
        count += 1;
      } else if (!(await isBlockDay(cursor))) {
        break;
      }
      cursor = addDaysUTC(cursor, step);
    }
    return count;
  };

  const created = [];

  const deleteIds = async (ids) => {
    if (!ids.length) return;
    let del = Leave.deleteMany({ _id: { $in: ids } });
    if (session) del = del.session(session);
    await del;
  };

  const createSandwich = async (date, leaveType, sourceLeave) => {
    const docs = await Leave.create(
      [
        {
          userId,
          leaveDate: date,
          leaveType,
          dayValue: 1,
          status: "approved",
          reason: "Sandwich leave (auto-applied)",
          approvedBy: sourceLeave?.approvedBy,
          approvedAt: new Date(),
          isAutoGenerated: true,
          isSandwich: true,
          sourceLeaveId: sourceLeave?._id,
        },
      ],
      session ? { session } : {},
    );
    created.push(docs[0]);
  };

  const isSingle = (existing, leaveType) =>
    existing.length === 1 &&
    existing[0].leaveType === leaveType &&
    existing[0].status === "approved" &&
    Number(existing[0].dayValue ?? 1) === 1;

  // Widen the scan so a block that straddles the range edge is always
  // judged as a whole (otherwise its outside part would look like "no
  // leave on that side" and wrongly remove a valid sandwich day).
  let scanStart = new Date(rangeStart);
  for (let g = 0; g < 30 && (await isBlockDay(addDaysUTC(scanStart, -1))); g++)
    scanStart = addDaysUTC(scanStart, -1);
  let scanEnd = new Date(rangeEnd);
  for (let g = 0; g < 30 && (await isBlockDay(addDaysUTC(scanEnd, 1))); g++)
    scanEnd = addDaysUTC(scanEnd, 1);

  // Pass 1: collect every Sunday/holiday block and which rule applies.
  //   mode "longPaid" -> rule 1 (falls back to rule 2)
  //   mode "bracket"  -> rule 2
  //   mode "joining"  -> rule 3
  //   mode "none"     -> rule 4 (holiday)
  const blocks = [];
  let blockDates = [];
  const pushBlock = async () => {
    if (!blockDates.length) return;
    const before = addDaysUTC(blockDates[0], -1);
    const after = addDaysUTC(blockDates[blockDates.length - 1], 1);
    const backRun = realLeaveRun(before, -1);
    const forwardRun = realLeaveRun(after, 1);

    let mode = "none";
    if (backRun >= MIN_BRACKET_RUN && forwardRun >= MIN_BRACKET_RUN) {
      mode = "bracket";
      const backPaid = await paidLeaveRun(before, -1);
      const forwardPaid = await paidLeaveRun(after, 1);
      if (
        backPaid >= 1 &&
        forwardPaid >= 1 &&
        backPaid + forwardPaid > PAID_RUN_THRESHOLD
      )
        mode = "longPaid";
    } else if (
      forwardRun === 0 &&
      backRun >= 1 &&
      (await leaveRunLength(before, -1)) > JOINING_RUN_THRESHOLD
    ) {
      mode = "joining";
    } else if (
      APPLY_STARTING_RULE &&
      backRun === 0 &&
      forwardRun >= 1 &&
      (await leaveRunLength(after, 1)) > JOINING_RUN_THRESHOLD
    ) {
      mode = "starting";
    }

    blocks.push({
      dates: blockDates,
      mode,
      sourceLeave:
        realByDate.get(dateKey(before)) || realByDate.get(dateKey(after)),
    });
    blockDates = [];
  };
  let cursor = new Date(scanStart);
  while (cursor <= scanEnd) {
    if (await isBlockDay(cursor)) blockDates.push(new Date(cursor));
    else await pushBlock();
    cursor = addDaysUTC(cursor, 1);
  }
  await pushBlock();

  const allowedTypesFor = (mode) =>
    mode === "joining" || mode === "starting"
      ? ["unpaid"]
      : mode === "longPaid"
        ? ["paid", "unpaid"]
        : mode === "bracket"
          ? ["unpaid"]
          : [];

  // Pass 2: before any balance is checked, remove sandwich days whose type
  // can't be right for their block any more (e.g. a Paid Sunday after the
  // Monday leave was deleted), so they don't wrongly use up balance.
  const earlyDelete = [];
  for (const block of blocks) {
    for (const date of block.dates) {
      const key = dateKey(date);
      const allowed = adminHolidayDates.has(key)
        ? []
        : allowedTypesFor(block.mode);
      const existing = sandwichByDate.get(key) || [];
      const stale = existing.filter((lv) => !allowed.includes(lv.leaveType));
      if (stale.length) {
        earlyDelete.push(...stale.map((lv) => lv._id));
        sandwichByDate.set(
          key,
          existing.filter((lv) => !stale.includes(lv)),
        );
      }
    }
  }
  await deleteIds(earlyDelete);
  if (earlyDelete.length) balanceCache.clear();

  // Replaces whatever sandwich record(s) sit on `date` with one record of
  // `leaveType` (no-op if that's already exactly what's there).
  const setDay = async (date, existing, leaveType, sourceLeave) => {
    if (isSingle(existing, leaveType)) return;
    await deleteIds(existing.map((lv) => lv._id));
    await createSandwich(date, leaveType, sourceLeave);
    balanceCache.clear();
  };

  const clearDay = async (existing) => {
    if (!existing.length) return;
    await deleteIds(existing.map((lv) => lv._id));
    balanceCache.clear();
  };

  const existingFor = (date) => sandwichByDate.get(dateKey(date)) || [];

  // Pass 3a: Rule 1 FIRST for every block, in date order. Paid sandwich
  // days change the Paid balance, so they must all be settled before any
  // other block is judged on "balance left" — otherwise a Sunday early in
  // the year could be judged before a later block used the last Paid day,
  // and flip on the next calendar view.
  // A long-Paid block becomes Paid only if the Paid balance covers EVERY
  // day of it (e.g. Sunday + a Monday holiday needs 2 Paid days); it is
  // never split into Paid + Unpaid.
  const paidBlocks = new Set();
  for (const block of blocks) {
    if (block.mode !== "longPaid") continue;
    const missing = leaveableDays(block).filter(
      (d) => !isSingle(existingFor(d), "paid"),
    );
    if (!missing.length) {
      paidBlocks.add(block);
      continue;
    }
    if ((await paidRemaining(block.dates[0])) >= missing.length) {
      for (const date of missing)
        await setDay(date, existingFor(date), "paid", block.sourceLeave);
      paidBlocks.add(block);
    }
    // Not enough Paid for the whole block -> judged by rule 2 in pass 3b.
  }

  // Pass 3b: every other block, against the final balance.
  for (const block of blocks) {
    if (block.mode === "none" || paidBlocks.has(block)) continue;
    const firstDay = block.dates[0];

    // Rule 2 (leave on both sides): any one balance type used up -> Unpaid.
    // Rule 3 (continuous leave on one side only — joins back after the
    // block, or starts right after it): only when NO Paid, Sick or Casual
    // balance is left at all -> Unpaid.
    const makeUnpaid =
      block.mode === "joining" || block.mode === "starting"
        ? await hasNoBalanceLeft(firstDay)
        : !(await hasAllBalancesPending(firstDay));

    for (const date of leaveableDays(block)) {
      if (makeUnpaid)
        await setDay(date, existingFor(date), "unpaid", block.sourceLeave);
      else await clearDay(existingFor(date));
    }
  }

  return created;
};

/**
 * Data-repair helper (runs before reconcileSandwichLeaveForRange on the
 * calendar view). Deletes any saved sandwich day that can no longer be
 * valid under the SANDWICH RULE:
 *  - it isn't a known leave type, or
 *  - its Sunday/holiday block has neither real leave on BOTH sides nor
 *    continuous leave on one side of it
 *    (e.g. the leave around it was removed).
 * The type/balance parts of the rule are left to the reconciler, which also
 * removes/creates days as needed. This function only ever deletes.
 */
export const cleanupInvalidSandwichLeaves = async (
  userId,
  fromDate,
  toDate,
  session = null,
) => {
  let q = Leave.find({
    userId,
    isSandwich: true,
    leaveDate: { $gte: fromDate, $lte: toDate },
  });
  if (session) q = q.session(session);
  const sandwichLeaves = await q;
  if (!sandwichLeaves.length) return 0;

  const idsToRemove = [];
  for (const lv of sandwichLeaves) {
    if (!SANDWICH_TYPES.includes(lv.leaveType)) {
      idsToRemove.push(lv._id);
      continue;
    }
    const prevWorkingDay = await findBracketDay(lv.leaveDate, -1);
    const nextWorkingDay = await findBracketDay(lv.leaveDate, 1);
    const backRun = await countRealLeaveRunFromDb(
      userId,
      prevWorkingDay,
      -1,
      session,
    );
    const forwardRun = await countRealLeaveRunFromDb(
      userId,
      nextWorkingDay,
      1,
      session,
    );
    const bracketed =
      backRun >= MIN_BRACKET_RUN && forwardRun >= MIN_BRACKET_RUN;
    // Loose structural check only (the reconciler applies the exact
    // 4+-day and balance rules and removes anything that doesn't qualify).
    const joining = backRun >= 1 && forwardRun === 0;
    const starting = APPLY_STARTING_RULE && forwardRun >= 1 && backRun === 0;
    if (!bracketed && !joining && !starting) {
      idsToRemove.push(lv._id);
    }
  }
  if (!idsToRemove.length) return 0;

  let del = Leave.deleteMany({ _id: { $in: idsToRemove } });
  if (session) del = del.session(session);
  await del;
  return idsToRemove.length;
};

/**
 * Cascade-deletes any sandwich leave day(s) that were generated because of
 * `leaveId`.
 */
export const cleanupSandwichLeavesFor = async (leaveId, session = null) => {
  const filter = { sourceLeaveId: leaveId };
  let query = Leave.find(filter);
  if (session) query = query.session(session);
  const dependents = await query;
  if (!dependents.length) return 0;
  let del = Leave.deleteMany(filter);
  if (session) del = del.session(session);
  await del;
  return dependents.length;
};

/**
 * Actual presence always wins over a previously-granted leave.
 */
export const cancelConflictingLeaveOnAttendance = async (
  staffId,
  dateInput,
  session = null,
) => {
  if (!staffId || !dateInput) return null;
  try {
    const { start, end } = getDayRange(dateInput);
    let q = Leave.findOne({
      userId: staffId,
      leaveDate: { $gte: start, $lte: end },
      status: "approved",
    });
    if (session) q = q.session(session);
    const conflicting = await q;
    if (!conflicting) return null;

    const cancelled = {
      leaveId: conflicting._id,
      leaveType: conflicting.leaveType,
      leaveDate: conflicting.leaveDate,
      wasSandwich: !!conflicting.isSandwich,
    };

    let del = Leave.deleteOne({ _id: conflicting._id });
    if (session) del = del.session(session);
    await del;

    if (!conflicting.isSandwich) {
      cancelled.sandwichDaysRemoved = await cleanupSandwichLeavesFor(
        conflicting._id,
        session,
      );
      // Re-judge the nearby Sunday/holiday blocks: this leave may have been
      // the Saturday or Monday that made a Sunday Unpaid.
      try {
        await reconcileSandwichLeave(conflicting, session);
      } catch (sandwichErr) {
        console.error("Sandwich re-check failed (attendance):", sandwichErr);
      }
    }

    return cancelled;
  } catch (err) {
    console.error("cancelConflictingLeaveOnAttendance failed:", err);
    return null;
  }
};

const MAX_LOOKBACK_DAYS = 60;

// ─── Automatic absence marking ─────────────────────────────────────────
// A past WORKING day (not Sunday, not a declared holiday, not a
// Saturday-rule holiday) with no attendance and no leave is an absence and
// is saved as UNPAID leave (isAutoGenerated: true).
//
// BUGFIXES in this version:
//   * It used to spend the staff member's Sick -> Casual -> Paid balance
//     first and only fall back to Unpaid when all three were empty, so
//     absences showed up as Sick / Casual / Paid days nobody applied for
//     (and could even land before the confirmation date). An absence is
//     now always Unpaid; the admin can change a day to Paid / Sick /
//     Casual from the calendar's Edit Day if it should be paid.
//   * Every Saturday was skipped (isWeekend), so a Saturday that ISN'T a
//     Saturday-rule holiday was never marked. Only Sundays / holidays /
//     Saturday-rule holidays (isHolidayOrSunday) are skipped now.
//   * Attendance was matched on the UTC day of loginTime. A Half Day /
//     Absent marker is stored at 00:00 IST = 18:30 UTC the day BEFORE, so
//     a Half Day on 6 Aug counted for 5 Aug and 6 Aug looked absent.
//     Attendance is now matched on its IST day (the record's `date`).
//   * One DB query per day was replaced by two range queries.
//
// `options.fromDate` widens the window beyond the default 60-day lookback
// (used by the calendar self-heal to cover the whole viewed year).
export const reconcileAbsentDaysForStaff = async (
  staff,
  attendanceUserId,
  uptoDate,
  options = {},
) => {
  const created = [];
  const relievingDate =
    staff.status === "Relieved" && staff.relievingDate
      ? new Date(staff.relievingDate)
      : null;
  const joinDate = staff.date ? new Date(staff.date) : null;
  // Can't tell who was absent without a login account to hold attendance.
  if (!attendanceUserId || !joinDate) return created;

  const earliest = options.fromDate
    ? new Date(options.fromDate)
    : addDaysUTC(uptoDate, -MAX_LOOKBACK_DAYS);
  const firstKey = [istDayKey(joinDate), istDayKey(earliest)].sort().pop();
  let lastKey = istDayKey(uptoDate);
  if (relievingDate && istDayKey(relievingDate) < lastKey) lastKey = istDayKey(relievingDate);
  // Never mark today or the future — the day isn't over yet.
  const yesterdayKey = istDayKey(addDaysUTC(new Date(), -1));
  if (lastKey > yesterdayKey) lastKey = yesterdayKey;
  if (firstKey > lastKey) return created;

  const rangeStart = new Date(`${firstKey}T00:00:00.000Z`);
  const rangeEnd = new Date(`${lastKey}T23:59:59.999Z`);

  // Worked days (IST day keys) and the months that have ANY attendance —
  // a month with no attendance at all is treated as "not tracked in this
  // system" and left alone (see cleanupAutoLeavesInUntrackedMonths).
  const attendance = await Attendance.find({
    userId: attendanceUserId,
    loginTime: {
      $gte: new Date(rangeStart.getTime() - 86400000),
      $lte: new Date(rangeEnd.getTime() + 86400000),
    },
  })
    .select("date loginTime attendanceType status isLeaveDay")
    .lean();
  const workedDays = new Set();
  const trackedMonths = new Set();
  for (const rec of attendance) {
    const key = attendanceDayKey(rec);
    trackedMonths.add(key.slice(0, 7));
    const isAbsentMarker = rec.attendanceType === "absent" || rec.status === "absent";
    if (!isAbsentMarker) workedDays.add(key);
  }

  // Any pending/approved leave (incl. a staff-only admin holiday) already
  // accounts for the day.
  const leaves = await Leave.find({
    userId: staff._id,
    leaveDate: { $gte: rangeStart, $lte: rangeEnd },
    status: { $in: ["pending", "approved"] },
  })
    .select("leaveDate")
    .lean();
  const leaveDays = new Set(leaves.map((l) => istDayKey(l.leaveDate)));

  for (
    let cursor = rangeStart;
    istDayKey(cursor) <= lastKey;
    cursor = addDaysUTC(cursor, 1)
  ) {
    const key = istDayKey(cursor);
    if (!trackedMonths.has(key.slice(0, 7))) continue;
    if (workedDays.has(key) || leaveDays.has(key)) continue;
    const { isHoliday } = await isHolidayOrSunday(cursor);
    if (isHoliday) continue;

    const [doc] = await Leave.create([
      {
        userId: staff._id,
        leaveDate: getDayRange(key).start,
        leaveType: "unpaid",
        dayValue: 1,
        status: "approved",
        reason: "Auto-marked absence (no attendance or leave request found)",
        approvedAt: new Date(),
        isAutoGenerated: true,
      },
    ]);
    leaveDays.add(key);
    created.push(doc);
  }

  return created;
};

export const cleanupInvalidNonWorkingDayLeaves = async (
  userId,
  fromDate,
  toDate,
  session = null,
) => {
  // Admin overrides (a holiday deliberately changed to leave, or a date
  // marked as a holiday for this staff member) are intentional — skip them.
  let q = Leave.find({
    userId,
    status: "approved",
    leaveDate: { $gte: fromDate, $lte: toDate },
    isSandwich: { $ne: true },
    isAdminOverride: { $ne: true },
    leaveType: { $ne: "holiday" },
  }).select("_id leaveDate");
  if (session) q = q.session(session);
  const candidates = await q;
  if (!candidates.length) return 0;

  const idsToRemove = [];
  for (const lv of candidates) {
    const { isHoliday } = await isHolidayOrSunday(lv.leaveDate);
    if (isHoliday) idsToRemove.push(lv._id);
  }
  if (!idsToRemove.length) return 0;

  let del = Leave.deleteMany({ _id: { $in: idsToRemove } });
  if (session) del = del.session(session);
  await del;
  return idsToRemove.length;
};

/**
 * Corrects data already created by an earlier version.
 */
export const cleanupAutoLeavesInUntrackedMonths = async (
  staff,
  attendanceUserId,
) => {
  const autoLeaves = await Leave.find({
    userId: staff._id,
    isAutoGenerated: true,
    isSandwich: { $ne: true },
  })
    .select("_id leaveDate")
    .lean();
  if (!autoLeaves.length) return 0;

  const monthsWithAttendance = new Set();
  if (attendanceUserId) {
    const dates = autoLeaves.map((l) => new Date(l.leaveDate));
    const rangeStart = new Date(Math.min(...dates.map((d) => d.getTime())));
    const rangeEnd = new Date(Math.max(...dates.map((d) => d.getTime())));
    rangeEnd.setUTCHours(23, 59, 59, 999);
    const rangeAttendance = await Attendance.find({
      userId: attendanceUserId,
      loginTime: { $gte: rangeStart, $lte: rangeEnd },
    })
      .select("loginTime")
      .lean();
    for (const rec of rangeAttendance) {
      const d = new Date(rec.loginTime);
      monthsWithAttendance.add(`${d.getUTCFullYear()}-${d.getUTCMonth()}`);
    }
  }

  const idsToDelete = [];
  for (const leave of autoLeaves) {
    const d = new Date(leave.leaveDate);
    const monthKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (!attendanceUserId || !monthsWithAttendance.has(monthKey)) {
      idsToDelete.push(leave._id);
    }
  }
  if (!idsToDelete.length) return 0;

  await Leave.deleteMany({ _id: { $in: idsToDelete } });
  return idsToDelete.length;
};

/**
 * Runs reconcileAbsentDaysForStaff for every staff member.
 */
export const reconcileAllStaffAbsences = async (uptoDate = null) => {
  const end = uptoDate || addDaysUTC(new Date(), -1);
  end.setUTCHours(23, 59, 59, 999);

  const staffList = await Staff.find({}).lean();
  const summary = {
    staffProcessed: 0,
    leavesCreated: 0,
    leavesCleaned: 0,
    errors: [],
  };

  for (const staff of staffList) {
    try {
      const user = staff.email
        ? await User.findOne({ email: staff.email.toLowerCase() })
            .select("_id")
            .lean()
        : null;
      const attendanceUserId = user?._id || null;
      const cleaned = await cleanupAutoLeavesInUntrackedMonths(
        staff,
        attendanceUserId,
      );
      const created = await reconcileAbsentDaysForStaff(
        staff,
        attendanceUserId,
        end,
      );
      summary.staffProcessed += 1;
      summary.leavesCreated += created.length;
      summary.leavesCleaned += cleaned;
    } catch (err) {
      summary.errors.push(`${staff.staffName || staff._id}: ${err.message}`);
    }
  }

  return summary;
};
