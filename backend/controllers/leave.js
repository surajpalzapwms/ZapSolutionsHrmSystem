import mongoose from "mongoose";
import {
  getOrCompute,
  registerCacheWarmer,
} from "../services/responseCache.js";
import { refreshPendingPayrollForPeriod } from "./payrollController.js";
import {
  Attendance,
  Leave,
  Staff,
  toTitleCase,
  formatDateForLog,
  formatMinutesToTimeString,
  getAttendanceType,
  getDayRange,
  getLeaveRangeFromDate,
  isHolidayOrSunday,
  warmHolidayWindow,
  enforceExtraHoursConsistency,
  calculateExtraHoursSummary,
  calculateMonthlyExtraHoursSummary,
  findExistingAttendance,
  findExistingLeave,
  getAllAttendance,
  getAttendanceForDay,
  getHolidays as getHolidaysService,
  getLeaves as getLeavesService,
  getStaffById,
  getEffectiveConfirmationDate,
  getProbationLeaveBlockMessage,
  getUserAttendanceRange,
  getDateStringIST,
  attendanceDayKey,
  isBeforeConfirmation,
  getClampedWorkingMinutes,
  getWorkedMinutesBreakdown,
  classifyWorkedMinutes,
  getAvailableBankMinutes,
  deductFromExtraHoursBank,
  getUserShift,
  resolveEffectiveShift,
  findAttendanceByUserAndDate,
  findOpenAttendanceForDate,
  buildAttendanceFields,
  resolveUserIdByEmail,
  resolveStaffIdByEmail,
  resolveStaffIdByUserId,
  LUNCH_START,
  LUNCH_END,
  REQUIRED_WORK_MINUTES,
  DEFAULT_SHIFT_START,
  DEFAULT_SHIFT_END,
} from "../services/leave.js";
import {
  getRemainingForType,
  getBlockingTrackedTypeForUnpaid,
  getSickCasualPoolRemaining,
  computeLeaveBalances,
} from "../services/leaveBalance.js";
import { buildPaidLeaveValueByMonth } from "../services/leaveEncashment.js";
import {
  reconcileSandwichLeave,
  reconcileSandwichLeaveForRange,
  cleanupSandwichLeavesFor,
  reconcileAllStaffAbsences,
  cancelConflictingLeaveOnAttendance,
  cleanupInvalidNonWorkingDayLeaves,
  cleanupInvalidSandwichLeaves,
} from "../services/leaveAutomation.js";
import { runCalendarSelfHealOnce } from "../services/calendarHealCache.js";
import User from "../models/User.js";
import Holiday from "../models/holiday.js";
import SaturdayHolidayRule from "../models/saturdayHolidayRule.js";
import { isFromOfficeNetwork } from "../utils/officeNetwork.js";
import { isAdminRole } from "../config/permissions.js";
import { autoAttendanceApplies } from "../services/presence.js";

const ORDINAL_SATURDAY = {
  1: "1st Saturday Holiday",
  2: "2nd Saturday Holiday",
  3: "3rd Saturday Holiday",
  4: "4th Saturday Holiday",
  5: "5th Saturday Holiday",
};

/**
 * Expands the admin's recurring-Saturday rules for a year into
 * Holiday-shaped {name, startDate, endDate} objects so they can be merged
 * straight into any calendar view that already knows how to render
 * `holidays` arrays (the staff attendance calendar, etc.).
 */
const getSaturdayHolidaysAsEntries = async (year) => {
  const dates = await SaturdayHolidayRule.getComputedDatesForYear(year);
  return dates.map(({ date, occurrence }) => ({
    name: ORDINAL_SATURDAY[occurrence] || "Saturday Holiday",
    startDate: date,
    endDate: date,
  }));
};

// NOTE: several handlers below (applyLeave, updateAttendance, deleteLeave, ...)
// call logActivity(...) for audit-trail purposes, but this file never defined
// or imported it — every one of those requests was crashing with a
// ReferenceError at runtime. Stubbed here (same no-op pattern already used in
// controllers/attendance.js and controllers/holiday.js) so those routes
// actually work; wire in a real activity logger here if/when one exists.
const logActivity = async (_req, _entry) => {};

// Admin-entered/imported times (e.g. "2025-07-01T09:56:00" from the Excel
// importer or the manual attendance form) are IST wall-clock values with no
// timezone marker. `new Date(str)` alone would parse them in whatever
// timezone the server process happens to run in, so we instead read off the
// literal digits and treat them as IST, converting to a true UTC instant —
// the same instant self sign-in produces via `new Date()`. Without the
// IST_OFFSET_MS subtraction below, every imported/manually-recorded time
// displays 5:30 later than what was typed (e.g. 9:56 AM shows as 3:26 PM).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const parseDT = (str) => {
  const dt = new Date(str);
  const istWallClockAsUTC = Date.UTC(
    dt.getFullYear(),
    dt.getMonth(),
    dt.getDate(),
    dt.getHours(),
    dt.getMinutes(),
    dt.getSeconds(),
  );
  return new Date(istWallClockAsUTC - IST_OFFSET_MS);
};

// GET /attendance
export const listAttendance = async (req, res) => {
  try {
    // Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD to limit the window.
    const { from, to } = req.query;
    const records = await getAllAttendance({ from, to });
    res.json(records);
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// GET /attendance/today
export const getTodayAttendance = async (req, res) => {
  try {
    const records = await getAttendanceForDay(new Date());
    res.json({
      success: true,
      data: records.map((rec) => ({
        userId: rec.userId,
        isPresent: !rec.isLeaveDay,
        attendanceType: rec.attendanceType || "full",
        isHalfDay: rec.attendanceType === "half",
        totalTime: rec.totalTime,
        date: rec.loginTime,
      })),
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// GET /attendance/yesterday
export const getYesterdayAttendance = async (req, res) => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const records = await getAttendanceForDay(yesterday);
    res.json({
      success: true,
      data: records.map((rec) => ({
        userId: rec.userId,
        isPresent: !rec.isLeaveDay,
        attendanceType: rec.attendanceType || "full",
        totalTime: rec.totalTime,
        isHalfDay: rec.attendanceType === "half",
      })),
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// PUT /attendance/:id
export const updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid attendance record ID" });

    const previousRecord = await Attendance.findById(id).lean();
    if (!previousRecord)
      return res
        .status(404)
        .json({ success: false, message: "Attendance record not found" });

    const { loginTime, logoutTime, workingHoursPerDay, remarks } = req.body;
    const loginDT = loginTime ? parseDT(loginTime) : previousRecord.loginTime;
    const logoutDT = logoutTime
      ? parseDT(logoutTime)
      : previousRecord.logoutTime;

    if (logoutDT <= loginDT)
      return res
        .status(400)
        .json({
          success: false,
          message: "Logout time must be after login time",
        });

    // Same worked-minutes math as new attendance (shift-window + lunch
    // subtracted, plus any overtime past shift end) instead of a raw
    // logout-minus-login diff — a raw diff ignored the lunch break and
    // shift window entirely, so an admin edit could classify a day
    // differently than the same login/logout would if entered fresh.
    const { shiftStartTime, shiftEndTime } = resolveEffectiveShift(loginDT);
    const { netMinutes, overtimeMinutes } = getWorkedMinutesBreakdown(
      loginDT,
      logoutDT,
      shiftStartTime,
      shiftEndTime,
    );
    const effectiveMinutes = netMinutes + overtimeMinutes;
    const totalTime = formatMinutesToTimeString(effectiveMinutes);

    // This day's own previously-earned extra minutes are being replaced by
    // the recalculated figure below, so they shouldn't also count toward
    // "available bank" when deciding whether a shortfall can be covered —
    // exclude them, then add back whatever bank the edit ends up using.
    const bankExcludingThisRecord = Math.max(
      0,
      (await getAvailableBankMinutes(previousRecord.userId)) -
        (previousRecord.extraHoursInMinutes || 0),
    );
    const { type: attendanceType, bankMinutesUsed, extraMinutesEarned } =
      classifyWorkedMinutes(effectiveMinutes, bankExcludingThisRecord, loginDT);
    const extraHours = formatMinutesToTimeString(extraMinutesEarned);
    const dateString = formatDateForLog(loginDT);

    const updated = await Attendance.findByIdAndUpdate(
      id,
      {
        loginTime: loginDT,
        logoutTime: logoutDT,
        totalTime,
        sessionMinutes: effectiveMinutes,
        workingHoursPerDay:
          workingHoursPerDay || previousRecord.workingHoursPerDay,
        extraHours,
        extraHoursInMinutes: extraMinutesEarned,
        bankMinutesUsed,
        attendanceType,
        remarks: remarks || previousRecord.remarks,
        updatedAt: new Date(),
      },
      { new: true },
    );

    if (bankMinutesUsed > 0) {
      await deductFromExtraHoursBank(previousRecord.userId, bankMinutesUsed);
    }
    const updatedDoc = updated.toObject();

    await logActivity(req, {
      action: "UPDATE",
      actionLabel: `Updated Attendance: ${attendanceType} day for User ${previousRecord.userId} on ${dateString}`,
      tableName: "attendance",
      tableLabel: "Attendance",
      recordId: id,
      referenceNumber: `${previousRecord.userId}_${dateString}`,
      previousData: previousRecord,
      newData: updatedDoc,
      previousSnapshots: [
        {
          recordId: String(id),
          refNumber: `${previousRecord.userId}_${formatDateForLog(previousRecord.loginTime)}`,
          data: previousRecord,
        },
      ],
      newSnapshots: [
        {
          recordId: String(id),
          refNumber: `${previousRecord.userId}_${dateString}`,
          data: updatedDoc,
        },
      ],
      description: `Attendance updated for user ${previousRecord.userId} on ${dateString}. Type: ${attendanceType}, Worked: ${totalTime}, Extra: ${extraHours}`,
      refField: "userId",
    });
    res.json({
      success: true,
      message: "Attendance record updated successfully",
      attendance: updatedDoc,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// Shared cleanup used by both DELETE /attendance/:id and DELETE /attendance/date/:userId/:date
const cleanupDependentLeaves = async (
  userId,
  isLeaveDay,
  recordId,
  start,
  end,
  session,
) => {
  let warningMessage = null;

  if (isLeaveDay) {
    const swapLeave = await Leave.findOne({
      userId,
      leaveDate: { $gte: start, $lte: end },
      leaveType: "swapleave",
      status: "approved",
    }).session(session);
    if (swapLeave) {
      for (const source of swapLeave.extraHoursSources) {
        const sourceRecord = await Attendance.findById(
          source.attendanceId,
        ).session(session);
        if (sourceRecord && !sourceRecord.isLeaveDay) {
          const newExtra =
            (sourceRecord.extraHoursInMinutes || 0) + source.deductedMinutes;
          sourceRecord.extraHoursInMinutes = newExtra;
          sourceRecord.extraHours = formatMinutesToTimeString(newExtra);
          await sourceRecord.save({ session });
        }
      }
      await Leave.findByIdAndDelete(swapLeave._id).session(session);
      warningMessage = "Swap leave deleted and extra hours restored.";
    }
  } else {
    const dependentSwaps = await Leave.find({
      userId,
      leaveType: "swapleave",
      status: "approved",
      "extraHoursSources.attendanceId": recordId,
    }).session(session);
    if (dependentSwaps.length > 0) {
      for (const swap of dependentSwaps)
        await Leave.findByIdAndDelete(swap._id).session(session);
      warningMessage = `${dependentSwaps.length} swap leave(s) deleted because they depended on this attendance record.`;
    }
  }

  const otherLeaves = await Leave.find({
    userId,
    leaveDate: { $gte: start, $lte: end },
    leaveType: { $in: ["paid", "unpaid"] },
  }).session(session);
  if (otherLeaves.length > 0) {
    await Leave.deleteMany({
      _id: { $in: otherLeaves.map((l) => l._id) },
    }).session(session);
    const types = [...new Set(otherLeaves.map((l) => l.leaveType))].join(", ");
    warningMessage = [
      warningMessage,
      `Associated ${types} leave(s) also deleted.`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return warningMessage;
};

// DELETE /attendance/:id
export const deleteAttendance = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: "Invalid attendance record ID" });
    }

    const attendance = await Attendance.findById(id).session(session);
    if (!attendance) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Attendance record not found" });
    }

    const { userId, isLeaveDay, loginTime } = attendance;
    const attendanceDoc = attendance.toObject();
    const deletedDate = loginTime
      ? formatDateForLog(loginTime)
      : "unknown date";
    const { start, end } = getLeaveRangeFromDate(loginTime || new Date());

    const warningMessage = await cleanupDependentLeaves(
      userId,
      isLeaveDay,
      id,
      start,
      end,
      session,
    );

    await Attendance.findByIdAndDelete(id).session(session);
    await enforceExtraHoursConsistency(userId, session);
    await session.commitTransaction();
    session.endSession();

    await logActivity(req, {
      action: "DELETE",
      actionLabel: `Deleted Attendance Record: ${attendance.attendanceType || "Unknown"} day on ${deletedDate}`,
      tableName: "attendance",
      tableLabel: "Attendance",
      recordId: attendance._id,
      referenceNumber: `${userId}_${deletedDate}`,
      previousData: attendanceDoc,
      previousSnapshots: [
        {
          recordId: String(attendance._id),
          refNumber: `${userId}_${deletedDate}`,
          data: attendanceDoc,
        },
      ],
      description: `Attendance record for user ${userId} on ${deletedDate} (${attendance.attendanceType || "unknown"}) deleted${warningMessage ? ` — ${warningMessage}` : ""}`,
      refField: "userId",
    });
    res.json({
      success: true,
      message: `Attendance record for ${deletedDate} deleted. ${warningMessage || ""}`,
      deletedId: id,
      deletedDate,
      warning: warningMessage,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// DELETE /attendance/date/:userId/:date
export const deleteAttendanceByDate = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { userId, date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({
          success: false,
          message: "Invalid date format. Use YYYY-MM-DD",
        });
    }

    const attendance = await findExistingAttendance(userId, date, session);

    if (attendance) {
      const attendanceDoc = attendance.toObject();
      const { isLeaveDay, loginTime } = attendance;
      const { start, end } = getLeaveRangeFromDate(loginTime || date);

      const warningMessage = await cleanupDependentLeaves(
        userId,
        isLeaveDay,
        attendance._id,
        start,
        end,
        session,
      );

      await Attendance.findByIdAndDelete(attendance._id).session(session);
      await enforceExtraHoursConsistency(userId, session);
      await session.commitTransaction();
      session.endSession();

      await logActivity(req, {
        action: "DELETE",
        actionLabel: `Deleted Attendance Record for User ${userId} on ${date}`,
        tableName: "attendance",
        tableLabel: "Attendance",
        recordId: attendance._id,
        referenceNumber: `${userId}_${date}`,
        previousData: attendanceDoc,
        previousSnapshots: [
          {
            recordId: String(attendance._id),
            refNumber: `${userId}_${date}`,
            data: attendanceDoc,
          },
        ],
        description: `Attendance record for user ${userId} on ${date} (${attendance.attendanceType || "unknown"}) deleted${warningMessage ? ` — ${warningMessage}` : ""}`,
        refField: "userId",
      });

      return res.json({
        success: true,
        message:
          `Attendance record for ${date} deleted. ${warningMessage || ""}`.trim(),
        deletedDate: date,
        deletedType: "attendance",
        warning: warningMessage,
      });
    }

    const leaveRecord = await findExistingLeave(userId, date, session);

    if (leaveRecord) {
      const leaveDoc = leaveRecord.toObject();
      const { leaveDate, leaveType } = leaveRecord;
      let warningMessage = null;

      if (leaveType === "swapleave" && leaveDoc.extraHoursSources?.length) {
        for (const source of leaveDoc.extraHoursSources) {
          const sourceRecord = await Attendance.findById(
            source.attendanceId,
          ).session(session);
          if (sourceRecord && !sourceRecord.isLeaveDay) {
            const newExtra =
              (sourceRecord.extraHoursInMinutes || 0) + source.deductedMinutes;
            sourceRecord.extraHoursInMinutes = newExtra;
            sourceRecord.extraHours = formatMinutesToTimeString(newExtra);
            await sourceRecord.save({ session });
          }
        }
        warningMessage = "Swap leave deleted and extra hours restored.";
      }

      await Leave.findByIdAndDelete(leaveRecord._id).session(session);
      await enforceExtraHoursConsistency(userId, session);
      await session.commitTransaction();
      session.endSession();

      const leaveDateStr = formatDateForLog(leaveDate);

      await logActivity(req, {
        action: "DELETE",
        actionLabel: `Deleted ${toTitleCase(leaveType)} Leave for User ${userId} on ${leaveDateStr}`,
        tableName: "leaves",
        tableLabel: "Leave",
        recordId: leaveRecord._id,
        referenceNumber: `${userId}_${leaveDateStr}`,
        previousData: leaveDoc,
        previousSnapshots: [
          {
            recordId: String(leaveRecord._id),
            refNumber: `${userId}_${leaveDateStr}`,
            data: leaveDoc,
          },
        ],
        description: `${toTitleCase(leaveType)} leave for user ${userId} on ${leaveDateStr} deleted${warningMessage ? ` — ${warningMessage}` : ""}`,
        refField: "userId",
      });

      return res.json({
        success: true,
        message:
          `Leave record (${leaveType}) for ${date} deleted. ${warningMessage || ""}`.trim(),
        deletedDate: date,
        deletedType: "leave",
        warning: warningMessage,
      });
    }

    await session.abortTransaction();
    session.endSession();
    return res.status(404).json({
      success: false,
      message:
        "No attendance or leave record found for this user on the given date",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// GET /holidays
export const listHolidays = async (req, res) => {
  try {
    const holidays = await getHolidaysService();
    res.json({ success: true, holidays });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// GET /
export const listLeaves = async (req, res) => {
  try {
    const { leaveType, status, from, to } = req.query;
    const leaves = await getLeavesService({ leaveType, status, from, to });
    res.json(leaves);
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// POST / (apply leave)
export const applyLeave = async (req, res) => {
  try {
    const { userId, leaveDate, endDate, reason, leaveType, status, isHalfDay } =
      req.body;
    if (!userId || !leaveDate || !reason) {
      return res.status(400).json({
        success: false,
        message: "User ID, leave date, and reason are required",
      });
    }

    const validLeaveTypes = ["paid", "unpaid", "swapleave", "sick", "casual"];
    if (leaveType && !validLeaveTypes.includes(leaveType)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid leave type. Must be 'paid', 'unpaid', 'swapleave', 'sick', or 'casual'",
      });
    }

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(leaveDate)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Invalid leaveDate format. Use YYYY-MM-DD",
        });
    }
    const todayString = getDateStringIST(new Date());
    // Future-dated leave (planning ahead for e.g. November or April) is
    // allowed as long as the staff member has the balance for it — it's no
    // longer blocked outright. Because this endpoint saves the leave as
    // "approved" immediately (there's no separate approval step here), a
    // future date still needs an explicit confirmation from whoever is
    // applying it before it's actually committed, so a stray click can't
    // silently lock in a day months from now. `confirmed: true` in the
    // request body is that explicit go-ahead; the frontend prompts for it
    // once it sees `requiresConfirmation` come back.
    const isFutureDate = leaveDate > todayString;
    if (isFutureDate && !req.body.confirmed) {
      return res.status(200).json({
        success: false,
        requiresConfirmation: true,
        message: `${leaveDate} is a future date. Confirm to apply this leave in advance.`,
      });
    }

    // `userId` here is the Staff._id (see leaveStaffOptions on the
    // frontend), but Attendance records are keyed by the linked login
    // User._id — resolve that once up front so the "already has
    // attendance" checks below (both range and single-day mode) actually
    // match real Attendance rows instead of comparing against an ID that
    // Attendance never uses. A staff member with no linked login account
    // simply has no attendance to conflict with.
    const staffForAttendanceLookup = await Staff.findById(userId)
      .select(
        "email date status internshipMonths internshipEndDate confirmationDate confirmationMonths probationMonths",
      )
      .lean();
    const attendanceUserId = staffForAttendanceLookup?.email
      ? (
          await resolveUserIdByEmail([staffForAttendanceLookup.email])
        )[staffForAttendanceLookup.email.toLowerCase()] || null
      : null;

    // No leave — of any type — can be applied until the staff member's
    // probation is over and they've been confirmed (joining date +
    // probation/confirmation months). Checked against the earliest date in
    // the request, so a range that starts before confirmation is blocked
    // outright rather than partially created.
    const probationBlockMessage = getProbationLeaveBlockMessage(
      staffForAttendanceLookup,
      leaveDate,
    );
    if (probationBlockMessage) {
      return res.status(400).json({ success: false, message: probationBlockMessage });
    }

    // ── Range mode (admin picks a "Date Range" in the Apply Leave modal) ──
    // Walks every calendar day from leaveDate to endDate, same day-by-day
    // approach applyMyLeave's batch request uses below, except every day
    // lands as "approved" directly (this is the direct admin-apply path,
    // there's no separate approval step) and each creation is immediately
    // run through the sandwich-leave check. Doing that in ascending date
    // order is what lets a Sunday/holiday sitting inside the range — even
    // several in a row, e.g. a Sunday next to a public holiday — get
    // filled in automatically: by the time the loop reaches the first
    // working day AFTER that block, the working day BEFORE it already has
    // an approved leave, so reconcileSandwichLeave's backward-looking check
    // finds it and fills the block in (see services/leaveAutomation.js).
    if (endDate && endDate !== leaveDate) {
      if (!dateRe.test(endDate)) {
        return res.status(400).json({
          success: false,
          message: "Invalid endDate format. Use YYYY-MM-DD",
        });
      }
      if (endDate < leaveDate) {
        return res.status(400).json({
          success: false,
          message: "endDate must be on or after leaveDate",
        });
      }
      // Same future-date confirmation rule as the single-day check above —
      // a range with any future day in it needs the explicit go-ahead too.
      if (endDate > todayString && !req.body.confirmed) {
        return res.status(200).json({
          success: false,
          requiresConfirmation: true,
          message: `${endDate} is a future date. Confirm to apply this leave in advance.`,
        });
      }

      const resolvedLeaveType = leaveType || "unpaid";
      const isBalanceTracked = ["paid", "sick", "casual"].includes(
        resolvedLeaveType,
      );

      let remainingForRangeType = Infinity;
      if (isBalanceTracked) {
        const staffRecord = await getStaffById(userId);
        // Leave only starts accruing once a staff member is confirmed —
        // no confirmationDate yet means no balance at all, not "since Jan 1".
        const confirmationDate = staffRecord?.confirmationDate ?? null;
        const relievingDate =
          staffRecord?.status === "Relieved" ? staffRecord?.relievingDate : null;
        remainingForRangeType = await getRemainingForType(
          userId,
          confirmationDate,
          resolvedLeaveType,
          new Date(),
          relievingDate,
        );
        if (remainingForRangeType < 1) {
          return res.status(400).json({
            success: false,
            message: `Insufficient ${resolvedLeaveType} leave balance for this calendar year (${remainingForRangeType} day(s) remaining). Choose Unpaid leave instead.`,
          });
        }
      } else if (resolvedLeaveType === "unpaid") {
        // Unpaid is a last resort — block it here the same way a depleted
        // balance blocks Paid/Sick/Casual above, so an admin can't apply
        // Unpaid leave for a staff member who still has Sick, Casual, or
        // Paid days sitting unused.
        const staffRecord = await getStaffById(userId);
        const confirmationDate = staffRecord?.confirmationDate ?? null;
        const relievingDate =
          staffRecord?.status === "Relieved" ? staffRecord?.relievingDate : null;
        const blockingType = await getBlockingTrackedTypeForUnpaid(
          userId,
          confirmationDate,
          relievingDate,
        );
        if (blockingType) {
          return res.status(400).json({
            success: false,
            message: `Staff still has ${blockingType} leave remaining — use that up before applying Unpaid leave.`,
          });
        }
      }

      const batchId = `${userId}-${Date.now()}`;
      const created = [];
      const skipped = [];

      // Iterate using UTC midnights so day math never drifts across
      // timezones — same pattern applyMyLeave's batch loop uses.
      let cursor = new Date(`${leaveDate}T00:00:00.000Z`);
      const last = new Date(`${endDate}T00:00:00.000Z`);
      for (let guard = 0; cursor <= last && guard < 366; guard++) {
        const y = cursor.getUTCFullYear();
        const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
        const d = String(cursor.getUTCDate()).padStart(2, "0");
        const dayStr = `${y}-${m}-${d}`;
        const { start: parsedDate, end: dayEnd } = getDayRange(dayStr);
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);

        // Sundays and holidays never get their own Leave record created
        // here directly — they're left for reconcileSandwichLeave to fill
        // in from the working days on either side. That's what keeps a
        // holiday that ISN'T actually bracketed by leave on both sides
        // (e.g. it falls right at the edge of the requested range) a free
        // holiday instead of being force-marked as leave.
        if (parsedDate.getUTCDay() === 0) {
          skipped.push({ date: dayStr, reason: "Sunday" });
          continue;
        }
        const holidayCheck = await isHolidayOrSunday(parsedDate);
        if (holidayCheck.isHoliday) {
          skipped.push({ date: dayStr, reason: holidayCheck.reason || "Holiday" });
          continue;
        }

        const existingAttendanceDay = attendanceUserId
          ? await findExistingAttendance(attendanceUserId, parsedDate)
          : null;
        if (existingAttendanceDay) {
          skipped.push({ date: dayStr, reason: "Attendance already recorded" });
          continue;
        }

        const existing = await Leave.findOne({
          userId,
          leaveDate: { $gte: parsedDate, $lte: dayEnd },
          status: { $in: ["pending", "approved"] },
        });
        if (existing) {
          skipped.push({ date: dayStr, reason: "Already requested" });
          continue;
        }

        // Same balance-exhaustion fallback applyMyLeave's batch uses: once
        // the tracked balance runs out partway through this same range,
        // later days still get the day off — just as unpaid instead of
        // being silently dropped.
        const dayLeaveType =
          isBalanceTracked && remainingForRangeType < 1
            ? "unpaid"
            : resolvedLeaveType;

        const dayLeave = new Leave({
          userId,
          leaveDate: parsedDate,
          reason,
          leaveType: dayLeaveType,
          status: "approved",
          batchId,
        });
        await dayLeave.save();
        created.push(dayLeave);
        if (isBalanceTracked && dayLeaveType === resolvedLeaveType) {
          remainingForRangeType -= 1;
        }
      }

      // Bridge any Sunday/holiday block(s) inside the range in a single,
      // order-independent pass over the whole leaveDate..endDate span —
      // instead of reconciling after each individual day above, which only
      // catches a bracketed block if the two days on either side of it
      // happen to already be saved by the time the loop reaches them. A
      // block made of MORE than one non-working day (e.g. a Sunday sitting
      // right next to a public holiday) needs both the day before AND the
      // day after the whole block to exist first, which isn't guaranteed
      // mid-loop — this final pass sees the finished range as a whole, so
      // it always finds it regardless of how many non-working days are in
      // the run or what order they were created in.
      if (created.length > 0) {
        try {
          await reconcileSandwichLeaveForRange(userId, leaveDate, endDate);
        } catch (sandwichErr) {
          console.error(
            "Sandwich leave reconciliation failed (range apply):",
            sandwichErr,
          );
        }
      }

      if (created.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "No leave was created — every day in the range was a Sunday, a holiday, already requested, or already has attendance.",
          skipped,
        });
      }

      await logActivity(req, {
        action: "CREATE",
        actionLabel: `Applied ${toTitleCase(resolvedLeaveType)} Leave for User ${userId} from ${leaveDate} to ${endDate}`,
        tableName: "leaves",
        tableLabel: "Leave",
        description: `${toTitleCase(resolvedLeaveType)} leave applied for user ${userId} from ${leaveDate} to ${endDate}: ${created.length} day(s) created, ${skipped.length} skipped (Sundays/holidays inside the range are backfilled as leave automatically where bracketed on both sides). Reason: ${reason}`,
        refField: "userId",
      });

      return res.status(201).json({
        success: true,
        message: `${created.length} day(s) applied as ${toTitleCase(resolvedLeaveType)} leave (${skipped.length} day(s) skipped — see details).`,
        created,
        skipped,
        batchId,
      });
    }

    // ── Single-day mode ────────────────────────────────────────────────
    // Timezone-safe parse: build the date from its UTC calendar parts instead of
    // `new Date(leaveDate); .setHours(0,0,0,0)`, which silently shifted the date
    // back by a day whenever the server's local timezone was ahead of UTC (e.g.
    // IST) — "2026-07-17" would get stored as 2026-07-16T18:30Z and every screen
    // that reads it back with getUTCDate() would show it as 16 Jul.
    const { start: parsedLeaveDate } = getDayRange(leaveDate);
    if (parsedLeaveDate.getUTCDay() === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot apply for leave on Sunday" });
    }

    const holidayCheck = await isHolidayOrSunday(parsedLeaveDate);
    if (holidayCheck.isHoliday && holidayCheck.reason !== "Sunday") {
      return res.status(400).json({
        success: false,
        message: `Cannot apply for leave on holiday: ${holidayCheck.reason}`,
      });
    }

    const existingAttendance = attendanceUserId
      ? await findExistingAttendance(attendanceUserId, parsedLeaveDate)
      : null;
    if (existingAttendance) {
      return res.status(400).json({
        success: false,
        message: "Cannot apply for leave on a day with existing attendance",
      });
    }

    const { start, end } = getDayRange(parsedLeaveDate);
    // Only a pending or already-approved leave should block a new one on
    // the same date — a *rejected* record must not, or a date a staff
    // member's request was rejected on becomes permanently unusable (it
    // shows nothing on the calendar, since only approved leaves render,
    // yet silently rejects every future attempt to mark that same day).
    // Matches the scoping applyMyLeave already uses below.
    if (
      await Leave.findOne({
        userId,
        leaveDate: { $gte: start, $lte: end },
        status: { $in: ["pending", "approved"] },
      })
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Leave already exists for this date",
        });
    }

    // A half-day leave only ever counts as 0.5 of a day, regardless of
    // leave type — this is what makes Paid/Sick/Casual/Unpaid balances and
    // the calendar's totals match a real half-day off instead of silently
    // charging (and displaying) a full day for it.
    const dayValue = isHalfDay ? 0.5 : 1;

    if (leaveType === "paid" || leaveType === "sick" || leaveType === "casual") {
      const staffRecord = await getStaffById(userId);
      const confirmationDate = staffRecord?.confirmationDate ?? null;
      const relievingDate =
        staffRecord?.status === "Relieved" ? staffRecord?.relievingDate : null;
      const available = await getRemainingForType(
        userId,
        confirmationDate,
        leaveType,
        new Date(),
        relievingDate,
      );
      if (available < dayValue) {
        return res.status(400).json({
          success: false,
          message: `Insufficient ${leaveType} leave balance for this calendar year (${available} day(s) remaining). Choose Unpaid leave instead.`,
        });
      }
    } else if ((leaveType || "unpaid") === "unpaid") {
      // Same rule as the range-mode branch above: Unpaid is only allowed
      // once Sick, Casual, and Paid are all used up.
      const staffRecord = await getStaffById(userId);
      const confirmationDate = staffRecord?.confirmationDate ?? null;
      const relievingDate =
        staffRecord?.status === "Relieved" ? staffRecord?.relievingDate : null;
      const blockingType = await getBlockingTrackedTypeForUnpaid(
        userId,
        confirmationDate,
        relievingDate,
      );
      if (blockingType) {
        return res.status(400).json({
          success: false,
          message: `Staff still has ${blockingType} leave remaining — use that up before applying Unpaid leave.`,
        });
      }
    }

    const leave = new Leave({
      userId,
      leaveDate: parsedLeaveDate,
      reason,
      leaveType: leaveType || "unpaid",
      status: status || "approved",
      dayValue,
    });
    await leave.save();

    // Best-effort: this is the direct admin-apply path (used by the
    // calendar screen), not the staff-request→approve flow, but it can
    // still land a leave right next to a Sunday/holiday block on the other
    // side of an already-approved leave. Without this call, marking Friday,
    // Saturday, and Monday as leave one day at a time from the calendar
    // would leave the Sunday in between un-sandwiched (shown as a free
    // holiday) instead of being counted and deducted as leave too. Only
    // runs when the record actually landed as "approved" — a pending
    // record isn't a real bracket yet.
    if (leave.status === "approved") {
      try {
        await reconcileSandwichLeave(leave);
      } catch (sandwichErr) {
        console.error("Sandwich leave reconciliation failed:", sandwichErr);
      }
    }

    const savedDoc = leave.toObject();
    const leaveDateStr = formatDateForLog(parsedLeaveDate);
    await logActivity(req, {
      action: "CREATE",
      actionLabel: `Applied ${toTitleCase(leaveType || "Unpaid")} Leave for User ${userId} on ${leaveDateStr}`,
      tableName: "leaves",
      tableLabel: "Leave",
      recordId: leave._id,
      referenceNumber: `${userId}_${leaveDateStr}`,
      newData: savedDoc,
      newSnapshots: [
        {
          recordId: String(leave._id),
          refNumber: `${userId}_${leaveDateStr}`,
          data: savedDoc,
        },
      ],
      description: `${toTitleCase(leaveType || "Unpaid")} leave applied for user ${userId} on ${leaveDateStr}. Reason: ${reason}`,
      refField: "userId",
    });
    res
      .status(201)
      .json({ success: true, message: "Leave applied successfully", leave });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// ── Self-service leave requests (user role) ─────────────────────────────────
// A staff member submits a request (always saved as "pending"); an admin
// then approves/rejects it. Staff and User are only linked by email (no
// stored userId), same pattern used everywhere else in this file.

// POST /requests/my — staff submits a new leave request
export const applyMyLeave = async (req, res) => {
  try {
    const email = req.user?.email?.toLowerCase().trim();
    const staff = email ? await Staff.findOne({ email }) : null;
    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "No staff profile is linked to your account yet. Contact your admin.",
      });
    }
    const userId = staff._id;

    // Accept { leaveDate } (single) OR { fromDate, toDate } (range).
    const { reason, leaveType, isHalfDay } = req.body;
    const fromDate = req.body.fromDate || req.body.leaveDate;
    // The staff form sends `endDate` for a Date Range request; older callers
    // send `toDate`. Accept either — before, `endDate` was ignored, so every
    // range request silently collapsed into a single day.
    const toDate = req.body.toDate || req.body.endDate || req.body.leaveDate;
    // Half-day only makes sense for a genuine single-day request — a
    // multi-day range keeps every day a full day off.
    const isSingleDay = fromDate === toDate;
    const dayValue = isSingleDay && isHalfDay ? 0.5 : 1;

    if (!fromDate || !toDate || !reason) {
      return res.status(400).json({
        success: false,
        message: "fromDate, toDate and reason are required",
      });
    }
    const validLeaveTypes = ["paid", "unpaid", "swapleave", "sick", "casual"];
    if (leaveType && !validLeaveTypes.includes(leaveType)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid leave type. Must be 'paid', 'unpaid', 'swapleave', 'sick', or 'casual'",
      });
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(fromDate) || !dateRe.test(toDate)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Use YYYY-MM-DD",
      });
    }
    if (fromDate > toDate) {
      return res.status(400).json({
        success: false,
        message: "fromDate must be on or before toDate",
      });
    }

    // No leave — of any type — can be applied until probation is over and
    // the staff member has been confirmed. Checked against the earliest
    // date in the request (fromDate).
    const probationBlockMessage = getProbationLeaveBlockMessage(staff, fromDate);
    if (probationBlockMessage) {
      return res.status(400).json({ success: false, message: probationBlockMessage });
    }

    const resolvedLeaveType = leaveType || "unpaid";
    const isBalanceTracked =
      resolvedLeaveType === "paid" ||
      resolvedLeaveType === "sick" ||
      resolvedLeaveType === "casual";

    // Balance check up front, same rule the admin-side applyLeave/
    // approveLeaveRequest endpoints enforce: a staff member must have at
    // least a full day (>= 1) of accrued balance left to take that type of
    // leave. Previously this self-service endpoint never checked at all —
    // a request just sat as "pending" with no feedback until an admin
    // rejected it at approval time, so someone with e.g. only 0.5 accrued
    // sick days could still submit (and think they'd succeeded).
    let remainingForBatchType = Infinity;
    if (isBalanceTracked) {
      const confirmationDate = staff.confirmationDate ?? null;
      const relievingDate =
        staff.status === "Relieved" ? staff.relievingDate : null;
      const availableApproved = await getRemainingForType(
        userId,
        confirmationDate,
        resolvedLeaveType,
        new Date(),
        relievingDate,
      );

      // Also account for this staff member's own already-pending requests
      // of the same type this year — those haven't been deducted from
      // `availableApproved` yet (only approved leave counts against it),
      // but they're still a promise on the same balance, so a new batch
      // shouldn't be allowed to double-book days that are already spoken
      // for by an earlier pending request.
      const batchYear = new Date(`${fromDate}T00:00:00.000Z`).getUTCFullYear();
      const yearStart = new Date(Date.UTC(batchYear, 0, 1, 0, 0, 0, 0));
      const yearEnd = new Date(Date.UTC(batchYear, 11, 31, 23, 59, 59, 999));
      const pendingSameTypeAgg = await Leave.aggregate([
        {
          $match: {
            userId,
            leaveType: resolvedLeaveType,
            status: "pending",
            leaveDate: { $gte: yearStart, $lte: yearEnd },
          },
        },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$dayValue", 1] } } } },
      ]);
      const pendingSameType = pendingSameTypeAgg[0]?.total || 0;

      remainingForBatchType = availableApproved - pendingSameType;

      if (remainingForBatchType < dayValue) {
        return res.status(400).json({
          success: false,
          message: `Insufficient ${resolvedLeaveType} leave balance for this calendar year. Choose Unpaid leave instead, or pick a different leave type.`,
        });
      }
    }
    // Unpaid, Swap and any other non-tracked type are never balance-checked,
    // so they can be requested directly at any time (previously Unpaid was
    // blocked while any Sick/Casual/Paid balance remained, which made the
    // Unpaid box in the form fail on submit).

    // Walk each calendar day in the range.
    const batchId = `${userId}-${Date.now()}`;
    const created = [];
    const skipped = [];

    // Iterate using UTC midnights so day math never drifts across timezones.
    let cursor = new Date(`${fromDate}T00:00:00.000Z`);
    const last = new Date(`${toDate}T00:00:00.000Z`);
    // Safety cap so a bad range can't spin forever.
    for (let guard = 0; cursor <= last && guard < 366; guard++) {
      const y = cursor.getUTCFullYear();
      const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
      const d = String(cursor.getUTCDate()).padStart(2, "0");
      const dayStr = `${y}-${m}-${d}`;

      const { start: parsedLeaveDate, end } = getDayRange(dayStr);

      // Skip Sundays.
      if (parsedLeaveDate.getUTCDay() === 0) {
        skipped.push({ date: dayStr, reason: "Sunday" });
      } else {
        const holidayCheck = await isHolidayOrSunday(parsedLeaveDate);
        if (holidayCheck.isHoliday && holidayCheck.reason !== "Sunday") {
          skipped.push({ date: dayStr, reason: holidayCheck.reason || "Holiday" });
        } else {
          const existing = await Leave.findOne({
            userId,
            leaveDate: { $gte: parsedLeaveDate, $lte: end },
            status: { $in: ["pending", "approved"] },
          });
          if (existing) {
            skipped.push({ date: dayStr, reason: "Already requested" });
          } else if (isBalanceTracked && remainingForBatchType < dayValue) {
            // The balance ran out partway through a multi-day range — every
            // day beyond this point in the SAME batch/type falls back to
            // unpaid leave rather than being silently dropped, so the staff
            // member still gets the day(s) off requested; they just aren't
            // drawn from a balance that no longer has anything left.
            const leave = new Leave({
              userId,
              leaveDate: parsedLeaveDate,
              reason,
              leaveType: "unpaid",
              status: "pending",
              batchId,
              dayValue,
            });
            await leave.save();
            created.push(leave);
          } else {
            const leave = new Leave({
              userId,
              leaveDate: parsedLeaveDate,
              reason,
              leaveType: resolvedLeaveType,
              status: "pending",
              batchId,
              dayValue,
            });
            await leave.save();
            created.push(leave);
            if (isBalanceTracked) remainingForBatchType -= dayValue;
          }
        }
      }
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }

    if (created.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No leave was created — every day in the range was a Sunday, a holiday, or already requested.",
        skipped,
      });
    }

    return res.status(201).json({
      success: true,
      message:
        created.length === 1
          ? "Leave request submitted. Waiting for admin approval."
          : `${created.length} days requested. Waiting for admin approval.`,
      created,
      skipped,
      batchId,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
};

// GET /requests/my — the caller's own leave requests, newest first
export const getMyLeaves = async (req, res) => {
  try {
    const email = req.user?.email?.toLowerCase().trim();
    const staff = email ? await Staff.findOne({ email }).lean() : null;
    if (!staff) {
      return res.status(200).json({ success: true, leaves: [] });
    }
    // Staff-only holidays set by an admin aren't leave requests.
    const leaves = await Leave.find({ userId: staff._id, leaveType: { $ne: "holiday" } })
      .sort({ leaveDate: -1 })
      .lean();
    res.json({ success: true, leaves });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// GET /requests/pending — admin: every leave request awaiting a decision
export const getPendingLeaveRequests = async (req, res) => {
  try {
    const leaves = await Leave.find({ status: "pending" })
      .sort({ createdAt: -1 })
      .populate("userId", "staffName email projectName staffId")
      .lean();
    res.json({ success: true, leaves });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// GET /requests/all — admin: every leave request, any status (approval history)
export const getAllLeaveRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { leaveType: { $ne: "holiday" } };
    if (status) filter.status = status;
    const leaves = await Leave.find(filter)
      .sort({ createdAt: -1 })
      .populate("userId", "staffName email projectName staffId")
      .lean();
    res.json({ success: true, leaves });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// POST /leave/reconcile-sandwich/:staffId — admin repair tool for data that
// was already created before this fix (e.g. an Excel import processed rows
// out of date order, so a Sunday-next-to-a-holiday block never got bridged
// even though the leave on both sides of it was approved). Re-runs the
// order-independent sandwich pass over that staff member's leave history
// so already-imported/applied leave gets bridged retroactively — no need
// to delete and re-import anything. Safe to call more than once.
// Optional ?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD narrow the window;
// without them, it covers every leave date on file for that staff member.
export const reconcileStaffSandwichLeave = async (req, res) => {
  try {
    const { staffId } = req.params;
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (req.query.fromDate && !dateRe.test(req.query.fromDate)) {
      return res
        .status(400)
        .json({ success: false, message: "fromDate must be in YYYY-MM-DD format" });
    }
    if (req.query.toDate && !dateRe.test(req.query.toDate)) {
      return res
        .status(400)
        .json({ success: false, message: "toDate must be in YYYY-MM-DD format" });
    }

    let fromDate = req.query.fromDate ? getDayRange(req.query.fromDate).start : null;
    let toDate = req.query.toDate ? getDayRange(req.query.toDate).start : null;

    if (!fromDate || !toDate) {
      const [earliest, latest] = await Promise.all([
        Leave.findOne({ userId: staffId }).sort({ leaveDate: 1 }).select("leaveDate").lean(),
        Leave.findOne({ userId: staffId }).sort({ leaveDate: -1 }).select("leaveDate").lean(),
      ]);
      if (!earliest || !latest) {
        return res.json({
          success: true,
          created: 0,
          message: "No leave records found for this staff member.",
        });
      }
      if (!fromDate) fromDate = earliest.leaveDate;
      if (!toDate) toDate = latest.leaveDate;
    }

    const created = await reconcileSandwichLeaveForRange(staffId, fromDate, toDate);

    await logActivity(req, {
      action: "UPDATE",
      actionLabel: `Reconciled sandwich leave for staff ${staffId}: ${created.length} day(s) bridged`,
      tableName: "leaves",
      tableLabel: "Leave",
      description: `Sandwich-leave reconciliation re-run for staff ${staffId} from ${dateKeyForLog(fromDate)} to ${dateKeyForLog(toDate)}: ${created.length} Sunday/holiday day(s) bridged into leave.`,
      refField: "userId",
    });

    res.json({ success: true, created: created.length, dates: created.map((c) => c.leaveDate) });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

const dateKeyForLog = (d) => new Date(d).toISOString().slice(0, 10);

// POST /reconcile-absences — admin (or a daily cron/PM2 job) triggers the
// absent-day auto-leave sweep for every staff member, up through
// yesterday (or an explicit `uptoDate` query param, "YYYY-MM-DD"). Safe to
// call more than once — see reconcileAllStaffAbsences for idempotency.
export const reconcileAbsences = async (req, res) => {
  try {
    let uptoDate = null;
    if (req.query.uptoDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.uptoDate)) {
        return res.status(400).json({
          success: false,
          message: "uptoDate must be in YYYY-MM-DD format",
        });
      }
      uptoDate = getDayRange(req.query.uptoDate).start;
    }

    const summary = await reconcileAllStaffAbsences(uptoDate);

    await logActivity(req, {
      action: "UPDATE",
      actionLabel: `Ran absence reconciliation: ${summary.leavesCreated} leave(s) auto-created, ${summary.leavesCleaned || 0} stale auto-mark(s) removed, across ${summary.staffProcessed} staff`,
      tableName: "leaves",
      tableLabel: "Leave",
      description: `Absence reconciliation processed ${summary.staffProcessed} staff, auto-created ${summary.leavesCreated} leave day(s), and removed ${summary.leavesCleaned || 0} previously over-marked absence day(s) that fell in untracked months.${summary.errors.length ? ` ${summary.errors.length} error(s).` : ""}`,
    });

    res.json({ success: true, ...summary });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// PUT /requests/:id/approve — admin approves a pending leave request
export const approveLeaveRequest = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid leave record ID" });
    }
    const leave = await Leave.findById(id);
    if (!leave) {
      return res
        .status(404)
        .json({ success: false, message: "Leave request not found" });
    }
    if (leave.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `This request is already ${leave.status}`,
      });
    }

    if (
      leave.leaveType === "paid" ||
      leave.leaveType === "sick" ||
      leave.leaveType === "casual"
    ) {
      const staffRecord = await getStaffById(leave.userId);
      const confirmationDate = staffRecord?.confirmationDate ?? null;
      const relievingDate =
        staffRecord?.status === "Relieved" ? staffRecord?.relievingDate : null;
      const available = await getRemainingForType(
        leave.userId,
        confirmationDate,
        leave.leaveType,
        new Date(),
        relievingDate,
      );
      const needed = leave.dayValue ?? 1;
      if (available < needed) {
        return res.status(400).json({
          success: false,
          message: `Staff has insufficient ${leave.leaveType} leave balance for this calendar year (${available} day(s) remaining). Reject this request or ask the staff member to resubmit it as Unpaid leave.`,
        });
      }
    }

    leave.status = "approved";
    leave.approvedBy = req.user._id;
    leave.approvedAt = new Date();
    await leave.save();

    // Best-effort: if this approval now brackets a weekend/holiday block
    // together with another approved leave on the other side, fill in the
    // sandwiched days too. Never let a hiccup here fail the approval
    // itself — the leave is already approved at this point.
    try {
      await reconcileSandwichLeave(leave);
    } catch (sandwichErr) {
      console.error("Sandwich leave reconciliation failed:", sandwichErr);
    }

    const leaveDateStr = formatDateForLog(leave.leaveDate);
    await logActivity(req, {
      action: "UPDATE",
      actionLabel: `Approved leave request for user ${leave.userId} on ${leaveDateStr}`,
      tableName: "leaves",
      tableLabel: "Leave",
      recordId: leave._id,
      newData: leave.toObject(),
      description: `Leave request approved for user ${leave.userId} on ${leaveDateStr}.`,
      refField: "userId",
    });

    res.json({ success: true, message: "Leave request approved", leave });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// PUT /requests/:id/reject — admin rejects a pending leave request
export const rejectLeaveRequest = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid leave record ID" });
    }
    const leave = await Leave.findById(id);
    if (!leave) {
      return res
        .status(404)
        .json({ success: false, message: "Leave request not found" });
    }
    if (leave.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `This request is already ${leave.status}`,
      });
    }

    leave.status = "rejected";
    leave.approvedBy = req.user._id;
    leave.approvedAt = new Date();
    if (req.body?.remarks) {
      leave.reason = `${leave.reason} [Admin: ${req.body.remarks}]`;
    }
    await leave.save();

    const leaveDateStr = formatDateForLog(leave.leaveDate);
    await logActivity(req, {
      action: "UPDATE",
      actionLabel: `Rejected leave request for user ${leave.userId} on ${leaveDateStr}`,
      tableName: "leaves",
      tableLabel: "Leave",
      recordId: leave._id,
      newData: leave.toObject(),
      description: `Leave request rejected for user ${leave.userId} on ${leaveDateStr}.`,
      refField: "userId",
    });

    res.json({ success: true, message: "Leave request rejected", leave });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// PUT /leave/:id
export const updateLeave = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid leave record ID" });
    const previousRecord = await Leave.findById(id).lean();
    if (!previousRecord)
      return res
        .status(404)
        .json({ success: false, message: "Leave record not found" });
    const { leaveDate, reason, leaveType, status } = req.body;
    if (
      leaveType &&
      !["paid", "unpaid", "swapleave", "sick", "casual"].includes(leaveType)
    )
      return res
        .status(400)
        .json({ success: false, message: "Invalid leave type" });

    // Same probation/confirmation gate applyLeave and applyMyLeave enforce
    // at creation time — re-checked here because an edit can move a leave
    // record onto (or leave it on) a date before the staff member was ever
    // eligible for leave, e.g. correcting the date on an existing record.
    // Only runs the check when the effective date actually being saved
    // (the new leaveDate, or the record's existing one if unchanged) needs
    // validating — a pure reason/status edit that doesn't touch the date
    // still gets re-checked against whichever date the record already has,
    // so a record can't be quietly re-approved into an ineligible date.
    const effectiveLeaveDate = leaveDate || previousRecord.leaveDate;
    if (effectiveLeaveDate) {
      const staffForGate = await Staff.findById(previousRecord.userId)
        .select(
          "date status internshipMonths internshipEndDate confirmationDate confirmationMonths probationMonths",
        )
        .lean();
      const probationBlockMessage = getProbationLeaveBlockMessage(
        staffForGate,
        effectiveLeaveDate,
      );
      if (probationBlockMessage) {
        return res
          .status(400)
          .json({ success: false, message: probationBlockMessage });
      }
    }

    const updated = await Leave.findByIdAndUpdate(
      id,
      {
        ...(leaveDate && { leaveDate: new Date(leaveDate) }),
        ...(reason && { reason }),
        ...(leaveType && { leaveType }),
        ...(status && { status }),
        updatedAt: new Date(),
      },
      { new: true },
    );
    // Keep sandwich days consistent with whatever this edit just did:
    //  - if the record is (still/now) approved, it may newly bracket a
    //    Sunday/holiday block together with an approved leave on the other
    //    side (e.g. its date or leaveType just changed) — check again.
    //  - if it used to be approved and no longer is (status changed away,
    //    or it moved off the date that made it a bracket), any sandwich
    //    day that only existed because of this record should be removed.
    if (updated.status === "approved") {
      try {
        await reconcileSandwichLeave(updated);
      } catch (sandwichErr) {
        console.error("Sandwich leave reconciliation failed (edit):", sandwichErr);
      }
    } else if (previousRecord.status === "approved") {
      try {
        await cleanupSandwichLeavesFor(updated._id);
      } catch (cleanupErr) {
        console.error("Sandwich leave cleanup failed (edit):", cleanupErr);
      }
    }

    const updatedDoc = updated.toObject();
    const leaveDateStr = formatDateForLog(updated.leaveDate);
    await logActivity(req, {
      action: "UPDATE",
      actionLabel: `Updated ${toTitleCase(updated.leaveType)} Leave for User ${updated.userId} on ${leaveDateStr}`,
      tableName: "leaves",
      tableLabel: "Leave",
      recordId: id,
      referenceNumber: `${updated.userId}_${leaveDateStr}`,
      previousData: previousRecord,
      newData: updatedDoc,
      previousSnapshots: [
        {
          recordId: String(id),
          refNumber: `${previousRecord.userId}_${formatDateForLog(previousRecord.leaveDate)}`,
          data: previousRecord,
        },
      ],
      newSnapshots: [
        {
          recordId: String(id),
          refNumber: `${updated.userId}_${leaveDateStr}`,
          data: updatedDoc,
        },
      ],
      description: `Leave record updated for user ${updated.userId} on ${leaveDateStr}. Type: ${updated.leaveType}, Status: ${updated.status}`,
      refField: "userId",
    });
    res.json({
      success: true,
      message: "Leave record updated successfully",
      leave: updatedDoc,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// DELETE /leave/:id
export const deleteLeave = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid leave record ID" });
    const leave = await Leave.findById(id).lean();
    if (!leave)
      return res
        .status(404)
        .json({ success: false, message: "Leave record not found" });
    await Leave.findByIdAndDelete(id);

    // If this leave had bracketed a weekend/holiday into sandwich leave,
    // those auto-created days no longer have anything justifying them.
    let sandwichCleanupCount = 0;
    try {
      sandwichCleanupCount = await cleanupSandwichLeavesFor(leave._id);
    } catch (cleanupErr) {
      console.error("Sandwich leave cleanup failed:", cleanupErr);
    }
    // Re-judge the Sunday/holiday next to this date: deleting a Saturday or
    // Monday leave must remove an Unpaid sandwich Sunday that relied on it,
    // and deleting one day of a longer run can turn it into a Sat+Mon case.
    if (!leave.isSandwich) {
      try {
        await reconcileSandwichLeave(leave);
      } catch (sandwichErr) {
        console.error("Sandwich re-check failed (delete):", sandwichErr);
      }
    }

    const leaveDateStr = formatDateForLog(leave.leaveDate);
    await logActivity(req, {
      action: "DELETE",
      actionLabel: `Deleted ${toTitleCase(leave.leaveType)} Leave for User ${leave.userId} on ${leaveDateStr}`,
      tableName: "leaves",
      tableLabel: "Leave",
      recordId: leave._id,
      referenceNumber: `${leave.userId}_${leaveDateStr}`,
      previousData: leave,
      previousSnapshots: [
        {
          recordId: String(leave._id),
          refNumber: `${leave.userId}_${leaveDateStr}`,
          data: leave,
        },
      ],
      description: `${toTitleCase(leave.leaveType)} leave for user ${leave.userId} on ${leaveDateStr} deleted. Status was: ${leave.status}`,
      refField: "userId",
    });
    res.json({
      success: true,
      message:
        sandwichCleanupCount > 0
          ? `Leave record deleted successfully. ${sandwichCleanupCount} sandwich leave day(s) also removed.`
          : "Leave record deleted successfully",
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// POST /attendance/record
export const recordAttendance = async (req, res) => {
  try {
    const { userId, loginTime, logoutTime, workingHoursPerDay, status, date } =
      req.body;
    const isMarker = status === "absent" || status === "half-day";

    // A time is no longer mandatory — if the admin leaves login/logout
    // blank, it falls back to the office's default shift (10:00 AM–6:30
    // PM) below. A date is still required so we know which day to record.
    if (!userId || (!loginTime && !date))
      return res.status(400).json({
        success: false,
        message: "User ID and date are required",
      });

    let loginDT, logoutDT, dateString;
    if (isMarker) {
      dateString = date;
      // Shift start (10:00 IST), not 00:00 IST — midnight IST is 18:30 UTC
      // on the PREVIOUS day, so anything reading the UTC day put the mark
      // one day early (6 Aug half day showed on 5 Aug).
      loginDT = parseDT(`${date}T${DEFAULT_SHIFT_START}:00`);
    } else {
      dateString = loginTime ? getDateStringIST(parseDT(loginTime)) : date;
      loginDT = loginTime
        ? parseDT(loginTime)
        : parseDT(`${dateString}T${DEFAULT_SHIFT_START}:00`);
      logoutDT = logoutTime
        ? parseDT(logoutTime)
        : parseDT(`${dateString}T${DEFAULT_SHIFT_END}:00`);
      if (logoutDT <= loginDT)
        return res.status(400).json({
          success: false,
          message: "Logout time must be after login time",
        });
    }

    const holidayCheck = await isHolidayOrSunday(loginDT);
    if (holidayCheck.isHoliday)
      return res.status(400).json({
        success: false,
        message: `Cannot record attendance on ${holidayCheck.reason}`,
      });
    if (await findExistingAttendance(userId, dateString))
      return res.status(400).json({
        success: false,
        message:
          "Attendance already recorded for this user on the selected date",
      });

    const bankMinutesAvailable = isMarker ? 0 : await getAvailableBankMinutes(userId);
    const fields = buildAttendanceFields({
      userId,
      dateString,
      status: isMarker ? status : undefined,
      loginTime: loginDT,
      logoutTime: logoutDT,
      source: "manual",
      bankMinutesAvailable,
    });
    if (!isMarker && workingHoursPerDay) fields.workingHoursPerDay = workingHoursPerDay;
    const attendanceType = fields.attendanceType;
    const totalTime = fields.totalTime;
    const extraMinutes = fields.extraHoursInMinutes || 0;
    const extraHours = fields.extraHours;
    const attendance = new Attendance(fields);
    await attendance.save();
    // Only spend the bank once the day's own record has actually saved —
    // if the save above throws (e.g. the unique userId+date index), nothing
    // should be deducted.
    if (fields.bankMinutesUsed > 0) {
      await deductFromExtraHoursBank(userId, fields.bankMinutesUsed);
    }

    // Presence always wins: if this staff member already had an approved
    // Leave sitting on this same date (e.g. an admin applied a whole
    // date-range of paid leave in advance and the staff member came in
    // anyway on one day in the middle of it), that Leave is cancelled here
    // — balance restored, any Sunday/holiday it had bracketed cleaned up —
    // so the day correctly shows Present instead of Leave. Best-effort:
    // never blocks the attendance record that was just saved.
    const conflictStaffId = await resolveStaffIdByUserId(userId);
    if (conflictStaffId) {
      await cancelConflictingLeaveOnAttendance(conflictStaffId, dateString);
    }

    const savedDoc = attendance.toObject();
    await logActivity(req, {
      action: "CREATE",
      actionLabel: `Recorded ${toTitleCase(attendanceType)} Day Attendance for User ${userId} on ${dateString}`,
      tableName: "attendance",
      tableLabel: "Attendance",
      recordId: attendance._id,
      referenceNumber: `${userId}_${dateString}`,
      newData: savedDoc,
      newSnapshots: [
        {
          recordId: String(attendance._id),
          refNumber: `${userId}_${dateString}`,
          data: savedDoc,
        },
      ],
      description: `${toTitleCase(attendanceType)} day attendance recorded for user ${userId} on ${dateString}. Worked: ${totalTime}, Extra: ${extraHours}`,
      refField: "userId",
    });
    res.status(201).json({
      success: true,
      message:
        attendanceType === "half"
          ? `Half-day attendance recorded successfully (${totalTime} worked)`
          : `Full-day attendance recorded successfully (${totalTime} worked)`,
      attendance: {
        ...savedDoc,
        loginTime: attendance.loginTime,
        logoutTime: attendance.logoutTime,
        attendanceType,
        isHalfDay: attendanceType === "half",
        extraHoursInMinutes: extraMinutes,
      },
    });
  } catch (error) {
    console.error("Record Attendance Failed:", error.message);
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// POST /attendance/checkin — self sign-in. Any logged-in user (not just
// admin) can call this; it always acts on the caller's own account.
//
// Session-continuation rule: if the user already signed out today AND had
// worked less than 2 hours (sessionMinutes < 120) before that sign-out, a
// fresh sign-in reopens the SAME record instead of being blocked — the day's
// worked time keeps accumulating in `sessionMinutes` across sessions. Once
// 2+ hours have been logged for the day, the day is considered complete and
// a further sign-in is blocked, same as before.
//
// Exported as a plain function (not just the Express handler) so it can also
// be called right after a successful login (see controllers/authController.js)
// to auto-sign-in the user, without duplicating this logic.
export const performSelfCheckIn = async (userId, { source = "self", at } = {}) => {
  const now = at || new Date();

  const holidayCheck = await isHolidayOrSunday(now);
  if (holidayCheck.isHoliday) {
    return {
      ok: false,
      status: 400,
      message: `Cannot sign in on ${holidayCheck.reason}`,
    };
  }

  const dateString = getDateStringIST(now);
  const existing = await findAttendanceByUserAndDate(userId, dateString);

  if (existing) {
    if (!existing.logoutTime) {
      // Already signed in — nothing to change, just report current state.
      return { ok: true, alreadySignedIn: true, attendance: existing };
    }

    if ((existing.sessionMinutes || 0) < 120) {
      // Less than 2 hours worked so far today — resume the same record.
      existing.loginTime = now;
      existing.logoutTime = undefined;
      await existing.save();
      return { ok: true, resumed: true, attendance: existing };
    }

    return {
      ok: false,
      status: 400,
      message: "You have already signed in and out today",
      attendance: existing,
    };
  }

  const attendance = await Attendance.create({
    userId,
    loginTime: now,
    date: dateString,
    source,
    sessionMinutes: 0,
  });

  // Same self-heal as the admin "Record Attendance" path: a real sign-in
  // always beats an already-approved Leave sitting on the same date.
  const conflictStaffId = await resolveStaffIdByUserId(userId);
  if (conflictStaffId) {
    await cancelConflictingLeaveOnAttendance(conflictStaffId, dateString);
  }

  return { ok: true, created: true, attendance };
};

// POST /attendance/auto-checkin — fired automatically by the frontend when
// the app loads (App.jsx), NOT a button the user clicks. Unlike the manual
// "Sign In" button (checkIn below), this only actually marks attendance
// when the request comes from the office network — see
// utils/officeNetwork.js for why and how that's configured. Admins are
// skipped entirely, same as the auto-checkin that already runs on login.
//
// Always responds 200 (never an error the frontend needs to handle) since
// this is a background convenience call the user never sees — "skipped"
// just means nothing happened, not that anything went wrong.
export const autoCheckIn = async (req, res) => {
  try {
    if (!autoAttendanceApplies(req.user.role)) {
      return res.status(200).json({ success: true, skipped: true, reason: "admin" });
    }

    if (!isFromOfficeNetwork(req)) {
      return res
        .status(200)
        .json({ success: true, skipped: true, reason: "not_office_network" });
    }

    const userId = req.user._id || req.user.id;
    const result = await performSelfCheckIn(userId);
    return res.status(200).json({ success: true, skipped: false, ...result });
  } catch (error) {
    console.error("Auto check-in failed:", error.message);
    return res.status(200).json({ success: true, skipped: true, reason: "error" });
  }
};

// Builds the shift/lunch/required-hours info the frontend needs to decide
// whether the Sign Out button should be enabled, plus how many minutes have
// been worked and how many remain. Shared by checkin/checkout/status routes
// so the frontend always sees the same numbers the backend enforces.
const buildAttendanceMeta = (user, record) => {
  const { shiftStartTime, shiftEndTime } = getUserShift(user);
  let workedMinutes = record?.sessionMinutes || 0;

  if (record?.loginTime && !record.logoutTime) {
    workedMinutes += getClampedWorkingMinutes(
      record.loginTime,
      new Date(),
      shiftStartTime,
      shiftEndTime,
    );
  }

  const earlySignOutApproved = !!record?.earlySignOutApproved;
  const remainingMinutes = Math.max(0, REQUIRED_WORK_MINUTES - workedMinutes);
  const canSignOut =
    !!record &&
    !record.logoutTime &&
    (workedMinutes >= REQUIRED_WORK_MINUTES || earlySignOutApproved);

  return {
    shiftStartTime,
    shiftEndTime,
    lunchStart: LUNCH_START,
    lunchEnd: LUNCH_END,
    requiredMinutes: REQUIRED_WORK_MINUTES,
    workedMinutes,
    remainingMinutes,
    earlySignOutApproved,
    canSignOut,
  };
};

export const checkIn = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const result = await performSelfCheckIn(userId);
    const meta = buildAttendanceMeta(req.user, result.attendance);

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
        attendance: result.attendance,
        meta,
      });
    }

    if (result.alreadySignedIn) {
      return res.status(400).json({
        success: false,
        message: "You are already signed in",
        attendance: result.attendance,
        meta,
      });
    }

    res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.resumed
        ? "Signed in successfully — continuing today's session"
        : "Signed in successfully",
      attendance: result.attendance,
      meta,
    });
  } catch (error) {
    console.error("Check-in Failed:", error.message);
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// Closes an open attendance record at `logoutAt`: computes worked time
// (shift window, lunch excluded, overtime), full/half/short classification
// and extra-hours bank usage. Shared by the Sign Out button (checkOut) and
// the automatic sign-out (services/presence.js) so both produce identical
// numbers. `auto` = system sign-out (no 7h45m check, reason recorded).
export const finalizeSignOut = async (
  open,
  user,
  logoutAt,
  { wasEarly = false, auto = false, reason = null, reasonText = "" } = {},
) => {
  const userId = open.userId;
  const { shiftStartTime, shiftEndTime } = getUserShift(user);
  const safeLogout =
    logoutAt && new Date(logoutAt) > new Date(open.loginTime)
      ? new Date(logoutAt)
      : new Date(open.loginTime);

  const { netMinutes: currentSessionNet, overtimeMinutes } =
    getWorkedMinutesBreakdown(
      open.loginTime,
      safeLogout,
      shiftStartTime,
      shiftEndTime,
    );
  const totalMinutesWorked = (open.sessionMinutes || 0) + currentSessionNet;
  const effectiveMinutes = totalMinutesWorked + overtimeMinutes;

  const totalTime = formatMinutesToTimeString(effectiveMinutes);
  const bankMinutesAvailable = await getAvailableBankMinutes(userId);
  const { type: attendanceType, bankMinutesUsed, extraMinutesEarned } =
    classifyWorkedMinutes(effectiveMinutes, bankMinutesAvailable, open.loginTime);

  open.logoutTime = safeLogout;
  open.sessionMinutes = effectiveMinutes;
  open.totalTime = totalTime;
  open.attendanceType = attendanceType;
  open.extraHours = formatMinutesToTimeString(extraMinutesEarned);
  open.extraHoursInMinutes = extraMinutesEarned;
  open.bankMinutesUsed = bankMinutesUsed;
  const base = `Working hours counted within shift (${shiftStartTime}–${shiftEndTime}, lunch excluded). Worked: ${totalTime}`;
  if (auto) {
    open.autoSignedOut = true;
    open.signOutReason = reason;
    open.remarks = `Automatic sign-out${reasonText ? ` (${reasonText})` : ""}. ${base}`;
  } else {
    open.autoSignedOut = false;
    open.signOutReason = undefined;
    open.remarks = wasEarly ? `Admin-approved early sign-out. ${base}` : base;
  }
  await open.save();

  if (bankMinutesUsed > 0) {
    await deductFromExtraHoursBank(userId, bankMinutesUsed);
  }

  return { totalTime, attendanceType, totalMinutesWorked, effectiveMinutes };
};

// POST /attendance/checkout — self sign-out. Working hours only count inside
// the user's shift window (default 10:00 AM – 6:30 PM; some staff are set to
// 9:00 AM – 5:30 PM), with the 1:30–2:15 PM lunch break subtracted. A
// sign-out is blocked until 7h 45m of NET working time has been logged for
// the day, unless an admin has explicitly approved an early sign-out for
// this user's record (`earlySignOutApproved`). Worked minutes from this
// session are ADDED to any earlier session's sessionMinutes for the day
// (see the resume logic in performSelfCheckIn).
export const checkOut = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const now = new Date();
    const dateString = getDateStringIST(now);
    const { shiftStartTime, shiftEndTime } = getUserShift(req.user);

    const open = await findOpenAttendanceForDate(userId, dateString);
    if (!open) {
      return res.status(400).json({
        success: false,
        message: "You haven't signed in yet today",
      });
    }

    const { netMinutes: currentSessionNet, overtimeMinutes } = getWorkedMinutesBreakdown(
      open.loginTime,
      now,
      shiftStartTime,
      shiftEndTime,
    );
    // sessionMinutes accumulates NET minutes across sign-in/out sessions for
    // the day (see performSelfCheckIn's resume logic); overtime is only
    // meaningful for this final session, since it's time past shift end.
    const totalMinutesWorked = (open.sessionMinutes || 0) + currentSessionNet;
    const effectiveMinutes = totalMinutesWorked + overtimeMinutes;

    // Block the sign-out until the required net working time is complete,
    // unless an admin has approved an early sign-out for this record.
    if (
      totalMinutesWorked < REQUIRED_WORK_MINUTES &&
      !open.earlySignOutApproved
    ) {
      const remaining = REQUIRED_WORK_MINUTES - totalMinutesWorked;
      return res.status(400).json({
        success: false,
        message: `You can't sign out yet — ${formatMinutesToTimeString(remaining)} of working time remaining (7h 45m required, lunch break already excluded). Ask an admin to approve an early sign-out if needed.`,
        attendance: open,
        meta: buildAttendanceMeta(req.user, open),
      });
    }

    const { totalTime } = await finalizeSignOut(open, req.user, now, {
      wasEarly:
        totalMinutesWorked < REQUIRED_WORK_MINUTES && open.earlySignOutApproved,
    });

    res.json({
      success: true,
      message: `Signed out successfully. Working hours: ${totalTime}`,
      attendance: open,
      meta: buildAttendanceMeta(req.user, open),
    });
  } catch (error) {
    console.error("Check-out Failed:", error.message);
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};


export const getMyMonthAttendance = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    const year = Number(req.query.year);
    const month = Number(req.query.month); // 1-indexed from the app
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        message: "Valid ?year=YYYY&month=MM (month 1-12) are required.",
      });
    }

    const mm = String(month).padStart(2, "0");
    const start = `${year}-${mm}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const daysInMonth = endOfMonth.getUTCDate();

    const [rows, dbHolidays] = await Promise.all([
      Attendance.find({ userId, date: { $gte: start, $lt: end } })
        .sort({ date: 1 })
        .lean(),
      Holiday.find({
        enabled: true,
        startDate: { $lte: endOfMonth },
        endDate: { $gte: startOfMonth },
      }).lean(),
    ]);

    // Recurring "Nth Saturday" rules -> concrete Holiday-shaped entries,
    // reusing the same helper the admin calendar already relies on.
    const saturdayHolidays = (await getSaturdayHolidaysAsEntries(year)).filter(
      (h) => new Date(h.startDate) >= startOfMonth && new Date(h.startDate) <= endOfMonth,
    );
    const allHolidays = [...dbHolidays, ...saturdayHolidays];

    // Seed every calendar day of the month, marking Sundays and any
    // matching Holiday/Saturday-rule range as "holiday" up front — not
    // just the days that happen to have an attendance row.
    const byDate = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(Date.UTC(year, month - 1, d));
      const dateStr = `${year}-${mm}-${String(d).padStart(2, "0")}`;
      const isSunday = dateObj.getUTCDay() === 0;

      byDate[dateStr] = {
        date: dateStr,
        loginTime: null,
        logoutTime: null,
        status: isSunday ? "holiday" : undefined,
        holidayName: isSunday ? "Sunday" : undefined,
      };

      for (const h of allHolidays) {
        const s = new Date(h.startDate);
        const e = new Date(h.endDate || h.startDate);
        if (dateObj >= s && dateObj <= e) {
          byDate[dateStr].status = "holiday";
          byDate[dateStr].holidayName = h.name;
          break;
        }
      }
    }

    // Fill in real punch data; only override the holiday seeding if the
    // person actually has an attendance row for that (holiday) day.
    for (const r of rows) {
      const dateStr = r.date || (r.loginTime ? getDateStringIST(r.loginTime) : null);
      if (!dateStr || !byDate[dateStr]) continue;
      byDate[dateStr].loginTime = r.loginTime || null;
      byDate[dateStr].logoutTime = r.logoutTime || null;
      if (byDate[dateStr].status !== "holiday") {
        byDate[dateStr].status = deriveCalendarStatus(r);
      }
    }

    // NOTE: Saturdays are only "holiday" here via the admin-configured
    // Saturday Holiday Rule or a manually-added Holiday record, both of
    // which are already seeded into `byDate` above. A blanket fallback
    // that force-marked every unworked Saturday as a holiday used to live
    // here — it overrode the admin's per-month occurrence choices (e.g.
    // unchecking 3rd & 4th Saturday for a month had no visible effect
    // because this fallback re-applied "holiday" to it anyway), so it has
    // been removed.

    res.json({ success: true, records: Object.values(byDate) });
  } catch (error) {
    console.error("Get My Month Attendance Failed:", error.message);
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

function deriveCalendarStatus(r) {
  if (r.isLeaveDay) return "leave";                 // blue block
  if (r.attendanceType === "half") return "half-day"; // amber block
  if (r.status === "absent") return "absent";        // red block
  return "present";                                   // green block (present/late)
}
export const getMyTodayAttendance = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const dateString = getDateStringIST(new Date());
    const record = await findAttendanceByUserAndDate(userId, dateString);
    res.json({
      success: true,
      attendance: record || null,
      meta: buildAttendanceMeta(req.user, record),
    });
  } catch (error) {
    console.error("Get My Attendance Failed:", error.message);
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// POST /attendance/allow-early-signout — admin only. Grants (or revokes) a
// specific user permission to sign out today before the 7h45m requirement
// is met. Requires the user to already have today's attendance record
// (i.e. they've signed in).
export const setEarlySignOutPermission = async (req, res) => {
  try {
    const { userId, allow = true } = req.body;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "A valid userId is required" });
    }

    const dateString = getDateStringIST(new Date());
    const record = await findAttendanceByUserAndDate(userId, dateString);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: "This user hasn't signed in today yet — nothing to approve.",
      });
    }

    record.earlySignOutApproved = !!allow;
    record.earlySignOutApprovedBy = allow
      ? req.user._id || req.user.id
      : undefined;
    record.earlySignOutApprovedAt = allow ? new Date() : undefined;
    await record.save();

    await logActivity(req, {
      action: "UPDATE",
      tableName: "attendance",
      recordId: record._id,
      description: allow
        ? `Early sign-out approved for user ${userId} on ${dateString}`
        : `Early sign-out permission revoked for user ${userId} on ${dateString}`,
    });

    res.json({
      success: true,
      message: allow
        ? "Early sign-out approved — the user's Sign Out button will unlock now."
        : "Early sign-out permission revoked.",
      attendance: record,
    });
  } catch (error) {
    console.error("Set Early Sign-Out Permission Failed:", error.message);
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// GET /attendance/open-today — admin only. Lists everyone currently signed
// in (no logoutTime yet) today, with live worked/remaining minutes, so an
// admin can see who's close to the 7h45m mark and approve early sign-outs.
export const getOpenAttendanceToday = async (req, res) => {
  try {
    const dateString = getDateStringIST(new Date());
    const records = await Attendance.find({
      date: dateString,
      logoutTime: { $exists: false },
    })
      .populate(
        "userId",
        "name firstName lastName email shiftStartTime shiftEndTime",
      )
      .lean();

    const now = new Date();
    const data = records.map((r) => {
      const { shiftStartTime, shiftEndTime } = getUserShift(r.userId);
      const liveMinutes = getClampedWorkingMinutes(
        r.loginTime,
        now,
        shiftStartTime,
        shiftEndTime,
      );
      const workedMinutes = (r.sessionMinutes || 0) + liveMinutes;
      return {
        attendanceId: r._id,
        userId: r.userId?._id,
        name:
          r.userId?.name ||
          `${r.userId?.firstName || ""} ${r.userId?.lastName || ""}`.trim() ||
          "Unknown",
        email: r.userId?.email,
        loginTime: r.loginTime,
        shiftStartTime,
        shiftEndTime,
        workedMinutes,
        requiredMinutes: REQUIRED_WORK_MINUTES,
        remainingMinutes: Math.max(0, REQUIRED_WORK_MINUTES - workedMinutes),
        earlySignOutApproved: !!r.earlySignOutApproved,
      };
    });

    res.json({ success: true, records: data });
  } catch (error) {
    console.error("Get Open Attendance Failed:", error.message);
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// POST /attendance/import
export const importAttendance = async (req, res) => {
  try {
    const attendanceData = req.body;
    if (!Array.isArray(attendanceData) || attendanceData.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "No attendance data provided" });
    const results = { success: 0, failed: 0, errors: [] };
    const importedDocs = [];

    // Rows may identify the staff member by userId directly, or by
    // staffEmail (the Excel importer on the frontend only knows the staff's
    // email, not their login User._id) — resolve those up front in one query.
    const emailByIdxNeeded = attendanceData
      .map((r) => r.staffEmail)
      .filter(Boolean);
    const userIdByEmail = await resolveUserIdByEmail(emailByIdxNeeded);

    for (const [index, row] of attendanceData.entries()) {
      try {
        const {
          loginTime,
          logoutTime,
          workingHoursPerDay,
          status,
          date,
          staffEmail,
        } = row;
        let { userId } = row;
        if (!userId && staffEmail) {
          userId = userIdByEmail[String(staffEmail).toLowerCase()];
        }
        const isMarker = status === "absent" || status === "half-day";

        if (!userId) {
          results.failed++;
          results.errors.push(
            `Row ${index + 1}: Could not resolve staff (missing/unknown userId or staffEmail)`,
          );
          continue;
        }
        // A row no longer needs both loginTime and logoutTime — any time
        // left out defaults to the office's standard shift (10:00 AM–6:30
        // PM) below. We still need a date (either from the row's own
        // `date`, or derived from loginTime) to know which day it's for.
        if (!loginTime && !date) {
          results.failed++;
          results.errors.push(`Row ${index + 1}: Missing date`);
          continue;
        }

        let loginDT, logoutDT, dateString;
        if (isMarker) {
          dateString = date;
          // Shift start, not 00:00 IST (= previous day in UTC) — see recordAttendance.
          loginDT = parseDT(`${date}T${DEFAULT_SHIFT_START}:00`);
          if (isNaN(loginDT.getTime())) {
            results.failed++;
            results.errors.push(`Row ${index + 1}: Invalid date format`);
            continue;
          }
        } else {
          dateString = loginTime ? getDateStringIST(parseDT(loginTime)) : date;
          loginDT = loginTime
            ? parseDT(loginTime)
            : parseDT(`${dateString}T${DEFAULT_SHIFT_START}:00`);
          logoutDT = logoutTime
            ? parseDT(logoutTime)
            : parseDT(`${dateString}T${DEFAULT_SHIFT_END}:00`);
          if (isNaN(loginDT.getTime()) || isNaN(logoutDT.getTime())) {
            results.failed++;
            results.errors.push(`Row ${index + 1}: Invalid date format`);
            continue;
          }
          if (logoutDT <= loginDT) {
            results.failed++;
            results.errors.push(
              `Row ${index + 1}: Logout time must be after login time`,
            );
            continue;
          }
        }

        const holidayCheck = await isHolidayOrSunday(loginDT);
        if (holidayCheck.isHoliday) {
          results.failed++;
          results.errors.push(
            `Row ${index + 1}: Cannot record on ${holidayCheck.reason}`,
          );
          continue;
        }
        if (await findExistingAttendance(userId, dateString)) {
          results.failed++;
          results.errors.push(
            `Row ${index + 1}: Attendance already exists for user ${userId} on ${dateString}`,
          );
          continue;
        }

        const bankMinutesAvailable = isMarker ? 0 : await getAvailableBankMinutes(userId);
        const fields = buildAttendanceFields({
          userId,
          dateString,
          status: isMarker ? status : undefined,
          loginTime: loginDT,
          logoutTime: logoutDT,
          source: "import",
          bankMinutesAvailable,
        });
        if (!isMarker && workingHoursPerDay)
          fields.workingHoursPerDay = workingHoursPerDay;

        const attendance = new Attendance(fields);
        await attendance.save();
        if (fields.bankMinutesUsed > 0) {
          await deductFromExtraHoursBank(userId, fields.bankMinutesUsed);
        }

        // Same self-heal as the manual and self-check-in paths: a real
        // attendance row for this date always beats any approved Leave the
        // staff member already has sitting on it.
        const conflictStaffId = await resolveStaffIdByUserId(userId);
        if (conflictStaffId) {
          await cancelConflictingLeaveOnAttendance(conflictStaffId, dateString);
        }

        importedDocs.push(attendance.toObject());
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`Row ${index + 1}: ${err.message}`);
      }
    }
    if (results.success > 0)
      await logActivity(req, {
        action: "IMPORT",
        actionLabel: `Imported ${results.success} Attendance Record(s) from Excel`,
        tableName: "attendance",
        tableLabel: "Attendance",
        description: `Excel import: ${results.success} saved, ${results.failed} failed.`,
        newData: importedDocs,
        newSnapshots: importedDocs.map((d) => ({
          recordId: String(d._id),
          refNumber: `${d.userId}_${formatDateForLog(d.loginTime)}`,
          data: d,
        })),
      });
    res.json({
      success: results.success > 0,
      message:
        results.success === attendanceData.length
          ? `All ${results.success} records imported successfully`
          : results.success > 0
            ? `Partial import: ${results.success} saved, ${results.failed} failed`
            : `Import failed: all ${results.failed} records failed`,
      importedCount: results.success,
      failedCount: results.failed,
      errors: results.errors,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// Staff._id + calendar month -> "has this staff member got ZERO real
// Attendance records anywhere in that month?" Cached per (staff, year,
// month) so a whole month's worth of Sunday/holiday rows in one import
// only trigger one Attendance query each, not one per row.
//
// Why this matters: the Sunday/holiday guard below exists to stop an
// accidental import from marking an ordinary non-working day as leave.
// But when a whole calendar month has no attendance tracked for a staff
// member at all (a data gap, before tracking started, an office
// closure that was never logged, etc.), the admin needs to backfill
// EVERY day of that month — Sundays and public holidays included — as
// leave (typically unpaid), and the guard has nothing real left to
// protect: there's no "ordinary week" for it to accidentally clobber.
// `cache` is a Map the caller owns (one fresh Map per import request — see
// importLeaves) so results don't leak between unrelated requests and don't
// go stale if attendance data changes between one import and the next.
const isMonthUntracked = async (cache, staffId, year, month) => {
  const cacheKey = `${staffId}_${year}_${month}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  // Same email bridge as resolveStaffIdByEmail/resolveUserIdByEmail:
  // Leave.userId is Staff._id but Attendance.userId is the login
  // User._id, so we go Staff -> email -> User to find attendance.
  const staff = await Staff.findById(staffId).select("email").lean();
  const attendanceUserId = staff?.email
    ? (await resolveUserIdByEmail([staff.email]))[staff.email.toLowerCase()]
    : null;

  let untracked = true; // no linked login account at all -> nothing is ever "tracked"
  if (attendanceUserId) {
    const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
    const anyAttendance = await Attendance.findOne({
      userId: attendanceUserId,
      loginTime: { $gte: monthStart, $lte: monthEnd },
    })
      .select("_id")
      .lean();
    untracked = !anyAttendance;
  }
  cache.set(cacheKey, untracked);
  return untracked;
};

// Small rounding helper — mirrors round2() in services/leaveBalance.js so
// half-day arithmetic here (e.g. splitting a day across Sick + Casual)
// doesn't accumulate floating-point noise like 0.30000000000000004.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// POST /leave/import
export const importLeaves = async (req, res) => {
  try {
    const leavesData = req.body;
    if (!Array.isArray(leavesData) || leavesData.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "No leave data provided" });
    const results = { success: 0, failed: 0, errors: [], warnings: [] };
    const importedDocs = [];
    // Tracks the earliest/latest leaveDate imported per staff member so a
    // single order-independent sandwich-reconciliation pass can run per
    // user after the loop below, instead of per-row (see the comment above
    // the reconcileSandwichLeaveForRange call further down).
    const touchedRangeByUser = new Map();
    // Scoped to this one import request — see isMonthUntracked.
    const untrackedMonthCache = new Map();
    const validLeaveTypes = ["paid", "unpaid", "swapleave", "sick", "casual"];
    // The frontend template/parser already normalizes common human-friendly
    // labels ("Casual Leave", "Sick Leave", ...) down to the canonical enum
    // values below, but this endpoint can also be hit directly (or with an
    // older/edited sheet), so the same aliasing is repeated here as a
    // defensive fallback. Without this, a row like leaveType: "casual leave"
    // fails the validLeaveTypes check below and gets silently skipped —
    // which is exactly why an imported leave could fail to save and never
    // show up on the staff's attendance calendar.
    const LEAVE_TYPE_ALIASES = {
      paid: "paid",
      "paid leave": "paid",
      unpaid: "unpaid",
      "unpaid leave": "unpaid",
      sick: "sick",
      "sick leave": "sick",
      casual: "casual",
      "casual leave": "casual",
      swap: "swapleave",
      swapleave: "swapleave",
      "swap leave": "swapleave",
    };
    const normalizeLeaveType = (raw) => {
      if (raw == null || raw === "") return undefined;
      const key = String(raw).trim().toLowerCase();
      return LEAVE_TYPE_ALIASES[key] || key;
    };

    // Rows may identify the staff member by userId directly, or by
    // staffEmail (lets one Excel file cover multiple staff, each row
    // naming its own person) — resolve those up front in one query.
    const emailByIdxNeeded = leavesData.map((r) => r.staffEmail).filter(Boolean);
    const staffIdByEmail = await resolveStaffIdByEmail(emailByIdxNeeded);

    // Balance-tracked types get the exact same accrued/carry-forward check
    // here that applyLeave and approveLeaveRequest already enforce — an
    // import is just another way a Paid/Sick/Casual leave record gets
    // created, and it shouldn't be able to backfill more days than the
    // staff member's confirmation-date-based accrual actually allows.
    // Cached per userId (not re-fetched per row) since one Excel file
    // commonly has many rows for the same staff member.
    const balanceTrackedTypes = ["paid", "sick", "casual"];
    const staffCacheForBalance = new Map();
    const getCachedStaffForBalance = async (id) => {
      const key = String(id);
      if (staffCacheForBalance.has(key)) return staffCacheForBalance.get(key);
      const doc = await getStaffById(id);
      staffCacheForBalance.set(key, doc);
      return doc;
    };

    for (const [index, row] of leavesData.entries()) {
      try {
        const { leaveDate, reason, status, staffEmail } = row;
        const leaveType = normalizeLeaveType(row.leaveType);
        let { userId } = row;
        if (!userId && staffEmail) {
          userId = staffIdByEmail[String(staffEmail).toLowerCase()];
        }
        if (!userId) {
          results.failed++;
          results.errors.push(
            `Row ${index + 1}: Could not resolve staff (missing/unknown userId or staffEmail)`,
          );
          continue;
        }
        if (!leaveDate || !reason) {
          results.failed++;
          results.errors.push(
            `Row ${index + 1}: Missing leaveDate or reason`,
          );
          continue;
        }
        if (leaveType && !validLeaveTypes.includes(leaveType)) {
          results.failed++;
          results.errors.push(
            `Row ${index + 1}: Invalid leaveType "${leaveType}"`,
          );
          continue;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(leaveDate)) {
          results.failed++;
          results.errors.push(`Row ${index + 1}: Invalid leaveDate format`);
          continue;
        }
        // Same timezone-safe parse as applyLeave — see comment there.
        const { start: parsedDate } = getDayRange(leaveDate);
        const isSunday = parsedDate.getUTCDay() === 0;
        const holidayCheck = await isHolidayOrSunday(parsedDate);
        if (isSunday || holidayCheck.isHoliday) {
          const untracked = await isMonthUntracked(
            untrackedMonthCache,
            userId,
            parsedDate.getUTCFullYear(),
            parsedDate.getUTCMonth(),
          );
          // A month with zero real attendance for this staff member skips
          // the guard entirely (see isMonthUntracked) so the whole month,
          // Sundays/holidays included, can be backfilled as leave.
          if (!untracked) {
            if (isSunday) {
              results.failed++;
              results.errors.push(
                `Row ${index + 1}: Cannot import leave on Sunday`,
              );
              continue;
            }
            if (holidayCheck.isHoliday && holidayCheck.reason !== "Sunday") {
              results.failed++;
              results.errors.push(
                `Row ${index + 1}: Cannot import leave on holiday: ${holidayCheck.reason}`,
              );
              continue;
            }
          }
        }
        const { start, end } = getDayRange(parsedDate);
        // An Excel import is meant to be the authoritative record of what
        // actually happened on a date — so unlike a live staff apply
        // request, it shouldn't be permanently blocked by data that's
        // either not yet decided or simply wrong:
        //   - a "pending" record (a staff self-request nobody ever
        //     approved/rejected) gets superseded — the import is a human
        //     confirming what really happened, so it should win.
        //   - an "approved" record of a DIFFERENT leaveType (e.g. it was
        //     wrongly auto-marked Unpaid by absence reconciliation, or an
        //     earlier bad import, before the correct Paid/Sick/Casual data
        //     was available) is a correction target, not a genuine
        //     duplicate — it gets replaced too.
        // Only an approved record of the SAME leaveType is a true
        // duplicate (re-importing data that's already correct) and is
        // still left alone/reported as such below.
        const existingLeave = await Leave.findOne({
          userId,
          leaveDate: { $gte: start, $lte: end },
          status: { $in: ["pending", "approved"] },
        });
        if (existingLeave) {
          const isTrueDuplicate =
            existingLeave.status === "approved" &&
            existingLeave.leaveType === (leaveType || "unpaid");
          if (isTrueDuplicate) {
            results.failed++;
            results.errors.push(
              `Row ${index + 1}: Leave already exists for user ${userId} on ${formatDateForLog(parsedDate)}`,
            );
            continue;
          }
          // Superseding a real approved leave — clean up any Sunday/
          // holiday sandwich day it was bridging so it doesn't keep
          // pointing at a `sourceLeaveId` that no longer exists (and so
          // the reconciliation pass below re-evaluates that bridge fresh
          // against the new data instead of leaving a stale bracket).
          if (existingLeave.status === "approved") {
            try {
              await cleanupSandwichLeavesFor(existingLeave._id);
            } catch (cascadeErr) {
              console.error(
                "Sandwich cascade cleanup failed during import supersede:",
                cascadeErr,
              );
            }
          }
          await Leave.deleteOne({ _id: existingLeave._id });
        }

        // Only an "approved" row actually draws down a balance — a row
        // imported as "pending" hasn't been granted yet, so it shouldn't
        // be blocked here (the normal approve flow will re-check it).
        const importDayValue = 1; // import doesn't carry half-day info per row
        // Normally a row creates exactly one Leave record of `leaveType`.
        // But Sick and Casual are both the same 0.5/month "short leave"
        // pool from the staff member's point of view — if the requested
        // type alone doesn't have a full day left, but the *other* one of
        // Sick/Casual has the shortfall (e.g. 0.5 Sick + 0.5 Casual left),
        // the day is still covered by splitting it into two half-day
        // records instead of being left blank. Paid is not part of this
        // pool — it's only ever covered by itself.
        let recordsToCreate = [
          { leaveType: leaveType || "unpaid", dayValue: importDayValue },
        ];
        // Before the confirmation date there is no Paid / Sick / Casual
        // entitlement — such a row is saved as Unpaid.
        let preConfirmation = false;
        if (balanceTrackedTypes.includes(leaveType)) {
          const staffForGate = await getCachedStaffForBalance(userId);
          if (staffForGate && isBeforeConfirmation(staffForGate, parsedDate)) {
            preConfirmation = true;
            recordsToCreate = [{ leaveType: "unpaid", dayValue: importDayValue }];
          }
        }
        if (
          !preConfirmation &&
          balanceTrackedTypes.includes(leaveType) &&
          (status || "approved") === "approved"
        ) {
          const staffForBalance = await getCachedStaffForBalance(userId);
          const confirmationDate = staffForBalance?.confirmationDate ?? null;
          const relievingDate =
            staffForBalance?.status === "Relieved"
              ? staffForBalance?.relievingDate
              : null;
          // Use the LAST DAY of the row's own leave-date year as `asOf`
          // (not the row's exact date, and not "today"). computeLeaveBalances
          // still buckets accrual/"taken" by that year — so a backfilled 2025
          // row is still judged against 2025's numbers, not 2026's — but
          // within that year the check is against the full annual
          // entitlement (e.g. 13.5 paid) rather than however much of it had
          // technically "posted" month-by-month by that exact calendar date.
          // An import is backfilling leave that already happened; it
          // shouldn't be rejected just because the row's date falls a few
          // days before that month's accrual anniversary while a later date
          // in the very same year would have passed. (Live apply/approve
          // requests, which use `getRemainingForType` directly with
          // asOf = today, are unaffected by this — they still pace by the
          // real accrual schedule since a staff member can't request leave
          // against days that haven't been earned yet.)
          const importBalanceAsOf = (d) =>
            new Date(Date.UTC(d.getUTCFullYear(), 11, 31, 12, 0, 0, 0));
          const balanceAsOf = importBalanceAsOf(parsedDate);
          // The line above only moves the check to 31 Dec — on its own it
          // still pro-rates accrual by the months since confirmation (a
          // staff member confirmed in September only got ~4 months, e.g.
          // 4.5 of 13.5 paid), which is why rows like 24–27 Nov were
          // rejected with "0 day(s) remaining". `fullYearEntitlement`
          // grants the whole year's policy allowance for the backfill, as
          // long as the row's date is on/after the confirmation date
          // (probation days keep the old behaviour).
          const effectiveConfirmation =
            getEffectiveConfirmationDate(staffForBalance);
          const balanceOptions = {
            fullYearEntitlement:
              !!effectiveConfirmation &&
              parsedDate >= getDayRange(effectiveConfirmation).start,
          };
          const available = await getRemainingForType(
            userId,
            confirmationDate,
            leaveType,
            balanceAsOf,
            relievingDate,
            balanceOptions,
          );

          if (available < importDayValue) {
            const siblingType =
              leaveType === "sick"
                ? "casual"
                : leaveType === "casual"
                  ? "sick"
                  : null; // Paid has no sibling pool to borrow from

            let combinedRecords = null;
            if (siblingType) {
              const siblingAvailable = await getRemainingForType(
                userId,
                confirmationDate,
                siblingType,
                balanceAsOf,
                relievingDate,
                balanceOptions,
              );
              // Sick and Casual share one pool, so adding both "remaining"
              // figures would count the pool twice — cap by the real pool.
              const poolRemaining = await getSickCasualPoolRemaining(
                userId,
                confirmationDate,
                balanceAsOf,
                relievingDate,
                balanceOptions,
              );
              const totalAvailable = round2(
                Math.min(available + siblingAvailable, poolRemaining),
              );
              if (totalAvailable >= importDayValue) {
                const fromRequested = Math.min(available, importDayValue);
                const fromSibling = round2(importDayValue - fromRequested);
                combinedRecords = [];
                if (fromRequested > 0) {
                  combinedRecords.push({
                    leaveType,
                    dayValue: fromRequested,
                  });
                }
                if (fromSibling > 0) {
                  combinedRecords.push({
                    leaveType: siblingType,
                    dayValue: fromSibling,
                  });
                }
              }
            }

            if (combinedRecords) {
              recordsToCreate = combinedRecords;
            } else {
              // Balance used up (e.g. advance paid leave from the
              // confirmation year is still being paid back): save the day
              // as UNPAID instead of leaving it blank. If part of a day is
              // still available (0.5), use it and make the rest unpaid.
              const usable = round2(
                Math.max(0, Math.min(Number(available) || 0, importDayValue)),
              );
              const unpaidPart = round2(importDayValue - usable);
              recordsToCreate = [];
              if (usable > 0) {
                recordsToCreate.push({ leaveType, dayValue: usable });
              }
              if (unpaidPart > 0) {
                recordsToCreate.push({ leaveType: "unpaid", dayValue: unpaidPart });
              }
              results.warnings.push(
                `Row ${index + 1}: Not enough ${leaveType} leave for ${formatDateForLog(parsedDate)} (${available} day(s) remaining) — saved ${unpaidPart} day as Unpaid`,
              );
            }
          }
        }

        const createdForRow = [];
        for (const rec of recordsToCreate) {
          const leave = new Leave({
            userId,
            leaveDate: parsedDate,
            reason,
            leaveType: rec.leaveType,
            dayValue: rec.dayValue,
            status: status || "approved",
          });
          await leave.save();
          createdForRow.push(leave);
        }

        // Same reasoning as applyLeave: an imported row can land as one
        // bracket around a Sunday/holiday block, with the other bracket
        // arriving in a later (or earlier — Excel rows aren't guaranteed
        // to be date-sorted) row of the same file. Rather than trying to
        // reconcile inline per-row here (which only works if rows happen
        // to be processed in date order), just remember the date span
        // touched for this user and reconcile it in one order-independent
        // pass after the whole file has been processed — see the loop
        // below.
        if (createdForRow.some((l) => l.status === "approved")) {
          const key = String(userId);
          const span = touchedRangeByUser.get(key);
          if (!span) {
            touchedRangeByUser.set(key, { min: parsedDate, max: parsedDate });
          } else {
            if (parsedDate < span.min) span.min = parsedDate;
            if (parsedDate > span.max) span.max = parsedDate;
          }
        }

        for (const l of createdForRow) importedDocs.push(l.toObject());
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`Row ${index + 1}: ${err.message}`);
      }
    }

    // One order-independent sandwich pass per staff member touched by this
    // import, covering the full min..max date span imported for them. This
    // is what lets a Sunday sitting right next to a public holiday (or any
    // other multi-day non-working run) get bridged correctly no matter
    // what order the Excel rows were in.
    for (const [rangeUserId, span] of touchedRangeByUser) {
      try {
        await reconcileSandwichLeaveForRange(rangeUserId, span.min, span.max);
      } catch (sandwichErr) {
        console.error(
          "Sandwich leave reconciliation failed (import range):",
          sandwichErr,
        );
      }
    }

    if (results.success > 0)
      await logActivity(req, {
        action: "IMPORT",
        actionLabel: `Imported ${results.success} Leave Record(s) from Excel`,
        tableName: "leaves",
        tableLabel: "Leave",
        description: `Excel import: ${results.success} leave records saved, ${results.failed} failed.`,
        newData: importedDocs,
        newSnapshots: importedDocs.map((d) => ({
          recordId: String(d._id),
          refNumber: `${d.userId}_${formatDateForLog(d.leaveDate)}`,
          data: d,
        })),
      });
    res.json({
      success: results.success > 0,
      message:
        results.success === leavesData.length
          ? `All ${results.success} leave records imported successfully`
          : results.success > 0
            ? `Partial import: ${results.success} saved, ${results.failed} failed`
            : `Import failed: all ${results.failed} records failed`,
      importedCount: results.success,
      failedCount: results.failed,
      errors: results.errors,
      // Rows saved as Unpaid because the paid/sick/casual balance ran out.
      warnings: results.warnings,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// POST /attendance/convert-to-leave
export const convertExtraHoursToLeave = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { userId, date, leaveDays = 1, useMonthlyOnly = false } = req.body;
    const leaveDaysNum = Number(leaveDays);
    if (!Number.isFinite(leaveDaysNum) || leaveDaysNum < 0.5) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Number of days must be at least 0.5",
      });
    }
    if (Math.round(leaveDaysNum * 2) !== leaveDaysNum * 2) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Number of days must be in steps of 0.5 (e.g. 0.5, 1, 1.5, 2)",
      });
    }
    if (!userId || !date) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: "User ID and date are required" });
    }
    const [year, month, day] = date.split("-").map(Number);
    const leaveDateUTC = new Date(Date.UTC(year, month - 1, day, 9, 0, 0, 0));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(year, month - 1, day);
    checkDate.setHours(0, 0, 0, 0);
    if (checkDate > today) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({
          success: false,
          message: "Cannot convert leave for future dates",
        });
    }
    const holidayCheck = await isHolidayOrSunday(leaveDateUTC);
    if (holidayCheck.isHoliday) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Cannot take leave on ${holidayCheck.reason}`,
      });
    }
    const existingAttendance = await findExistingAttendance(
      userId,
      date,
      session,
    );
    // BUGFIX: this used to block Swap Leave conversion on ANY existing
    // regular attendance record, including a genuine worked Half Day —
    // so "worked half + Swap Leave for the other half" could never be
    // created at all, and the calendar had nothing to render. A worked
    // Half Day topping up exactly its missing 0.5 with Swap Leave is the
    // same legitimate half-day-top-up pattern already supported for
    // Paid/Sick/Casual (see changeDayStatus) — allow it here too. Any
    // other existing attendance (a full day, or a half day being asked
    // for more than its missing 0.5) is still blocked.
    const isHalfTopUp =
      existingAttendance &&
      !existingAttendance.isLeaveDay &&
      existingAttendance.attendanceType === "half" &&
      leaveDaysNum === 0.5;
    if (existingAttendance && !existingAttendance.isLeaveDay && !isHalfTopUp) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Regular attendance already exists for this date",
      });
    }
    const { start, end } = getDayRange(date);
    if (
      await Leave.findOne({
        userId,
        leaveDate: { $gte: start, $lte: end },
        leaveType: "swapleave",
        status: "approved",
      }).session(session)
    ) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({
          success: false,
          message: "A swap leave already exists for this date",
        });
    }
    const minutesNeeded = leaveDays * 480;
    const totalSummary = await calculateExtraHoursSummary(userId);
    if (totalSummary.totalExtraMinutes < minutesNeeded) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Insufficient total extra hours. Available: ${totalSummary.totalExtraHours.toFixed(2)} hours (${totalSummary.leaveDaysAvailable} days), Required: ${minutesNeeded / 60} hours (${leaveDays} days)`,
      });
    }
    if (useMonthlyOnly) {
      const monthlySummary = await calculateMonthlyExtraHoursSummary(
        userId,
        year,
        month - 1,
      );
      if (monthlySummary.monthlyExtraMinutes < minutesNeeded) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Insufficient monthly extra hours. Available this month: ${monthlySummary.monthlyExtraHours.toFixed(2)} hours (${monthlySummary.monthlyLeaveDaysAvailable} days), Required: ${minutesNeeded / 60} hours (${leaveDays} days)`,
        });
      }
    }
    let minutesRemaining = minutesNeeded;
    const updatedRecords = [],
      sources = [];
    const recordsToDeduct = await Attendance.find({
      userId,
      extraHoursInMinutes: { $gt: 0 },
      isLeaveDay: { $ne: true },
    })
      .sort({ loginTime: 1 })
      .session(session);
    for (const rec of recordsToDeduct) {
      if (minutesRemaining <= 0) break;
      const original = rec.extraHoursInMinutes || 0;
      if (original <= 0) continue;
      const deduction = Math.min(original, minutesRemaining),
        newMinutes = original - deduction;
      const updateResult = await Attendance.updateOne(
        { _id: rec._id, extraHoursInMinutes: original },
        {
          $set: {
            extraHoursInMinutes: newMinutes,
            extraHours: formatMinutesToTimeString(newMinutes),
            updatedAt: new Date(),
          },
        },
        { session },
      );
      if (updateResult.modifiedCount === 0)
        throw new Error(
          `Concurrent modification on record ${rec._id}. Please try again.`,
        );
      updatedRecords.push({
        id: rec._id,
        date: rec.loginTime,
        original,
        deducted: deduction,
        remaining: newMinutes,
      });
      minutesRemaining -= deduction;
      sources.push({ attendanceId: rec._id, deductedMinutes: deduction });
    }
    if (minutesRemaining > 0) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(500)
        .json({
          success: false,
          message: "Failed to deduct all required minutes.",
        });
    }
    let leaveAttendance;
    if (isHalfTopUp) {
      // Keep the existing worked-half attendance record exactly as-is —
      // the Swap Leave below only covers the missing other half, so
      // there's nothing to replace on the attendance side (mirrors how
      // changeDayStatus leaves the worked half's Attendance record alone
      // when topping it up with Paid/Sick/Casual leave).
      leaveAttendance = existingAttendance;
    } else if (existingAttendance && existingAttendance.isLeaveDay) {
      existingAttendance.remarks = `Leave converted from ${minutesNeeded / 60} extra working hours (${leaveDays} day${leaveDays > 1 ? "s" : ""})`;
      await existingAttendance.save({ session });
      leaveAttendance = existingAttendance;
    } else {
      leaveAttendance = new Attendance({
        userId,
        loginTime: leaveDateUTC,
        logoutTime: leaveDateUTC,
        totalTime: "00:00:00",
        workingHoursPerDay: 8,
        extraHours: "00:00:00",
        extraHoursInMinutes: 0,
        isLeaveDay: true,
        attendanceType: "full",
        remarks: `Leave converted from ${minutesNeeded / 60} extra working hours (${leaveDays} day${leaveDays > 1 ? "s" : ""})`,
      });
      await leaveAttendance.save({ session });
    }
    const swapLeave = new Leave({
      userId,
      leaveDate: leaveDateUTC,
      reason: `Leave converted from ${leaveDays * 8} extra working hours`,
      leaveType: "swapleave",
      status: "approved",
      remarks: `Converted from extra hours on ${new Date().toISOString()}`,
      extraHoursSources: sources,
      // `leaveDays` can be fractional (e.g. 1.5) when an admin converts a
      // non-whole amount of banked extra hours — this is what lets that
      // show up as 1.5 in the Swap count on the calendar instead of being
      // rounded down to a flat 1 by the old countDocuments()-based total.
      dayValue: leaveDaysNum,
      // Marks this as covering the missing half of an already-worked Half
      // Day (see isHalfTopUp above) so buildMonthDays renders it as a
      // worked-half + Swap-Leave-half day instead of a plain full Swap day.
      isHalfDayTopUp: isHalfTopUp,
    });
    await swapLeave.save({ session });
    await session.commitTransaction();
    session.endSession();
    await logActivity(req, {
      action: "CREATE",
      actionLabel: `Converted ${leaveDays} Day(s) Extra Hours to Swap Leave for User ${userId} on ${date}`,
      tableName: "leaves",
      tableLabel: "Leave",
      recordId: swapLeave._id,
      referenceNumber: `${userId}_${date}`,
      newData: swapLeave.toObject(),
      newSnapshots: [
        {
          recordId: String(swapLeave._id),
          refNumber: `${userId}_${date}`,
          data: swapLeave.toObject(),
        },
      ],
      description: `${leaveDays} swap leave day(s) created for user ${userId} on ${date} using ${minutesNeeded} minutes of extra time.`,
      refField: "userId",
    });
    const updatedSummary = await calculateExtraHoursSummary(userId);
    res.json({
      success: true,
      message: `${leaveDays} leave day${leaveDays > 1 ? "s" : ""} successfully converted from extra hours!`,
      data: {
        leaveRecord: leaveAttendance,
        swapLeave,
        originalTotalExtraHours: totalSummary.totalExtraHours,
        updatedTotalExtraHours: updatedSummary.totalExtraHours,
        remainingLeaveDays: updatedSummary.leaveDaysAvailable,
        deductedMinutes: minutesNeeded - minutesRemaining,
        updatedRecords,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// GET /attendance/extra-hours/:userId
export const getExtraHoursSummary = async (req, res) => {
  try {
    const { userId } = req.params;
    const { year, month } = req.query;
    const now = new Date();
    const queryYear = year ? parseInt(year) : now.getFullYear();
    const queryMonth = month !== undefined ? parseInt(month) : now.getMonth();
    const totalSummary = await calculateExtraHoursSummary(userId);
    const monthlySummary = await calculateMonthlyExtraHoursSummary(
      userId,
      queryYear,
      queryMonth,
    );
    res.json({
      success: true,
      data: {
        ...totalSummary,
        monthlyExtraHours: monthlySummary.monthlyExtraHours,
        monthlyExtraMinutes: monthlySummary.monthlyExtraMinutes,
        monthlyLeaveDaysAvailable: monthlySummary.monthlyLeaveDaysAvailable,
        monthlyRemainingMinutes: monthlySummary.monthlyRemainingMinutes,
        monthlyWorkedMinutes: monthlySummary.monthlyWorkedMinutes,
        monthlyWorkedHours: monthlySummary.monthlyWorkedHours,
        monthlyRecordsWithExtraHours:
          monthlySummary.monthlyRecordsWithExtraHours,
        monthlyTotalRecords: monthlySummary.monthlyTotalRecords,
        isMonthly: month !== undefined,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// GET /extra-hours/:userId (simplified variant, no session-based helpers)
export const getExtraHoursSimple = async (req, res) => {
  try {
    const { userId } = req.params;
    const { year, month } = req.query;
    const now = new Date();
    const queryYear = year ? parseInt(year) : now.getFullYear();
    const queryMonth = month !== undefined ? parseInt(month) : now.getMonth();
    const allRecords = await Attendance.find({
      userId,
      isLeaveDay: { $ne: true },
    }).sort({ loginTime: 1 });
    const startOfMonth = new Date(queryYear, queryMonth, 1);
    const endOfMonth = new Date(queryYear, queryMonth + 1, 0, 23, 59, 59, 999);
    const monthlyRecords = allRecords.filter((r) => {
      const d = new Date(r.loginTime);
      return d >= startOfMonth && d <= endOfMonth;
    });
    const calcExtra = (rec) => {
      if (rec.extraHoursInMinutes > 0) return rec.extraHoursInMinutes / 60;
      if (rec.extraHours && rec.extraHours !== "00:00:00") {
        const [h, m] = rec.extraHours.split(":").map(Number);
        return h + m / 60;
      }
      if (rec.loginTime && rec.logoutTime) {
        const dur =
          (new Date(rec.logoutTime) - new Date(rec.loginTime)) / 60000;
        return (
          Math.max(0, dur - (rec.attendanceType === "half" ? 240 : 480)) / 60
        );
      }
      return 0;
    };
    let totalExtraHours = 0,
      monthlyExtraHours = 0;
    allRecords.forEach((r) => {
      totalExtraHours += calcExtra(r);
    });
    monthlyRecords.forEach((r) => {
      monthlyExtraHours += calcExtra(r);
    });
    const tem = totalExtraHours * 60,
      mem = monthlyExtraHours * 60;
    res.json({
      success: true,
      data: {
        totalExtraMinutes: Math.round(tem),
        monthlyExtraMinutes: Math.round(mem),
        totalExtraHours: parseFloat(totalExtraHours.toFixed(2)),
        monthlyExtraHours: parseFloat(monthlyExtraHours.toFixed(2)),
        totalLeaveDaysAvailable: Math.floor(tem / 480),
        monthlyLeaveDaysAvailable: Math.floor(mem / 480),
        totalRemainingHours: Math.floor((tem % 480) / 60),
        totalRemainingMinutes: Math.round(tem % 60),
        monthlyRemainingHours: Math.floor((mem % 480) / 60),
        monthlyRemainingMinutes: Math.round(mem % 60),
        allRecordsCount: allRecords.length,
        monthlyRecordsCount: monthlyRecords.length,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to get extra hours: " + error.message,
      });
  }
};

// GET /user/:userId
export const getUserAttendance = async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;
    const records = await getUserAttendanceRange(userId, startDate, endDate);
    res.json({ success: true, data: records, count: records.length });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to get attendance records: " + error.message,
      });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// MR (staff) summary list + per-MR calendar — powers the "MR List" and
// "Calendar View" screens on the Attendance & Leaves page.
// ═══════════════════════════════════════════════════════════════════════════

// Attendance.userId points at the login User account while Leave.userId
// points directly at Staff — the only reliable bridge between the two is
// email (same approach getAllAttendance() already uses above).
// (resolveUserIdByEmail now lives in services/leave.js — imported above —
// so the Excel importers below can share it too.)

// Builds the staff summary rows (cached by getStaffSummary).
const buildStaffSummaryData = async () => {
    // A staff member marked "Relieved" still needs to show up here — this
    // list is how an admin views/manages someone's leave history, applies
    // leave on their behalf, or (via the settlement statement) looks up
    // their final balance after they've left. `enabled` gets auto-set to
    // false the moment status becomes "Relieved" (see updateStaff), so
    // filtering on `enabled` alone silently dropped every relieved staff
    // member from this list the day they left — even though
    // `canMarkAttendance` below was already written expecting relieved
    // staff to still be present in this response. Anyone disabled for a
    // reason OTHER than relieving (a plain deactivated account) is still
    // excluded, same as before.
    const staffList = await Staff.find({
      $or: [{ enabled: { $ne: false } }, { status: "Relieved" }],
    })
      .sort({ staffName: 1 })
      .lean();
    const userIdByEmail = await resolveUserIdByEmail(
      staffList.map((s) => s.email),
    );

    const now = new Date();
    const currentYear = now.getFullYear();
    const startOfYear = new Date(Date.UTC(currentYear, 0, 1, 0, 0, 0, 0));
    const endOfYear = new Date(Date.UTC(currentYear, 11, 31, 23, 59, 59, 999));

    // One aggregation for every staff member's approved paid (this year),
    // unpaid and swap leave counts — replaces 3 countDocuments() calls PER
    // staff member (3×N round trips to the database on every page load).
    const countRows = await Leave.aggregate([
      {
        $match: {
          userId: { $in: staffList.map((s) => s._id) },
          status: "approved",
          leaveType: { $in: ["paid", "unpaid", "swapleave"] },
        },
      },
      {
        $group: {
          _id: "$userId",
          paidThisYear: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$leaveType", "paid"] },
                    { $gte: ["$leaveDate", startOfYear] },
                    { $lte: ["$leaveDate", endOfYear] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          unpaid: {
            $sum: { $cond: [{ $eq: ["$leaveType", "unpaid"] }, 1, 0] },
          },
          swap: {
            $sum: { $cond: [{ $eq: ["$leaveType", "swapleave"] }, 1, 0] },
          },
        },
      },
    ]);
    const countsByStaff = new Map(countRows.map((r) => [String(r._id), r]));

    const data = await Promise.all(
      staffList.map(async (staff) => {
        const attendanceUserId = staff.email
          ? userIdByEmail[staff.email.toLowerCase()] || null
          : null;

        const counts = countsByStaff.get(String(staff._id));
        const leaveTaken = counts?.paidThisYear || 0;
        const unpaidTaken = counts?.unpaid || 0;
        const swapTaken = counts?.swap || 0;
        // These two are independent — run them in parallel.
        const [remainingPaid, extra] = await Promise.all([
          getRemainingForType(
            staff._id,
            staff.confirmationDate ?? null,
            "paid",
            new Date(),
            staff.status === "Relieved" ? staff.relievingDate : null,
          ),
          attendanceUserId
            ? calculateExtraHoursSummary(attendanceUserId)
            : { leaveDaysAvailable: 0, remainingMinutes: 0 },
        ]);

        return {
          staffId: staff._id,
          attendanceUserId,
          staffName: staff.staffName,
          email: staff.email || "",
          contactNo: staff.contactNo || "",
          status: staff.status || "Probation",
          // Joining date — needed by the calendar view so it can floor its
          // year/month picker at the month the staff member actually
          // joined, the same way relievingDate caps the top end below.
          date: staff.date || null,
          relievingDate: staff.relievingDate || null,
          // A relieved staff member has no more working days to mark —
          // surfaced here so the "Record Attendance" dropdown can disable
          // them instead of silently letting an admin mark attendance for
          // someone who has already left.
          canMarkAttendance: staff.status !== "Relieved",
          paidLeaveAllotted: remainingPaid + leaveTaken,
          leaveTaken,
          remainingPaid,
          extraHoursDays: extra.leaveDaysAvailable,
          extraHoursRemainingMinutes: extra.remainingMinutes,
          unpaidTaken,
          swapTaken,
        };
      }),
    );

    return data;
};

// Rebuild it in the background after data changes and at server start.
registerCacheWarmer(() =>
  getOrCompute(
    `staff-summary:${new Date().toISOString().slice(0, 10)}`,
    buildStaffSummaryData,
  ),
);

export const getStaffSummary = async (req, res) => {
  try {
    // PERFORMANCE: leave balance + extra hours for every staff member is
    // expensive and identical for every admin, so it is cached and only
    // rebuilt after a write (see services/responseCache.js). The date is
    // part of the key so balances roll over correctly at midnight.
    const dayKey = new Date().toISOString().slice(0, 10);
    const data = await getOrCompute(`staff-summary:${dayKey}`, buildStaffSummaryData);

    res.json({ success: true, data });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// "paid", "sick" and "casual" are all balance-tracked leave types and each
// gets its own distinct calendar color (see STATUS_STYLES on the frontend)
// instead of collapsing into a generic "unpaid" block. "swapleave" records
// render as "swap"; any type not listed here (currently just "unpaid")
// keeps its own name as the status. Shared by both the full-day-leave path
// and the Half-Day-topped-up-with-leave path below so a topped-up half day
// always gets the exact same color a full day of that leave type would.
const TOPUP_STATUS_BY_LEAVE_TYPE = {
  paid: "paid",
  sick: "sick",
  casual: "casual",
  swapleave: "swap",
};

const buildMonthDays = (
  year,
  month,
  attendanceRecords,
  leaveRecords,
  holidays,
  today,
  relievingCutoff,
  joinCutoff,
) => {
  const startOfMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const endOfMonth = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  const daysInMonth = endOfMonth.getUTCDate();

  const days = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(year, month, d)).getUTCDay();
    days[d] = {
      date: new Date(Date.UTC(year, month, d)).toISOString().slice(0, 10),
      status: dow === 0 ? "holiday" : null,
      holidayName: dow === 0 ? "Sunday" : undefined,
    };
  }

  holidays.forEach((h) => {
    const s = new Date(h.startDate);
    const e = new Date(h.endDate);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(Date.UTC(year, month, d));
      if (dateObj >= s && dateObj <= e) {
        days[d].status = "holiday";
        days[d].holidayName = h.name;
      }
    }
  });

  attendanceRecords.forEach((rec) => {
    if (rec.isLeaveDay) return; // the matching Leave record (below) drives leave-day coloring
    // BUGFIX: use the record's own IST day (its `date` field), not the UTC
    // day of loginTime. Half Day markers are saved with a login of 00:00
    // IST = 18:30 UTC the previous day, so marking 6 Aug as Half Day used
    // to paint 5 Aug instead.
    const [ky, km, kd] = attendanceDayKey(rec).split("-").map(Number);
    if (ky !== year || km - 1 !== month) return;
    const d = kd;
    if (!days[d]) return;
    // A holiday (declared before or after the fact) always wins over an
    // attendance record on that same date — otherwise a Sunday/Saturday
    // rule or a holiday added retroactively gets silently overwritten back
    // to Present/Half Day, which is the bug that stopped holidays from
    // ever showing on this calendar.
    if (days[d].status === "holiday") return;
    // BUGFIX: an "Absent" marker (admin Edit Day / Excel import) is an
    // attendance row with status "absent" — it is NOT a worked day. It used
    // to fall through to "present", so the calendar showed the whole month
    // green ("30 present") while payroll, correctly, did not pay that day
    // (₹29,000 instead of ₹30,000). Show it red like an unpaid day instead,
    // and don't let it override a leave record on the same date.
    if (rec.status === "absent" || rec.attendanceType === "absent") {
      if (days[d]._hasRealAttendance) return; // a real sign-in on the same day wins
      days[d].status = "unpaid";
      days[d].isAbsentMark = true;
      days[d].recordId = rec._id;
      return;
    }
    days[d].status = rec.attendanceType === "half" ? "half" : "present";
    days[d].recordId = rec._id;
    days[d].loginTime = rec.loginTime; // ✅ added
    days[d].logoutTime = rec.logoutTime || null; // ✅ added
    // Marks this day as having REAL attendance (not just an isLeaveDay
    // placeholder) so the Leave loop below can defer to it — see there for
    // why. Stripped from the response afterward.
    days[d]._hasRealAttendance = true;
  });

  leaveRecords.forEach((rec) => {
    const recDate = new Date(rec.leaveDate);
    if (recDate.getUTCFullYear() !== year || recDate.getUTCMonth() !== month)
      return;
    const d = recDate.getUTCDate();
    if (!days[d]) return;
    // Defensive net: an actual attendance record on this date means the
    // staff member genuinely worked that day, so it must show (and count)
    // as Present/Half Day, never as leave — no matter what an approved
    // Leave record says. Normally this situation can't arise at all
    // anymore (see cancelConflictingLeaveOnAttendance, which cancels the
    // conflicting Leave the moment real attendance is recorded), but this
    // keeps the calendar correct for any data that predates that fix
    // without needing a manual backfill.
    if (days[d]._hasRealAttendance) {
      // ONE legitimate exception: a Half Day that an admin topped up with
      // leave for the other half (see changeDayStatus). That leave record
      // only ever covers the missing 0.5, so it's a genuine second half —
      // not stray data. The day is now a completed FULL day (worked half +
      // compensated half), so it takes on the covering leave type's
      // color/status just like any other leave day — it must NOT keep
      // showing as the orange "Half Day" block, which used to make it look
      // like nothing had changed even after an admin filled in the other
      // half.
      //
      // BUGFIX: this used to only recognise Paid/Sick/Casual as a valid
      // top-up type, so a Half Day topped up with Swap Leave or Unpaid
      // Leave failed the `isHalfTopUp` check and hit `return` here — the
      // leave record was silently dropped for rendering purposes and the
      // day stayed plain orange "Half Day" as if the other half had never
      // been marked at all. Swap and Unpaid are just as valid a covering
      // half as Paid/Sick/Casual, so they need to be recognised too.
      const isHalfTopUp =
        days[d].status === "half" &&
        ["paid", "sick", "casual", "unpaid", "swapleave"].includes(rec.leaveType) &&
        (rec.dayValue ?? 1) === 0.5;
      if (!isHalfTopUp) return;
      // Same leaveType -> status mapping used below for full leave days
      // ("swapleave" records render as "swap"; everything else keeps its
      // own name), so a topped-up half day gets the exact same color as a
      // full day of that same leave type would.
      days[d].status = TOPUP_STATUS_BY_LEAVE_TYPE[rec.leaveType] || rec.leaveType;
      days[d].leaveType = rec.leaveType;
      days[d].leaveId = rec._id;
      days[d].topUpLeaveType = rec.leaveType;
      days[d].topUpLeaveId = rec._id;
      days[d].isHalfDayTopUp = true;
      // loginTime/logoutTime from the worked half stay on `days[d]` (set by
      // the attendance loop above) so the tooltip can still show when the
      // staff member actually clocked in/out for that half.
      return;
    }
    // An approved Leave record wins over the default holiday/Sunday shading
    // ONLY when it's a legitimate sandwich-bridge record (isSandwich: true)
    // — the mechanism that intentionally brackets a Sunday/holiday between
    // two approved multi-day leaves of the same type (see
    // reconcileSandwichLeaveForRange in services/leaveAutomation.js). Any
    // other Leave record dated on a day that's already "holiday" here is
    // stray data (e.g. a pre-fix auto-marked absence, or an Excel import
    // that wrote a row for every calendar day without skipping non-working
    // ones) — it must NOT flip a real day off into red "Unpaid Leave" (or
    // whichever type it was saved as). getStaffCalendar self-heals this
    // stray data away with cleanupInvalidNonWorkingDayLeaves on every view,
    // but this guard keeps rendering correct even before that has run.
    // A staff-only holiday set by an admin (Attendance -> Edit Day).
    if (rec.leaveType === "holiday") {
      days[d].status = "holiday";
      days[d].holidayName = "Holiday (set by admin)";
      days[d].leaveType = "holiday";
      days[d].leaveId = rec._id;
      days[d].isAdminHoliday = true;
      return;
    }
    // An admin deliberately changed this Sunday/holiday into leave.
    if (days[d].status === "holiday" && !rec.isSandwich && !rec.isAdminOverride) return;
    days[d].status = TOPUP_STATUS_BY_LEAVE_TYPE[rec.leaveType] || "unpaid";
    days[d].leaveType = rec.leaveType;
    days[d].leaveId = rec._id;
    days[d].isHalfDay = (rec.dayValue ?? 1) < 1;
    days[d].holidayName = undefined; // stale "Sunday"/holiday label from above, now overridden by leave
  });

  // NOTE: Saturdays are only marked "holiday" via the admin-configured
  // Saturday Holiday Rule (merged into `holidays` and applied above) or a
  // manually-added Holiday record. A Saturday with no attendance record
  // that ISN'T covered by an active rule is left unmarked here — it used
  // to be blanket-forced to "holiday" for every unworked Saturday from
  // March 2026 onward, which overrode the admin's per-month occurrence
  // choices (e.g. unchecking 3rd & 4th Saturday for a month had no effect
  // because this fallback re-applied "holiday" anyway).

  // Days after "today" (or an entirely future month) render blank, same as
  // the reference UI — except Holiday, which is known in advance (this
  // includes recurring 3rd & 4th Saturday rules, and Sunday is now folded
  // into "holiday" too) and stays visible in yellow even for future dates.
  // Attendance/leave-derived statuses, which can't be known ahead of time,
  // still get cleared.
  const isCurrentMonth =
    year === today.getFullYear() && month === today.getMonth();
  if (isCurrentMonth) {
    for (let d = today.getDate() + 1; d <= daysInMonth; d++) {
      if (days[d].status !== "holiday") {
        days[d].status = null;
      }
    }
  } else if (new Date(Date.UTC(year, month, 1)) > today) {
    Object.values(days).forEach((day) => {
      if (day.status !== "holiday") {
        day.status = null;
      }
    });
  }

  // A staff member's calendar starts on their joining date, not before —
  // clear everything before it (including holiday/Sunday shading), the
  // same treatment as the relieving cutoff below. A whole month entirely
  // before the joining month is cleared outright, so previous months
  // don't show a staff member as "absent" on days before they existed
  // in the organization.
  if (joinCutoff) {
    const joinYear = joinCutoff.getUTCFullYear();
    const joinMonth = joinCutoff.getUTCMonth();
    const joinDay = joinCutoff.getUTCDate();
    const monthIsBeforeJoining =
      year < joinYear || (year === joinYear && month < joinMonth);
    const monthIsJoiningMonth = year === joinYear && month === joinMonth;

    if (monthIsBeforeJoining) {
      Object.values(days).forEach((day) => {
        day.status = null;
        day.holidayName = undefined;
      });
    } else if (monthIsJoiningMonth) {
      for (let d = 1; d < joinDay; d++) {
        days[d].status = null;
        days[d].holidayName = undefined;
      }
    }
  }

  // A relieved staff member has no calendar past their last working day —
  // clear everything after it, including holiday shading (unlike the
  // "today" cutoff above, which still lets future holidays show through).
  // A whole month entirely after the relieving month is cleared outright.
  if (relievingCutoff) {
    const relYear = relievingCutoff.getUTCFullYear();
    const relMonth = relievingCutoff.getUTCMonth();
    const relDay = relievingCutoff.getUTCDate();
    const monthIsAfterRelieving =
      year > relYear || (year === relYear && month > relMonth);
    const monthIsRelievingMonth = year === relYear && month === relMonth;

    if (monthIsAfterRelieving) {
      Object.values(days).forEach((day) => {
        day.status = null;
        day.holidayName = undefined;
      });
    } else if (monthIsRelievingMonth) {
      for (let d = relDay + 1; d <= daysInMonth; d++) {
        days[d].status = null;
        days[d].holidayName = undefined;
      }
    }
  }

  return {
    days: Object.fromEntries(
      Object.entries(days).map(([d, info]) => {
        const { _hasRealAttendance, ...clean } = info;
        return [d, clean];
      }),
    ),
    isCurrentMonth,
  };
};

// Thrown by buildStaffCalendarPayload for the two "can't proceed" cases
// (bad id / no such staff) so both the admin and self-service wrappers
// below can turn it into the right HTTP status without duplicating logic.
class CalendarLookupError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Shared by getStaffCalendar (admin, any staffId) and getMyCalendar (staff
// self-service, always their own staffId) — everything below this point
// only ever reads/writes data scoped to the single `staffId` passed in, so
// reusing it for the self-service route can't leak another staff member's
// attendance the way calling the admin route directly with someone else's
// id would.
const buildStaffCalendarPayload = async (staffId, query) => {
  if (!mongoose.Types.ObjectId.isValid(staffId)) {
    throw new CalendarLookupError(400, "Invalid staff ID");
  }

  const staff = await Staff.findById(staffId).lean();
  if (!staff) throw new CalendarLookupError(404, "Staff not found");

  {
    const today = new Date();
    const year = query.year
      ? parseInt(query.year, 10)
      : today.getFullYear();
    const isAnnual = query.mode === "annual";

    const attendanceUser = staff.email
      ? await User.findOne({ email: staff.email.toLowerCase() })
          .select("_id")
          .lean()
      : null;
    const attendanceUserId = attendanceUser?._id || null;

    // Only cuts off the calendar when the staff member has actually left
    // (status "Relieved" with a relievingDate set) — everyone else's
    // calendar renders as normal, unaffected.
    const relievingCutoff =
      staff.status === "Relieved" && staff.relievingDate
        ? new Date(staff.relievingDate)
        : null;

    // Everyone has a joining date, so this cutoff always applies — it
    // stops the calendar from showing days before the staff member
    // actually joined the organization.
    const joinCutoff = staff.date ? new Date(staff.date) : null;

    const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    // PERFORMANCE: the self-heal passes below walk the WHOLE year and are
    // idempotent. They used to run on every single calendar request (every
    // month arrow click), which is what made the calendar slow to render.
    // They now run once per staff+year and are skipped until some write
    // changes HRM data (see services/calendarHealCache.js).
    await runCalendarSelfHealOnce(`${staffId}:${year}`, async () => {
      let healOk = true;
      // Warm the holiday/Saturday-rule cache for the WHOLE span the self-heal
      // steps below could possibly walk day-by-day (reconcileSandwichLeaveForRange
      // pads its input by 14+31 days on each side, then can widen its scan up
      // to 30 more days looking for a block's edge — 100 days of margin covers
      // that with room to spare). This turns what used to be 400+ sequential
      // Holiday/SaturdayHolidayRule queries (one per unique calendar day,
      // awaited one at a time — the actual cause of the slow calendar load)
      // into a handful of upfront range queries; every isHolidayOrSunday call
      // the self-heal loops make below then hits the in-memory cache instead
      // of the database. Best-effort: if it fails, the self-heal steps just
      // fall back to their normal (slower but correct) per-day DB lookups.
      try {
        await warmHolidayWindow(
          new Date(yearStart.getTime() - 100 * 86400000),
          new Date(yearEnd.getTime() + 100 * 86400000),
        );
      } catch (warmErr) {
        console.error("Holiday window preload failed (calendar view):", warmErr);
      }

      // Self-heal, older-data side (runs FIRST): re-validate any sandwich day
      // already saved and remove it if it's stale — either the run of leave
      // before it no longer reaches 2 days (an earlier version of the
      // reconciler could bridge off just one day — see the fix in
      // services/leaveAutomation.js), or the leave type on that run has since
      // changed (e.g. corrected/re-imported from Unpaid to Paid) so the old
      // bridge is now showing the wrong color. This only deletes; the
      // reconciler right below immediately fills the resulting gap back in
      // with the CURRENT bracket type, which is why this must run before it.
      try {
        await cleanupInvalidSandwichLeaves(staffId, yearStart, yearEnd);
      } catch (sandwichCleanupErr) {
        healOk = false;
        console.error(
          "Invalid sandwich leave cleanup failed (calendar view):",
          sandwichCleanupErr,
        );
      }

      // Self-heal: bridge any Sunday/holiday day in this staff member's leave
      // history that's genuinely bracketed by approved leave of the same type
      // on both sides but never got turned into its own Leave record —
      // imports/applies that ran before this fix, rows that happened to save
      // in an order where neither bracket existed yet, or a gap the cleanup
      // step just above freshly opened up by removing a stale/wrong-type
      // bridge. Runs every time this calendar is opened, so a gap like this
      // fixes itself the moment an admin looks at the calendar — no manual
      // "repair" step needed, and the Paid/Sick/Casual/Unpaid counts below
      // immediately reflect it too, since it writes real Leave documents
      // rather than just changing what this one response displays.
      // Idempotent: a no-op once nothing is left to bridge.
      try {
        await reconcileSandwichLeaveForRange(staffId, yearStart, yearEnd);
      } catch (sandwichErr) {
        healOk = false;
        console.error(
          "Sandwich leave self-heal failed (calendar view):",
          sandwichErr,
        );
      }

      // Self-heal, root-cause side: remove any approved Leave record dated on
      // a Sunday/holiday that ISN'T a legitimate sandwich-bridge record (see
      // cleanupInvalidNonWorkingDayLeaves) — stray data that would otherwise
      // render that day as red "Unpaid Leave" (or whichever type) instead of
      // yellow "Holiday", and inflate the counts below. Runs after the
      // sandwich self-heal above so a genuine bridge created just now is
      // never mistaken for stray data. Idempotent, same as the others here.
      try {
        await cleanupInvalidNonWorkingDayLeaves(staffId, yearStart, yearEnd);
      } catch (cleanupErr) {
        healOk = false;
        console.error(
          "Invalid non-working-day leave cleanup failed (calendar view):",
          cleanupErr,
        );
      }

      // Self-heal, other direction: cancel any approved Leave that's sitting
      // on a date where this staff member actually has real attendance (see
      // cancelConflictingLeaveOnAttendance — new attendance already triggers
      // this going forward, but this catches any pre-existing data that was
      // created before that fix, e.g. a leave range applied in advance that
      // predates a day the staff member then came in and worked). Runs every
      // time this calendar is opened, same as the sandwich self-heal above —
      // idempotent, and a no-op once nothing is left to fix.
      let yearAttendanceForHeal = [];
      if (attendanceUserId) {
        try {
          yearAttendanceForHeal = await Attendance.find({
            userId: attendanceUserId,
            loginTime: {
              $gte: new Date(yearStart.getTime() - 86400000),
              $lte: yearEnd,
            },
            isLeaveDay: { $ne: true },
            // An "Absent" marker is not worked attendance — it must never
            // cancel a leave on the same date.
            status: { $ne: "absent" },
            attendanceType: { $ne: "absent" },
          })
            .select("date loginTime attendanceType")
            .lean();

          // Previously this awaited cancelConflictingLeaveOnAttendance (its
          // own Leave.findOne) once PER attendance record, sequentially — up
          // to 300+ DB round trips for a staff member with a near-full year
          // of attendance, every single time this calendar is opened. Fetch
          // this staff member's approved leave for the year ONCE instead, and
          // only call the per-date cancel helper for dates where a leave
          // record actually overlaps worked attendance — normally none,
          // since this only exists to catch stray old data.
          //
          // BUGFIX: this used to key purely off "is there attendance on this
          // date at all", which also matched a genuine Half Day topped up
          // with leave (see changeDayStatus) — a worked half PLUS an approved
          // 0.5-day Leave for the other half is not stray data, it's exactly
          // what the top-up feature is supposed to produce. Every time the
          // calendar was reopened this self-heal would delete that Leave
          // record again, silently undoing the top-up: the day reverted to a
          // plain, single-color Half Day and the leave was never actually
          // deducted. Now we track each worked date's attendanceType and only
          // flag a date as conflicting when it's a FULL day of attendance
          // ("present"), or when the leave sitting on a Half Day isn't a
          // legitimate top-up (missing the isHalfDayTopUp flag AND not a
          // half-day-sized dayValue) — e.g. stray full-day leave left over
          // from before the day was ever worked.
          const attendanceTypeByDate = new Map();
          yearAttendanceForHeal.forEach((rec) => {
            const dateStr = attendanceDayKey(rec); // IST day — see buildMonthDays
            // A date could technically have more than one attendance record;
            // "half" only wins if every record on it is half, so any full
            // ("present") record on the date marks it as a full worked day.
            const existing = attendanceTypeByDate.get(dateStr);
            if (existing !== "present") {
              attendanceTypeByDate.set(dateStr, rec.attendanceType === "half" ? "half" : "present");
            }
          });

          const approvedLeavesForYear = await Leave.find({
            userId: staffId,
            leaveDate: { $gte: yearStart, $lte: yearEnd },
            status: "approved",
          })
            .select("leaveDate dayValue isHalfDayTopUp")
            .lean();

          const conflictingDateStrings = approvedLeavesForYear
            .filter((lv) => {
              const d = new Date(lv.leaveDate);
              const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
              const attendanceType = attendanceTypeByDate.get(dateStr);
              if (!attendanceType) return false; // no worked attendance at all — never a conflict here
              if (attendanceType === "present") return true; // a full worked day never legitimately coexists with leave
              // attendanceType === "half": only a genuine top-up is legitimate.
              const isLegitimateTopUp =
                lv.isHalfDayTopUp === true || (lv.dayValue ?? 1) <= 0.5;
              return !isLegitimateTopUp;
            })
            .map((lv) => {
              const d = new Date(lv.leaveDate);
              return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
            });

          await Promise.all(
            conflictingDateStrings.map((dateStr) =>
              cancelConflictingLeaveOnAttendance(staffId, dateStr),
            ),
          );
        } catch (attendanceHealErr) {
          healOk = false;
          console.error(
            "Attendance/leave conflict self-heal failed (calendar view):",
            attendanceHealErr,
          );
        }
      }
      return healOk;
    });

    // Sums `dayValue` for approved leave of `leaveType` in the year range,
    // instead of just counting documents. A plain countDocuments() treats
    // every Leave record as a full day regardless of whether it's actually
    // a half-day leave (dayValue: 0.5) or a multi-day swap conversion
    // (dayValue: 1.5, 2, ...) — that mismatch is exactly what made the
    // Paid/Sick/Casual/Unpaid totals shown here run higher than a manual
    // day-by-day count. `$ifNull` covers records saved before this field
    // existed, which default to a full day (1).
    //
    // PERFORMANCE: was five separate aggregations (one per leave type); now
    // a single aggregation grouped by leaveType, read back per type below.
    const leaveTotalsByTypePromise = Leave.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(staffId),
          leaveType: { $in: ["unpaid", "swapleave", "paid", "sick", "casual"] },
          status: "approved",
          leaveDate: { $gte: yearStart, $lte: yearEnd },
        },
      },
      {
        $group: {
          _id: "$leaveType",
          total: { $sum: { $ifNull: ["$dayValue", 1] } },
        },
      },
    ]).then((rows) => new Map(rows.map((r) => [r._id, r.total])));
    const sumLeaveDays = async (leaveType) =>
      (await leaveTotalsByTypePromise).get(leaveType) || 0;

    // PERFORMANCE: the leave balance, the month-wise PL value and the
    // day-by-day records for the grid don't depend on each other or on the
    // counts below, but used to be awaited one after another. Start them
    // all now so they run in parallel with the counts.
    const leaveBalancePromise = (async () => {
      try {
        // Balance EARNED SO FAR: only the calendar months from the
        // confirmation month up to today are credited (1.5 Paid, 0.5 Sick,
        // 0.5 Casual per month by default policy), not the whole year's
        // entitlement. e.g. confirmed 01 Jun 2026, viewed on 29 Sep 2026
        // -> Jun, Jul, Aug, Sep = 4 months -> Paid 6, Sick 2, Casual 2.
        // Past years are shown as of 31 Dec of that year.
        // Noon UTC on 31 Dec is still 31 Dec in IST.
        const yearEnd = new Date(Date.UTC(year, 11, 31, 12, 0, 0, 0));
        const today = new Date();
        const yearStart = new Date(Date.UTC(year, 0, 1, 12, 0, 0, 0));
        // Past year -> 31 Dec; current year -> today; future year -> 1 Jan
        // of that year (nothing earned beyond its first month yet).
        const balanceAsOf =
          today > yearEnd ? yearEnd : today < yearStart ? yearStart : today;
        const b = await computeLeaveBalances(
          staffId,
          staff.confirmationDate ?? null,
          null,
          balanceAsOf,
          staff.status === "Relieved" ? staff.relievingDate : null,
          // Same rule as the Leave page: earned month by month up to today,
          // but leave already approved for later this year counts as taken.
          { takenThroughYearEnd: true },
        );
        const pick = (x) => ({
          perMonth: x.perMonth,
          earned: x.allotted,
          carriedForward: x.carriedForward,
          taken: x.taken,
          remaining: x.remaining,
        });
        return {
          asOf: balanceAsOf,
          confirmationDate: b.accrualStartDate,
          monthsSinceConfirmation: b.monthsSinceConfirmation,
          paid: { ...pick(b.paid), ownRemaining: b.paid.ownRemaining, borrowable: b.paid.borrowable },
          sick: pick(b.sick),
          casual: pick(b.casual),
          // Shared Sick + Casual pool (3.5 + 3.5 = 7 with the default policy).
          sickCasualPool: b.sickCasualPool,
        };
      } catch (balanceErr) {
        console.error("Leave balance lookup failed (calendar view):", balanceErr);
        return null;
      }
    })();

    const paidLeaveValuePromise = buildPaidLeaveValueByMonth(staff, year).catch(
      (plErr) => {
        console.error("Paid leave value lookup failed (calendar view):", plErr);
        return {};
      },
    );

    // Records for the grid itself: the whole year (Annual) or one month.
    const month =
      query.month !== undefined
        ? parseInt(query.month, 10)
        : today.getMonth();
    const rangeStart = isAnnual
      ? yearStart
      : new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const rangeEnd = isAnnual
      ? yearEnd
      : new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
    const viewRecordsPromise = Promise.all([
      attendanceUserId
        ? Attendance.find({
            userId: attendanceUserId,
            // Padded by a day: an older Half Day marker for the 1st is
            // stored at 00:00 IST = 18:30 UTC on the last day of the
            // previous month. buildMonthDays keeps only this range's days.
            loginTime: {
              $gte: new Date(rangeStart.getTime() - 86400000),
              $lte: new Date(rangeEnd.getTime() + 86400000),
            },
          }).lean()
        : [],
      Leave.find({
        userId: staffId,
        leaveDate: { $gte: rangeStart, $lte: rangeEnd },
        status: "approved",
      }).lean(),
      Holiday.find({
        enabled: true,
        startDate: { $lte: rangeEnd },
        endDate: { $gte: rangeStart },
      }).lean(),
      getSaturdayHolidaysAsEntries(year),
    ]);
    // Awaited further down; this only stops Node treating an early failure
    // as an "unhandled rejection" while the counts below are still running.
    viewRecordsPromise.catch(() => {});

    const [
      unpaidCount,
      swapCount,
      paidCount,
      sickCount,
      casualCount,
      presentCount,
      rawHalfCount,
      halfTopUpCount,
    ] =
      await Promise.all([
        sumLeaveDays("unpaid"),
        sumLeaveDays("swapleave"),
        sumLeaveDays("paid"),
        sumLeaveDays("sick"),
        sumLeaveDays("casual"),
        attendanceUserId
          ? Attendance.countDocuments({
              userId: attendanceUserId,
              loginTime: { $gte: yearStart, $lte: yearEnd },
              isLeaveDay: { $ne: true },
              // "Absent" markers are not present days.
              attendanceType: { $nin: ["half", "absent"] },
              status: { $ne: "absent" },
            })
          : 0,
        attendanceUserId
          ? Attendance.countDocuments({
              userId: attendanceUserId,
              loginTime: { $gte: yearStart, $lte: yearEnd },
              isLeaveDay: { $ne: true },
              attendanceType: "half",
            })
          : 0,
        // A Half Day topped up with Paid/Sick/Casual (see changeDayStatus)
        // is now a completed full day, not a Half Day — it shouldn't be
        // double-counted in the "Half Day" figure once it's already being
        // shown (and counted) as Paid/Sick/Casual leave via sumLeaveDays
        // above.
        Leave.countDocuments({
          userId: staffId,
          status: "approved",
          isHalfDayTopUp: true,
          leaveDate: { $gte: yearStart, $lte: yearEnd },
        }),
      ]);
    const halfCount = Math.max(0, rawHalfCount - halfTopUpCount);

    // "Total Working Days" = every calendar day of the year so far (from the
    // staff member's joining date, or Jan 1 if that's later, through today
    // or their relieving date — whichever comes first) minus days of
    // UNPAID leave only. Paid, Sick, Casual and Swap leave are days the
    // staff member is still compensated for (or, for Swap, already worked
    // earlier and is banking), so they don't reduce this count — only
    // Unpaid ("loss of pay") days do.
    const utcDateOnly = (d) => {
      const x = new Date(d);
      return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
    };
    const elapsedRangeStart =
      joinCutoff && utcDateOnly(joinCutoff) > utcDateOnly(yearStart)
        ? utcDateOnly(joinCutoff)
        : utcDateOnly(yearStart);
    let elapsedRangeEnd = utcDateOnly(yearEnd);
    if (utcDateOnly(today) < elapsedRangeEnd) elapsedRangeEnd = utcDateOnly(today);
    if (relievingCutoff && utcDateOnly(relievingCutoff) < elapsedRangeEnd) {
      elapsedRangeEnd = utcDateOnly(relievingCutoff);
    }
    const elapsedCalendarDays =
      elapsedRangeEnd >= elapsedRangeStart
        ? Math.round((elapsedRangeEnd - elapsedRangeStart) / 86400000) + 1
        : 0;

    // A calendar month where the staff member was unpaid-absent for the
    // ENTIRE month (no attendance, no half day, and no paid/sick/casual/
    // swap leave at all that month) is counted as a flat 30 unpaid days for
    // that month, not the month's actual length (28/29/30/31). This matches
    // the standard 30-day payroll month convention, so a fully-absent
    // 31-day month (e.g. May) doesn't cost the staff member an "extra"
    // unpaid day just because of the calendar, and a fully-absent 28/29-day
    // February isn't short-changed either.
    //
    // "Fully absent" does NOT mean every single calendar day has its own
    // unpaid Leave record -- Sundays/holidays inside the month never get
    // their own unpaid record (they're just shown as holidays and are
    // rightly never double-counted), so a genuinely fully-absent month's
    // recorded unpaid total is always LESS than the month's calendar-day
    // count, not equal to or greater than it. Instead, a month qualifies
    // when: it has at least one recorded unpaid day, nothing else (no
    // attendance, no paid/sick/casual/swap) was recorded that month, and
    // the staff member was actually employed for the month's full span
    // (joined before it started, not relieved before it ended, and the
    // month has fully elapsed -- a current, still-in-progress month is
    // never capped early).
    const monthFullyWithinEmployment = (monthNum) => {
      const monthStart = new Date(Date.UTC(year, monthNum - 1, 1));
      const monthEnd = new Date(Date.UTC(year, monthNum, 0));
      if (joinCutoff && utcDateOnly(joinCutoff) > monthStart) return false;
      if (relievingCutoff && utcDateOnly(relievingCutoff) < monthEnd)
        return false;
      if (monthEnd > utcDateOnly(today)) return false;
      return true;
    };

    const [monthlyUnpaidRaw, monthlyOtherLeave, monthlyAttendance] =
      await Promise.all([
        Leave.aggregate([
          {
            $match: {
              userId: new mongoose.Types.ObjectId(staffId),
              leaveType: "unpaid",
              status: "approved",
              leaveDate: { $gte: yearStart, $lte: yearEnd },
            },
          },
          {
            $group: {
              _id: { $month: "$leaveDate" },
              total: { $sum: { $ifNull: ["$dayValue", 1] } },
            },
          },
        ]),
        Leave.aggregate([
          {
            $match: {
              userId: new mongoose.Types.ObjectId(staffId),
              leaveType: { $nin: ["unpaid", "holiday"] },
              status: "approved",
              leaveDate: { $gte: yearStart, $lte: yearEnd },
            },
          },
          { $group: { _id: { $month: "$leaveDate" } } },
        ]),
        attendanceUserId
          ? Attendance.aggregate([
              {
                $match: {
                  userId: attendanceUserId,
                  loginTime: { $gte: yearStart, $lte: yearEnd },
                  isLeaveDay: { $ne: true },
                },
              },
              { $group: { _id: { $month: "$loginTime" } } },
            ])
          : [],
      ]);

    const monthsWithOtherLeave = new Set(monthlyOtherLeave.map((m) => m._id));
    const monthsWithAttendance = new Set(monthlyAttendance.map((m) => m._id));

    let unpaidCountForWorkingDays = 0;
    monthlyUnpaidRaw.forEach(({ _id: monthNum, total }) => {
      const fullyAbsentMonth =
        total > 0 &&
        !monthsWithAttendance.has(monthNum) &&
        !monthsWithOtherLeave.has(monthNum) &&
        monthFullyWithinEmployment(monthNum);
      unpaidCountForWorkingDays += fullyAbsentMonth ? 30 : total;
    });

    const totalLeaveTaken = unpaidCountForWorkingDays;
    const totalWorkingDays = Math.max(0, elapsedCalendarDays - totalLeaveTaken);

    // Earned leave BALANCE (not just "taken") — accrues from the
    // confirmation date at perYear/12 per completed month (1.5 paid,
    // 0.5 sick, 0.5 casual with the default policy) plus carry-forward.
    // The Paid/Sick/Casual counts above are only leave TAKEN in `year`,
    // which is why the header used to read 0/0/0 even though the staff
    // member had earned leave. For a past year the balance is shown as of
    // 31 Dec of that year; otherwise as of today.
    const [leaveBalance, paidLeaveValue, viewRecords] = await Promise.all([
      leaveBalancePromise,
      paidLeaveValuePromise,
      viewRecordsPromise,
    ]);
    const [attendanceRecords, leaveRecords, holidays, saturdayHolidays] =
      viewRecords;

    if (isAnnual) {
      const allHolidaysForYear = [...holidays, ...saturdayHolidays];

      const months = [];
      for (let m = 0; m < 12; m++) {
        const { days, isCurrentMonth } = buildMonthDays(
          year,
          m,
          attendanceRecords,
          leaveRecords,
          allHolidaysForYear,
          today,
          relievingCutoff,
          joinCutoff,
        );
        months.push({
          month: m,
          isCurrentMonth,
          today: isCurrentMonth ? today.getDate() : null,
          days,
        });
      }

      return {
        staffId,
        attendanceUserId,
        staffName: staff.staffName,
        year,
        mode: "annual",
        unpaidCount,
        swapCount,
        paidCount,
        sickCount,
        casualCount,
        presentCount,
        halfCount,
        elapsedCalendarDays,
        totalLeaveTaken,
        totalWorkingDays,
        leaveBalance,
        paidLeaveValue,
        months,
      };
    }

    const startOfMonth = rangeStart;
    const endOfMonth = rangeEnd;
    const saturdayHolidaysForMonth = saturdayHolidays.filter(
      (h) =>
        new Date(h.startDate) >= startOfMonth &&
        new Date(h.startDate) <= endOfMonth,
    );

    const { days, isCurrentMonth } = buildMonthDays(
      year,
      month,
      attendanceRecords,
      leaveRecords,
      [...holidays, ...saturdayHolidaysForMonth],
      today,
      relievingCutoff,
      joinCutoff,
    );

    return {
      staffId,
      attendanceUserId,
      staffName: staff.staffName,
      year,
      month,
      mode: "monthly",
      today: isCurrentMonth ? today.getDate() : null,
      isCurrentMonth,
      unpaidCount,
      swapCount,
      paidCount,
      sickCount,
      casualCount,
      presentCount,
      halfCount,
      elapsedCalendarDays,
      totalLeaveTaken,
      totalWorkingDays,
      leaveBalance,
      paidLeaveValue,
      days,
    };
  }
};

/** GET /staff-summary/:staffId/calendar — admin: any staff member's calendar. */
export const getStaffCalendar = async (req, res) => {
  try {
    const data = await buildStaffCalendarPayload(req.params.staffId, req.query);
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof CalendarLookupError) {
      return res
        .status(error.status)
        .json({ success: false, message: error.message });
    }
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

/**
 * GET /my-attendance/calendar — staff self-service: the SAME calendar view
 * as getStaffCalendar above, but the staffId is always resolved from the
 * logged-in account's own email rather than taken from the URL. This is
 * what makes it safe to leave open to any authenticated "user" role
 * without allowAdminOnly — there's no id parameter for a staff member to
 * swap out to view someone else's attendance.
 */
export const getMyCalendar = async (req, res) => {
  try {
    const email = req.user?.email?.toLowerCase().trim();
    const staff = email
      ? await Staff.findOne({ email }).select("_id staffName").lean()
      : null;

    if (!staff) {
      return res.status(200).json({
        success: true,
        data: null,
        message: "No staff profile is linked to your account yet — contact an admin.",
      });
    }

    const data = await buildStaffCalendarPayload(
      staff._id.toString(),
      req.query,
    );
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof CalendarLookupError) {
      return res
        .status(error.status)
        .json({ success: false, message: error.message });
    }
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PUT /day-status — ADMIN ONLY (see routes/leave.js). Changes what ONE
// calendar day is marked as for a staff member, in a single safe step:
//
//   Present / Half Day  <->  Unpaid  <->  Paid / Sick / Casual  <->  Holiday
//
// Body: { staffId, date: "YYYY-MM-DD", status, loginTime?, logoutTime?, reason? }
//   status: "present" | "half" | "paid" | "sick" | "casual" | "unpaid" | "holiday"
//
// Rules:
//  - Paid / Sick / Casual counts are FIXED by the leave policy: a day can
//    only be changed to one of them if that balance still has a full day
//    left (the same "left of" figure shown in the calendar header). If it
//    doesn't, the request is refused and NOTHING is changed.
//  - Unpaid is always allowed here (admin correction), even if the staff
//    member still has other leave left.
//  - Present / Half Day need a linked login account and can't be set on a
//    future date.
//  - A Sunday / holiday CAN be changed to Paid / Sick / Casual / Unpaid
//    (saved with isAdminOverride so the automatic "no leave on holidays"
//    cleanup keeps it), but not to Present / Half Day.
//  - Any date can be marked "holiday" for THIS staff member only (a
//    leaveType "holiday" record — never counted as leave, balance or
//    payroll, and the Sunday rule never puts leave on it).
//  - Swap Leave days can't be changed here.
//  - Everything is validated first, then the old record(s) are replaced
//    inside one transaction — the day is never left blank if something
//    fails. Sandwich (Sunday/holiday) days around the date are re-checked
//    afterwards.
// ═══════════════════════════════════════════════════════════════════════════
const DAY_STATUS_LABELS = {
  present: "Present",
  half: "Half Day",
  paid: "Paid Leave",
  sick: "Sick Leave",
  casual: "Casual Leave",
  unpaid: "Unpaid Leave",
  holiday: "Holiday",
};
const BALANCE_LEAVE_TYPES = ["paid", "sick", "casual"];

export const changeDayStatus = async (req, res) => {
  const { staffId, date, status, loginTime, logoutTime, reason } = req.body || {};

  if (!staffId || !mongoose.Types.ObjectId.isValid(staffId)) {
    return res.status(400).json({ success: false, message: "A valid staffId is required" });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, message: "date must be in YYYY-MM-DD format" });
  }
  if (!DAY_STATUS_LABELS[status]) {
    return res.status(400).json({
      success: false,
      message: "status must be one of: present, half, paid, sick, casual, unpaid, holiday",
    });
  }

  try {
    const staff = await Staff.findById(staffId).lean();
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    const { start: dayStart, end: dayEnd } = getDayRange(date);

    const holidayCheck = await isHolidayOrSunday(dayStart);
    const isNaturalHoliday = !!holidayCheck.isHoliday;
    const holidayName = holidayCheck.reason || "a holiday";

    const isAttendanceStatus = status === "present" || status === "half";
    if (isNaturalHoliday && isAttendanceStatus) {
      return res.status(400).json({
        success: false,
        message: `${date} is ${holidayName} — it can be changed to a leave type, but not to Present / Half Day.`,
      });
    }
    const attendanceUserId = staff.email
      ? (await resolveUserIdByEmail([staff.email]))[staff.email.toLowerCase()] || null
      : null;

    if (isAttendanceStatus) {
      if (!attendanceUserId) {
        return res.status(400).json({
          success: false,
          message: "This staff member has no linked login account, so Present / Half Day can't be recorded.",
        });
      }
      if (date > getDateStringIST(new Date())) {
        return res.status(400).json({
          success: false,
          message: "Present / Half Day can't be set on a future date.",
        });
      }
    }

    // What is on this day right now.
    const existingAttendance = attendanceUserId
      ? await findExistingAttendance(attendanceUserId, date)
      : null;
    const existingLeaves = await Leave.find({
      userId: staffId,
      leaveDate: { $gte: dayStart, $lte: dayEnd },
      status: { $in: ["pending", "approved"] },
    });

    if (
      existingLeaves.some((l) => l.leaveType === "swapleave") ||
      existingAttendance?.isLeaveDay
    ) {
      return res.status(400).json({
        success: false,
        message: "This day is a Swap Leave. Delete it first (so the extra hours are restored), then mark it again.",
      });
    }

    if (
      status === "holiday" &&
      (existingLeaves.some((l) => l.leaveType === "holiday") ||
        (isNaturalHoliday && !existingAttendance && !existingLeaves.length))
    ) {
      return res.status(400).json({
        success: false,
        message: `${date} is already a holiday.`,
      });
    }

    // If the day is currently a genuine Half Day (staff actually worked
    // half of it), picking Paid/Sick/Casual here means "top up the other
    // half with leave", not "replace the whole day with leave" — so only
    // half a day's balance is owed, and the worked half is kept rather
    // than deleted. Every other case (Present, Unpaid, no attendance at
    // all, etc.) still needs a full day.
    const isHalfTopUp =
      BALANCE_LEAVE_TYPES.includes(status) &&
      existingAttendance?.attendanceType === "half";
    const neededAmount = isHalfTopUp ? 0.5 : 1;

    // Paid / Sick / Casual counts are fixed — only allow the change if
    // enough of the day is still left (a full day, or just the missing
    // half when topping up a Half Day). Same basis as the calendar
    // header: the whole year's entitlement, as of 31 Dec of that year.
    // Before the confirmation date there is no Paid / Sick / Casual
    // entitlement at all — the old check used the whole year's balance
    // (from the confirmation month + advance limit), so e.g. 19 Aug could
    // be set to Sick for someone confirmed on 20 Aug.
    if (BALANCE_LEAVE_TYPES.includes(status) && isBeforeConfirmation(staff, date)) {
      return res.status(400).json({
        success: false,
        message: `${date} is before this staff member's confirmation date — ${DAY_STATUS_LABELS[status]} isn't available yet. Use Unpaid Leave.`,
      });
    }

    if (BALANCE_LEAVE_TYPES.includes(status)) {
      if (existingLeaves.some((l) => l.leaveType === status && !l.isSandwich)) {
        return res.status(400).json({
          success: false,
          message: `${date} is already ${DAY_STATUS_LABELS[status]}.`,
        });
      }
      const yearEnd = new Date(Date.UTC(dayStart.getUTCFullYear(), 11, 31, 12, 0, 0, 0));
      const balances = await computeLeaveBalances(
        staffId,
        staff.confirmationDate ?? null,
        null,
        yearEnd,
        staff.status === "Relieved" ? staff.relievingDate : null,
        { fullYearEntitlement: true },
      );
      // Leave already sitting on this same day is about to be removed, so
      // it gives its day back first (Sick and Casual share one pool).
      const giveBack = existingLeaves
        .filter((l) =>
          status === "paid"
            ? l.leaveType === "paid"
            : l.leaveType === "sick" || l.leaveType === "casual",
        )
        .reduce((sum, l) => sum + (l.dayValue ?? 1), 0);
      const available = (balances?.[status]?.remaining ?? 0) + giveBack;
      if (available < neededAmount) {
        const allotted = balances?.[status]?.allotted;
        return res.status(400).json({
          success: false,
          message: `No ${DAY_STATUS_LABELS[status]} left (${Math.max(0, available)} day(s) left${
            allotted !== undefined ? ` of ${allotted}` : ""
          }). ${DAY_STATUS_LABELS[status]} count is fixed — choose Unpaid Leave instead.`,
        });
      }
    }

    // Build the new attendance fields up front (validation errors here
    // should also leave the day untouched).
    let attendanceFields = null;
    if (isAttendanceStatus) {
      let loginDT;
      let logoutDT;
      if (status === "half") {
        // Shift start, not 00:00 IST (= 18:30 UTC the day before, which
        // made a Half Day on 6 Aug show on 5 Aug).
        loginDT = loginTime ? parseDT(loginTime) : parseDT(`${date}T${DEFAULT_SHIFT_START}:00`);
      } else {
        loginDT = loginTime ? parseDT(loginTime) : parseDT(`${date}T${DEFAULT_SHIFT_START}:00`);
        logoutDT = logoutTime ? parseDT(logoutTime) : parseDT(`${date}T${DEFAULT_SHIFT_END}:00`);
        if (logoutDT <= loginDT) {
          return res.status(400).json({
            success: false,
            message: "Logout time must be after login time",
          });
        }
      }
      // The day's own old attendance is being replaced, so its extra
      // minutes don't count as bank for itself.
      const bankMinutesAvailable =
        status === "present"
          ? Math.max(
              0,
              (await getAvailableBankMinutes(attendanceUserId)) -
                (existingAttendance?.extraHoursInMinutes || 0),
            )
          : 0;
      attendanceFields = buildAttendanceFields({
        userId: attendanceUserId,
        dateString: date,
        status: status === "half" ? "half-day" : undefined,
        loginTime: loginDT,
        logoutTime: logoutDT,
        source: "manual",
        bankMinutesAvailable,
      });
    }

    // ── Replace, all-or-nothing ─────────────────────────────────────────
    const session = await mongoose.startSession();
    let removedLeaveIds = [];
    try {
      session.startTransaction();

      // Topping up a Half Day keeps the worked half's attendance record —
      // only the OTHER half is being turned into leave, so there's nothing
      // to delete on the attendance side.
      if (existingAttendance && !isHalfTopUp) {
        await Attendance.deleteOne({ _id: existingAttendance._id }).session(session);
      }
      if (existingLeaves.length) {
        removedLeaveIds = existingLeaves.map((l) => l._id);
        await Leave.deleteMany({ _id: { $in: removedLeaveIds } }).session(session);
      }

      if (attendanceFields) {
        await new Attendance(attendanceFields).save({ session });
      } else {
        await new Leave({
          userId: staffId,
          leaveDate: dayStart,
          reason:
            reason?.trim() ||
            (isHalfTopUp
              ? `Half Day topped up with ${DAY_STATUS_LABELS[status]} by admin`
              : `Changed to ${DAY_STATUS_LABELS[status]} by admin`),
          leaveType: status,
          status: "approved",
          // Only the missing half is being taken as leave when topping up
          // an already-worked Half Day (0.5), otherwise it's a full day (1)
          // — this is what previously always deducted a whole day even
          // though half of it was genuinely worked.
          dayValue: neededAmount,
          isHalfDayTopUp: isHalfTopUp,
          approvedBy: req.user?._id || req.user?.id,
          approvedAt: new Date(),
          // Leave on a Sunday/holiday, or a staff-only holiday, is a
          // deliberate admin choice — protected from automatic cleanup.
          isAdminOverride: isNaturalHoliday || status === "holiday",
        }).save({ session });
      }

      if (existingAttendance) {
        await enforceExtraHoursConsistency(existingAttendance.userId, session);
      }

      await session.commitTransaction();
    } catch (txErr) {
      await session.abortTransaction().catch(() => {});
      throw txErr;
    } finally {
      session.endSession();
    }

    // Best-effort follow-ups (the change itself is already saved).
    if (attendanceFields?.bankMinutesUsed > 0) {
      try {
        await deductFromExtraHoursBank(attendanceUserId, attendanceFields.bankMinutesUsed);
      } catch (bankErr) {
        console.error("Extra-hours bank deduction failed (day-status):", bankErr);
      }
    }
    for (const id of removedLeaveIds) {
      try {
        await cleanupSandwichLeavesFor(id);
      } catch (cleanupErr) {
        console.error("Sandwich cleanup failed (day-status):", cleanupErr);
      }
    }
    // Re-judge the Sunday/holiday blocks around this date: e.g. turning a
    // Monday from Unpaid into Present can make the Sunday before it a
    // normal holiday again, and the other way round.
    try {
      await reconcileSandwichLeave({ userId: staffId, leaveDate: dayStart, leaveType: "unpaid" });
    } catch (sandwichErr) {
      console.error("Sandwich re-check failed (day-status):", sandwichErr);
    }

    // Keep a still-pending saved payroll for this month in step with the
    // calendar (e.g. Unpaid -> Holiday must bring the month back to full
    // salary). Paid/partial payrolls are left untouched.
    try {
      await refreshPendingPayrollForPeriod(staffId, date.slice(0, 7));
    } catch (payrollErr) {
      console.error("Payroll refresh failed (day-status):", payrollErr);
    }

    const from = existingAttendance
      ? existingAttendance.attendanceType === "half" ? "Half Day" : "Present"
      : existingLeaves.length
        ? DAY_STATUS_LABELS[existingLeaves[0].leaveType] || existingLeaves[0].leaveType
        : isNaturalHoliday
          ? holidayName
          : "nothing";

    await logActivity(req, {
      action: "UPDATE",
      actionLabel: `Changed ${date} for staff ${staffId} from ${from} to ${DAY_STATUS_LABELS[status]}`,
      tableName: "leaves",
      tableLabel: "Leave",
      description: `Admin changed ${date} for staff ${staffId}: ${from} -> ${DAY_STATUS_LABELS[status]}.${reason ? ` Reason: ${reason}` : ""}`,
      refField: "userId",
    });

    return res.json({
      success: true,
      message: `${date} changed from ${from} to ${DAY_STATUS_LABELS[status]}.`,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};