// backend/services/leaveAutomation.js

import Leave from "../models/Leave.js";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import Attendance from "../models/Attendance.js";
import { isHolidayOrSunday, getDayRange } from "./leave.js";
import { getRemainingForType } from "./leaveBalance.js";

const BRIDGEABLE_TYPES = ["paid", "sick", "casual", "unpaid"];
const MIN_LEAVE_RUN_FOR_SANDWICH = 3;

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

const collectNonWorkingBlockForward = async (date) => {
  const block = [];
  let cursor = addDaysUTC(date, 1);
  while ((await isHolidayOrSunday(cursor)).isHoliday) {
    block.push(new Date(cursor));
    cursor = addDaysUTC(cursor, 1);
  }
  return { block, nextWorkingDay: cursor };
};

const collectNonWorkingBlockBackward = async (date) => {
  const block = [];
  let cursor = addDaysUTC(date, -1);
  while ((await isHolidayOrSunday(cursor)).isHoliday) {
    block.unshift(new Date(cursor));
    cursor = addDaysUTC(cursor, -1);
  }
  return { block, prevWorkingDay: cursor };
};

// Single-leave entry point. Delegates to the range-based reconciler (below)
// over a small window around this leave's date, so a single freshly-
// created/edited/approved leave and a bulk date-range/import apply share
// exactly the same bridging rule (bridgeable types + the >2-day run
// requirement) instead of drifting into two different behaviors.
export const reconcileSandwichLeave = async (leave, session = null) => {
  if (!BRIDGEABLE_TYPES.includes(leave.leaveType)) return [];
  const WINDOW_DAYS = 14;
  return reconcileSandwichLeaveForRange(
    leave.userId,
    addDaysUTC(leave.leaveDate, -WINDOW_DAYS),
    addDaysUTC(leave.leaveDate, WINDOW_DAYS),
    session,
  );
};

/**
 * Order-independent version of reconcileSandwichLeave for a whole date span
 * at once (one staff member, `fromDate`..`toDate` inclusive).
 */
export const reconcileSandwichLeaveForRange = async (
  userId,
  fromDate,
  toDate,
  session = null,
) => {
  const PAD_DAYS = 14;
  const rangeStart = addDaysUTC(fromDate, -PAD_DAYS);
  const rangeEnd = addDaysUTC(toDate, PAD_DAYS);

  let q = Leave.find({
    userId,
    leaveDate: { $gte: rangeStart, $lte: rangeEnd },
  });
  if (session) q = q.session(session);
  const existingLeaves = await q;

  const leaveByDate = new Map();
  for (const lv of existingLeaves) leaveByDate.set(dateKey(lv.leaveDate), lv);

  let staffQuery = Staff.findById(userId)
    .select("date status relievingDate")
    .lean();
  if (session) staffQuery = staffQuery.session(session);
  const staffRecord = await staffQuery;
  const joinDate =
    staffRecord?.date ??
    new Date(
      Date.UTC(
        fromDate instanceof Date
          ? fromDate.getUTCFullYear()
          : new Date(fromDate).getUTCFullYear(),
        0,
        1,
      ),
    );
  const relievingDate =
    staffRecord?.status === "Relieving" && staffRecord?.relievingDate
      ? staffRecord.relievingDate
      : null;

  const created = [];

  const consecutiveBridgeableRun = (anchor, step) => {
    let count = 0;
    let type = null;
    let cursor = new Date(anchor);
    while (true) {
      const lv = leaveByDate.get(dateKey(cursor));
      if (
        !lv ||
        lv.status !== "approved" ||
        !BRIDGEABLE_TYPES.includes(lv.leaveType)
      )
        break;
      if (type === null) type = lv.leaveType;
      else if (lv.leaveType !== type) break;
      count += 1;
      cursor = addDaysUTC(cursor, step);
    }
    return { count, type };
  };

  const flushRun = async (runDates) => {
    if (!runDates.length) return;
    const before = addDaysUTC(runDates[0], -1);
    const after = addDaysUTC(runDates[runDates.length - 1], 1);

    const backRun = consecutiveBridgeableRun(before, -1);
    const forwardRun = consecutiveBridgeableRun(after, 1);

    let bracketType = null;

    if (backRun.count > MIN_LEAVE_RUN_FOR_SANDWICH - 1)
      bracketType = backRun.type;
    else if (forwardRun.count > MIN_LEAVE_RUN_FOR_SANDWICH - 1)
      bracketType = forwardRun.type;
    if (!bracketType) return;

    for (const date of runDates) {
      const key = dateKey(date);
      if (leaveByDate.has(key)) continue;

      let dayLeaveType = "unpaid";
      if (bracketType !== "unpaid") {
        const remaining = await getRemainingForType(
          userId,
          joinDate,
          bracketType,
          date,
          relievingDate,
        );
        dayLeaveType = remaining >= 1 ? bracketType : "unpaid";
      }

      const sourceLeave =
        leaveByDate.get(dateKey(before)) || leaveByDate.get(dateKey(after));

      const docs = await Leave.create(
        [
          {
            userId,
            leaveDate: date,
            leaveType: dayLeaveType,
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
      leaveByDate.set(key, docs[0]);
      created.push(docs[0]);
    }
  };

  let runDates = [];
  let cursor = new Date(rangeStart);
  while (cursor <= rangeEnd) {
    const key = dateKey(cursor);
    const hasLeave = leaveByDate.has(key);
    const nonWorking = !hasLeave && (await isHolidayOrSunday(cursor)).isHoliday;
    if (nonWorking) {
      runDates.push(new Date(cursor));
    } else {
      await flushRun(runDates);
      runDates = [];
    }
    cursor = addDaysUTC(cursor, 1);
  }
  await flushRun(runDates);

  return created;
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
    }

    return cancelled;
  } catch (err) {
    console.error("cancelConflictingLeaveOnAttendance failed:", err);
    return null;
  }
};

const MAX_LOOKBACK_DAYS = 60;

/**
 * Helper function to check if a date is a weekend (Saturday or Sunday)
 */
const isWeekend = (date) => {
  const dayOfWeek = date.getUTCDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
};

export const reconcileAbsentDaysForStaff = async (
  staff,
  attendanceUserId,
  uptoDate,
) => {
  const created = [];
  const relievingDate =
    staff.status === "Relieving" && staff.relievingDate
      ? new Date(staff.relievingDate)
      : null;
  const joinDate = staff.date ? new Date(staff.date) : null;

  const earliestPossible = addDaysUTC(uptoDate, -MAX_LOOKBACK_DAYS);
  let cursor =
    joinDate && joinDate > earliestPossible ? joinDate : earliestPossible;
  const end =
    relievingDate && relievingDate < uptoDate ? relievingDate : uptoDate;

  const monthsWithAttendance = new Set();
  if (attendanceUserId) {
    const rangeAttendance = await Attendance.find({
      userId: attendanceUserId,
      loginTime: { $gte: cursor, $lte: end },
    })
      .select("loginTime")
      .lean();
    for (const rec of rangeAttendance) {
      const d = new Date(rec.loginTime);
      monthsWithAttendance.add(`${d.getUTCFullYear()}-${d.getUTCMonth()}`);
    }
  }

  // Track consecutive absent days to apply the >2 day rule
  let consecutiveAbsentDays = [];
  let lastProcessedDate = null;

  while (cursor <= end) {
    const dateToCheck = new Date(cursor);
    cursor = addDaysUTC(cursor, 1);

    // Check if it's a holiday or Sunday (weekend)
    const { isHoliday } = await isHolidayOrSunday(dateToCheck);
    const isWeekendDay = isWeekend(dateToCheck);
    
    // CRITICAL FIX: Weekends and holidays are NEVER counted as absent days
    if (isHoliday || isWeekendDay) {
      // If we have accumulated absent days, process them before skipping
      if (consecutiveAbsentDays.length > 0) {
        // Filter out any weekends/holidays that might have been queued
        const workingAbsentDays = [];
        for (const day of consecutiveAbsentDays) {
          const { isHoliday: h } = await isHolidayOrSunday(day);
          const w = isWeekend(day);
          if (!h && !w) workingAbsentDays.push(day);
        }
        if (workingAbsentDays.length > 0) {
          await processAbsentRun(workingAbsentDays, staff, attendanceUserId, created, dateToCheck);
        }
        consecutiveAbsentDays = [];
        lastProcessedDate = null;
      }
      continue; // Skip weekends and holidays entirely
    }
    
    // Get existing leave for this date
    const existingLeave = await findLeaveOn(staff._id, dateToCheck, null);
    
    // Check if there's attendance
    let hasAttendance = false;
    if (attendanceUserId) {
      const monthKey = `${dateToCheck.getUTCFullYear()}-${dateToCheck.getUTCMonth()}`;
      if (monthsWithAttendance.has(monthKey)) {
        const { start, end: dayEnd } = getDayRange(dateToCheck);
        const attendanceRecord = await Attendance.findOne({
          userId: attendanceUserId,
          loginTime: { $gte: start, $lte: dayEnd },
        }).lean();
        if (attendanceRecord && attendanceRecord.attendanceType !== "absent") {
          hasAttendance = true;
        }
      }
    }

    // If it's a working day with no attendance and no leave, it's an absent day
    const isWorkingDay = true; // Already confirmed not holiday/weekend
    const isAbsent = isWorkingDay && !hasAttendance && !existingLeave;

    if (isAbsent) {
      // Collect consecutive absent days
      if (consecutiveAbsentDays.length === 0 || 
          (lastProcessedDate && dateToCheck.getTime() - lastProcessedDate.getTime() === 86400000)) {
        consecutiveAbsentDays.push(dateToCheck);
      } else {
        await processAbsentRun(consecutiveAbsentDays, staff, attendanceUserId, created, dateToCheck);
        consecutiveAbsentDays = [dateToCheck];
      }
      lastProcessedDate = dateToCheck;
    } else {
      if (consecutiveAbsentDays.length > 0) {
        await processAbsentRun(consecutiveAbsentDays, staff, attendanceUserId, created, dateToCheck);
        consecutiveAbsentDays = [];
        lastProcessedDate = null;
      }
    }
  }

  if (consecutiveAbsentDays.length > 0) {
    await processAbsentRun(consecutiveAbsentDays, staff, attendanceUserId, created, null);
  }

  return created;
};

/**
 * Helper function to process a run of consecutive absent days
 * Only creates leaves for working days (Monday-Friday)
 * Weekends and holidays are ALWAYS skipped
 */
async function processAbsentRun(absentDays, staff, attendanceUserId, created, nextDate) {
  if (absentDays.length === 0) return;

  for (const dateToCheck of absentDays) {
    // Double-check it's a working day (should already be guaranteed by caller)
    const { isHoliday } = await isHolidayOrSunday(dateToCheck);
    const isWeekendDay = isWeekend(dateToCheck);
    
    // NEVER mark weekends or holidays as leave
    if (isHoliday || isWeekendDay) {
      continue;
    }

    const remainingPaid = await getRemainingForType(
      staff._id,
      staff.date,
      "paid",
      dateToCheck,
      staff.relievingDate,
    );
    const leaveType = remainingPaid >= 1 ? "paid" : "unpaid";

    const existingLeave = await findLeaveOn(staff._id, dateToCheck, null);
    if (existingLeave) continue;

    const docs = await Leave.create([
      {
        userId: staff._id,
        leaveDate: dateToCheck,
        leaveType,
        status: "approved",
        reason: "Auto-marked absence (no attendance or leave request found)",
        approvedAt: new Date(),
        isAutoGenerated: true,
      },
    ]);
    created.push(docs[0]);
  }
}


export const cleanupInvalidNonWorkingDayLeaves = async (
  userId,
  fromDate,
  toDate,
  session = null,
) => {
  let q = Leave.find({
    userId,
    status: "approved",
    leaveDate: { $gte: fromDate, $lte: toDate },
    isSandwich: { $ne: true },
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