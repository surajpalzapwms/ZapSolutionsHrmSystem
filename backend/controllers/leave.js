import mongoose from "mongoose";
import { randomUUID } from "crypto";
import {
  Attendance,
  Leave,
  Staff,
  toTitleCase,
  formatDateForLog,
  formatMinutesToTimeString,
  getAttendanceType,
  getDayRange,
  getInclusiveDateStrings,
  getLeaveRangeFromDate,
  isHolidayOrSunday,
  enforceExtraHoursConsistency,
  calculateExtraHoursSummary,
  calculateMonthlyExtraHoursSummary,
  findExistingAttendance,
  findExistingLeave,
  getAvailablePaidLeaves,
  getAllAttendance,
  getAttendanceForDay,
  getHolidays as getHolidaysService,
  getLeaves as getLeavesService,
  getStaffById,
  getUserAttendanceRange,
  getDateStringIST,
  getClampedWorkingMinutes,
  getUserShift,
  findAttendanceByUserAndDate,
  findOpenAttendanceForDate,
  LUNCH_START,
  LUNCH_END,
  REQUIRED_WORK_MINUTES,
} from "../services/leave.js";
import User from "../models/User.js";
import Holiday from "../models/holiday.js";
import SaturdayHolidayRule from "../models/saturdayHolidayRule.js";

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

const parseDT = (str) => {
  const dt = new Date(str);
  return new Date(
    Date.UTC(
      dt.getFullYear(),
      dt.getMonth(),
      dt.getDate(),
      dt.getHours(),
      dt.getMinutes(),
      dt.getSeconds(),
    ),
  );
};

// GET /attendance
export const listAttendance = async (req, res) => {
  try {
    const records = await getAllAttendance();
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
      return res.status(400).json({
        success: false,
        message: "Logout time must be after login time",
      });

    const totalMinutesWorked = Math.floor((logoutDT - loginDT) / 60000);
    const h = Math.floor(totalMinutesWorked / 60),
      m = totalMinutesWorked % 60;
    const totalTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
    const { type: attendanceType, expectedMinutes } =
      getAttendanceType(totalMinutesWorked);
    const extraMinutes = Math.max(0, totalMinutesWorked - expectedMinutes);
    const extraHours = formatMinutesToTimeString(extraMinutes);
    const dateString = formatDateForLog(loginDT);

    const updated = await Attendance.findByIdAndUpdate(
      id,
      {
        loginTime: loginDT,
        logoutTime: logoutDT,
        totalTime,
        workingHoursPerDay:
          workingHoursPerDay || previousRecord.workingHoursPerDay,
        extraHours,
        extraHoursInMinutes: extraMinutes,
        attendanceType,
        remarks: remarks || previousRecord.remarks,
        updatedAt: new Date(),
      },
      { new: true },
    );
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
      return res.status(400).json({
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
    const { leaveType, status } = req.query;
    const leaves = await getLeavesService({ leaveType, status });
    res.json(leaves);
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// POST / (apply leave)
// Accepts an optional `endDate` alongside `leaveDate` to apply for a range of
// days (e.g. leaveDate=2026-07-10, endDate=2026-07-15) in one go — every
// calendar day in that range gets its own Leave doc (including Sundays/
// holidays, per how this is meant to be used) sharing one requestGroupId so
// they can be tracked/approved together.
export const applyLeave = async (req, res) => {
  try {
    const { userId, leaveDate, endDate, reason, leaveType, status } = req.body;
    if (!userId || !leaveDate || !reason) {
      return res.status(400).json({
        success: false,
        message: "User ID, leave date, and reason are required",
      });
    }

    const validLeaveTypes = ["paid", "unpaid", "swapleave"];
    if (leaveType && !validLeaveTypes.includes(leaveType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid leave type. Must be 'paid', 'unpaid', or 'swapleave'",
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(leaveDate)) {
      return res.status(400).json({
        success: false,
        message: "Invalid leaveDate format. Use YYYY-MM-DD",
      });
    }
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({
        success: false,
        message: "Invalid endDate format. Use YYYY-MM-DD",
      });
    }

    const isRange = !!endDate && endDate !== leaveDate;
    if (isRange && endDate < leaveDate) {
      return res.status(400).json({
        success: false,
        message: "endDate cannot be before leaveDate",
      });
    }

    const todayString = getDateStringIST(new Date());
    if (leaveDate > todayString || (endDate && endDate > todayString)) {
      return res.status(400).json({
        success: false,
        message: "Cannot apply for leave for future dates",
      });
    }

    const dateStrings = isRange
      ? getInclusiveDateStrings(leaveDate, endDate)
      : [leaveDate];

    // Single-day requests keep the original Sunday/holiday block. Range
    // requests deliberately include every day (Sundays/holidays too) so a
    // 10th–15th request gives leave for the whole span without gaps.
    if (!isRange) {
      const { start: parsedLeaveDate } = getDayRange(leaveDate);
      if (parsedLeaveDate.getUTCDay() === 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot apply for leave on Sunday",
        });
      }
      const holidayCheck = await isHolidayOrSunday(parsedLeaveDate);
      if (holidayCheck.isHoliday && holidayCheck.reason !== "Sunday") {
        return res.status(400).json({
          success: false,
          message: `Cannot apply for leave on holiday: ${holidayCheck.reason}`,
        });
      }
    }

    // Validate every day in the (range) request up front so we never leave a
    // partial set of days applied — a day with existing attendance or an
    // existing leave record blocks the whole request.
    for (const dateStr of dateStrings) {
      const { start: dayStart, end: dayEnd } = getDayRange(dateStr);
      const existingAttendance = await findExistingAttendance(userId, dayStart);
      if (existingAttendance) {
        return res.status(400).json({
          success: false,
          message: `Cannot apply for leave on ${dateStr} — existing attendance on that day`,
        });
      }
      if (
        await Leave.findOne({
          userId,
          leaveDate: { $gte: dayStart, $lte: dayEnd },
        })
      ) {
        return res.status(400).json({
          success: false,
          message: `Leave already exists for ${dateStr}`,
        });
      }
    }

    if (leaveType === "paid") {
      const staffRecord = await getStaffById(userId);
      const joinDate =
        staffRecord?.date ?? new Date(Date.UTC(new Date().getFullYear(), 0, 1));
      const available = await getAvailablePaidLeaves(userId, joinDate);
      if (available < dateStrings.length) {
        return res.status(400).json({
          success: false,
          message: `Insufficient paid leave balance for this calendar year. Requested ${dateStrings.length} day(s), ${available} available.`,
        });
      }
    }

    const requestGroupId = isRange ? randomUUID() : null;
    const docs = dateStrings.map((dateStr) => ({
      userId,
      leaveDate: getDayRange(dateStr).start,
      requestGroupId,
      reason,
      leaveType: leaveType || "unpaid",
      status: status || "approved",
    }));
    const savedLeaves = await Leave.insertMany(docs);

    const startStr = formatDateForLog(savedLeaves[0].leaveDate);
    const endStr = formatDateForLog(
      savedLeaves[savedLeaves.length - 1].leaveDate,
    );
    const rangeLabel = isRange ? `${startStr} to ${endStr}` : startStr;
    await logActivity(req, {
      action: "CREATE",
      actionLabel: `Applied ${toTitleCase(leaveType || "Unpaid")} Leave for User ${userId} (${rangeLabel})`,
      tableName: "leaves",
      tableLabel: "Leave",
      recordId: savedLeaves[0]._id,
      referenceNumber: `${userId}_${startStr}`,
      newData: isRange
        ? savedLeaves.map((l) => l.toObject())
        : savedLeaves[0].toObject(),
      newSnapshots: savedLeaves.map((l) => ({
        recordId: String(l._id),
        refNumber: `${userId}_${formatDateForLog(l.leaveDate)}`,
        data: l.toObject(),
      })),
      description: `${toTitleCase(leaveType || "Unpaid")} leave applied for user ${userId} (${rangeLabel}, ${dateStrings.length} day(s)). Reason: ${reason}`,
      refField: "userId",
    });

    res.status(201).json({
      success: true,
      message: isRange
        ? `Leave applied successfully for ${dateStrings.length} days`
        : "Leave applied successfully",
      leave: savedLeaves[0],
      leaves: savedLeaves,
      requestGroupId,
    });
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
// Also accepts an optional `endDate` for a multi-day request (e.g. 10th to
// 15th) — every day in the range (Sundays/holidays included, no gaps) gets
// its own pending Leave doc sharing one requestGroupId, so the admin can
// approve/reject the whole span in one action.
export const applyMyLeave = async (req, res) => {
  try {
    const email = req.user?.email?.toLowerCase().trim();
    const staff = email ? await Staff.findOne({ email }) : null;
    if (!staff) {
      return res.status(404).json({
        success: false,
        message:
          "No staff profile is linked to your account yet. Contact your admin.",
      });
    }
    const userId = staff._id;
    const { leaveDate, endDate, reason, leaveType } = req.body;

    if (!leaveDate || !reason) {
      return res.status(400).json({
        success: false,
        message: "Leave date and reason are required",
      });
    }
    const validLeaveTypes = ["paid", "unpaid", "swapleave"];
    if (leaveType && !validLeaveTypes.includes(leaveType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid leave type. Must be 'paid', 'unpaid', or 'swapleave'",
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(leaveDate)) {
      return res.status(400).json({
        success: false,
        message: "Invalid leaveDate format. Use YYYY-MM-DD",
      });
    }
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({
        success: false,
        message: "Invalid endDate format. Use YYYY-MM-DD",
      });
    }

    const isRange = !!endDate && endDate !== leaveDate;
    if (isRange && endDate < leaveDate) {
      return res.status(400).json({
        success: false,
        message: "endDate cannot be before leaveDate",
      });
    }

    const dateStrings = isRange
      ? getInclusiveDateStrings(leaveDate, endDate)
      : [leaveDate];

    // Single-day requests keep the original Sunday/holiday block; range
    // requests intentionally cover every day in the span.
    if (!isRange) {
      const { start: parsedLeaveDate } = getDayRange(leaveDate);
      if (parsedLeaveDate.getUTCDay() === 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot request leave on Sunday",
        });
      }
      const holidayCheck = await isHolidayOrSunday(parsedLeaveDate);
      if (holidayCheck.isHoliday && holidayCheck.reason !== "Sunday") {
        return res.status(400).json({
          success: false,
          message: `Cannot request leave on holiday: ${holidayCheck.reason}`,
        });
      }
    }

    for (const dateStr of dateStrings) {
      const { start: dayStart, end: dayEnd } = getDayRange(dateStr);
      const existing = await Leave.findOne({
        userId,
        leaveDate: { $gte: dayStart, $lte: dayEnd },
        status: { $in: ["pending", "approved"] },
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `A leave request already exists for ${dateStr}`,
        });
      }
    }

    const requestGroupId = isRange ? randomUUID() : null;
    const docs = dateStrings.map((dateStr) => ({
      userId,
      leaveDate: getDayRange(dateStr).start,
      requestGroupId,
      reason,
      leaveType: leaveType || "unpaid",
      status: "pending",
    }));
    const savedLeaves = await Leave.insertMany(docs);

    const startStr = formatDateForLog(savedLeaves[0].leaveDate);
    const endStr = formatDateForLog(
      savedLeaves[savedLeaves.length - 1].leaveDate,
    );
    const rangeLabel = isRange ? `${startStr} to ${endStr}` : startStr;
    await logActivity(req, {
      action: "CREATE",
      actionLabel: `Leave request submitted by ${staff.staffName} for ${rangeLabel}`,
      tableName: "leaves",
      tableLabel: "Leave",
      recordId: savedLeaves[0]._id,
      referenceNumber: `${userId}_${startStr}`,
      newData: isRange
        ? savedLeaves.map((l) => l.toObject())
        : savedLeaves[0].toObject(),
      description: `${toTitleCase(leaveType || "unpaid")} leave requested by ${staff.staffName} for ${rangeLabel} (${dateStrings.length} day(s)). Reason: ${reason}`,
      refField: "userId",
    });

    res.status(201).json({
      success: true,
      message: isRange
        ? `Leave request submitted for ${dateStrings.length} days. Waiting for admin approval.`
        : "Leave request submitted. Waiting for admin approval.",
      leave: savedLeaves[0],
      leaves: savedLeaves,
      requestGroupId,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
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
    const leaves = await Leave.find({ userId: staff._id })
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
    const filter = {};
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

    if (leave.leaveType === "paid") {
      const staffRecord = await getStaffById(leave.userId);
      const joinDate =
        staffRecord?.date ?? new Date(Date.UTC(new Date().getFullYear(), 0, 1));
      const available = await getAvailablePaidLeaves(leave.userId, joinDate);
      if (available < 1) {
        return res.status(400).json({
          success: false,
          message:
            "Staff has insufficient paid leave balance for this calendar year.",
        });
      }
    }

    leave.status = "approved";
    leave.approvedBy = req.user._id;
    leave.approvedAt = new Date();
    await leave.save();

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

// PUT /requests/group/:groupId/approve — admin approves every day in a
// multi-day leave request at once.
export const approveLeaveGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const leaves = await Leave.find({ requestGroupId: groupId });
    if (leaves.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Leave request group not found" });
    }
    const pending = leaves.filter((l) => l.status === "pending");
    if (pending.length === 0) {
      return res.status(400).json({
        success: false,
        message: `This request is already ${leaves[0].status}`,
      });
    }

    if (pending[0].leaveType === "paid") {
      const staffRecord = await getStaffById(pending[0].userId);
      const joinDate =
        staffRecord?.date ?? new Date(Date.UTC(new Date().getFullYear(), 0, 1));
      const available = await getAvailablePaidLeaves(
        pending[0].userId,
        joinDate,
      );
      if (available < pending.length) {
        return res.status(400).json({
          success: false,
          message: `Staff has insufficient paid leave balance for this calendar year. Requested ${pending.length} day(s), ${available} available.`,
        });
      }
    }

    const now = new Date();
    await Leave.updateMany(
      { requestGroupId: groupId, status: "pending" },
      { status: "approved", approvedBy: req.user._id, approvedAt: now },
    );
    const updated = await Leave.find({ requestGroupId: groupId }).sort({
      leaveDate: 1,
    });

    const startStr = formatDateForLog(updated[0].leaveDate);
    const endStr = formatDateForLog(updated[updated.length - 1].leaveDate);
    await logActivity(req, {
      action: "UPDATE",
      actionLabel: `Approved leave request for user ${updated[0].userId} (${startStr} to ${endStr})`,
      tableName: "leaves",
      tableLabel: "Leave",
      recordId: updated[0]._id,
      newData: updated.map((l) => l.toObject()),
      description: `Leave request approved for user ${updated[0].userId}, ${startStr} to ${endStr} (${updated.length} day(s)).`,
      refField: "userId",
    });

    res.json({
      success: true,
      message: `Leave request approved for ${updated.length} day(s)`,
      leaves: updated,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// PUT /requests/group/:groupId/reject — admin rejects every day in a
// multi-day leave request at once.
export const rejectLeaveGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const leaves = await Leave.find({ requestGroupId: groupId });
    if (leaves.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Leave request group not found" });
    }
    const pending = leaves.filter((l) => l.status === "pending");
    if (pending.length === 0) {
      return res.status(400).json({
        success: false,
        message: `This request is already ${leaves[0].status}`,
      });
    }

    const now = new Date();
    const update = {
      status: "rejected",
      approvedBy: req.user._id,
      approvedAt: now,
    };
    await Leave.updateMany(
      { requestGroupId: groupId, status: "pending" },
      update,
    );
    if (req.body?.remarks) {
      // Append the admin remark to each day's reason individually (bulk
      // updateMany can't reference each doc's own field in one query).
      await Promise.all(
        pending.map((l) =>
          Leave.findByIdAndUpdate(l._id, {
            reason: `${l.reason} [Admin: ${req.body.remarks}]`,
          }),
        ),
      );
    }
    const updated = await Leave.find({ requestGroupId: groupId }).sort({
      leaveDate: 1,
    });

    const startStr = formatDateForLog(updated[0].leaveDate);
    const endStr = formatDateForLog(updated[updated.length - 1].leaveDate);
    await logActivity(req, {
      action: "UPDATE",
      actionLabel: `Rejected leave request for user ${updated[0].userId} (${startStr} to ${endStr})`,
      tableName: "leaves",
      tableLabel: "Leave",
      recordId: updated[0]._id,
      newData: updated.map((l) => l.toObject()),
      description: `Leave request rejected for user ${updated[0].userId}, ${startStr} to ${endStr} (${updated.length} day(s)).`,
      refField: "userId",
    });

    res.json({
      success: true,
      message: `Leave request rejected for ${updated.length} day(s)`,
      leaves: updated,
    });
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
    if (leaveType && !["paid", "unpaid", "swapleave"].includes(leaveType))
      return res
        .status(400)
        .json({ success: false, message: "Invalid leave type" });
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
    res.json({ success: true, message: "Leave record deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

// POST /attendance/record
export const recordAttendance = async (req, res) => {
  try {
    const { userId, loginTime, logoutTime, workingHoursPerDay } = req.body;
    if (!userId || !loginTime || !logoutTime)
      return res.status(400).json({
        success: false,
        message: "User ID, login time, and logout time are required",
      });
    const loginDT = parseDT(loginTime),
      logoutDT = parseDT(logoutTime);
    if (logoutDT <= loginDT)
      return res.status(400).json({
        success: false,
        message: "Logout time must be after login time",
      });
    const holidayCheck = await isHolidayOrSunday(loginDT);
    if (holidayCheck.isHoliday)
      return res.status(400).json({
        success: false,
        message: `Cannot record attendance on ${holidayCheck.reason}`,
      });
    const dateString = getDateStringIST(loginDT);
    if (await findExistingAttendance(userId, dateString))
      return res.status(400).json({
        success: false,
        message:
          "Attendance already recorded for this user on the selected date",
      });
    const totalMinutesWorked = Math.floor((logoutDT - loginDT) / 60000);
    const h = Math.floor(totalMinutesWorked / 60),
      m = totalMinutesWorked % 60;
    const totalTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
    const { type: attendanceType, expectedMinutes } =
      getAttendanceType(totalMinutesWorked);
    const extraMinutes = Math.max(0, totalMinutesWorked - expectedMinutes);
    const extraHours = formatMinutesToTimeString(extraMinutes);
    const remarkStr =
      attendanceType === "half"
        ? `Half day (${totalTime} worked, ${extraMinutes} extra min above 4 h base)`
        : `Full day (${totalTime} worked, ${extraMinutes} extra min above 8 h base)`;
    const attendance = new Attendance({
      userId,
      loginTime: loginDT,
      logoutTime: logoutDT,
      date: dateString,
      totalTime,
      workingHoursPerDay: workingHoursPerDay || 8,
      extraHours,
      extraHoursInMinutes: extraMinutes,
      attendanceType,
      source: "manual",
      remarks: remarkStr,
    });
    await attendance.save();
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
export const performSelfCheckIn = async (userId) => {
  const now = new Date();

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
    source: "self",
    sessionMinutes: 0,
  });
  return { ok: true, created: true, attendance };
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

    const currentSessionMinutes = getClampedWorkingMinutes(
      open.loginTime,
      now,
      shiftStartTime,
      shiftEndTime,
    );
    const totalMinutesWorked =
      (open.sessionMinutes || 0) + currentSessionMinutes;

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

    const totalTime = formatMinutesToTimeString(totalMinutesWorked);
    const { type: attendanceType, expectedMinutes } =
      getAttendanceType(totalMinutesWorked);
    const extraMinutes = Math.max(0, totalMinutesWorked - expectedMinutes);
    const wasEarly =
      totalMinutesWorked < REQUIRED_WORK_MINUTES && open.earlySignOutApproved;

    open.logoutTime = now;
    open.sessionMinutes = totalMinutesWorked;
    open.totalTime = totalTime;
    open.attendanceType = attendanceType;
    open.extraHours = formatMinutesToTimeString(extraMinutes);
    open.extraHoursInMinutes = extraMinutes;
    open.remarks = wasEarly
      ? `Admin-approved early sign-out. Working hours counted within shift (${shiftStartTime}–${shiftEndTime}, lunch excluded). Worked: ${totalTime}`
      : `Working hours counted within shift (${shiftStartTime}–${shiftEndTime}, lunch excluded). Worked: ${totalTime}`;
    await open.save();

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

// GET /attendance/me/today — the caller's own sign-in status for today, so
// the dashboard can restore Sign In / Sign Out state (and the Sign Out
// button's enabled/disabled state) after a page refresh.
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
    for (const [index, row] of attendanceData.entries()) {
      try {
        const { userId, loginTime, logoutTime, workingHoursPerDay } = row;
        if (!userId || !loginTime || !logoutTime) {
          results.failed++;
          results.errors.push(
            `Row ${index + 1}: Missing userId, loginTime, or logoutTime`,
          );
          continue;
        }
        const loginDT = parseDT(loginTime),
          logoutDT = parseDT(logoutTime);
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
        const holidayCheck = await isHolidayOrSunday(loginDT);
        if (holidayCheck.isHoliday) {
          results.failed++;
          results.errors.push(
            `Row ${index + 1}: Cannot record on ${holidayCheck.reason}`,
          );
          continue;
        }
        const dateString = getDateStringIST(loginDT);
        if (await findExistingAttendance(userId, dateString)) {
          results.failed++;
          results.errors.push(
            `Row ${index + 1}: Attendance already exists for user ${userId} on ${dateString}`,
          );
          continue;
        }
        const totalMinutesWorked = Math.floor((logoutDT - loginDT) / 60000);
        const h = Math.floor(totalMinutesWorked / 60),
          m = totalMinutesWorked % 60;
        const totalTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
        const { type: attendanceType, expectedMinutes } =
          getAttendanceType(totalMinutesWorked);
        const extraMinutes = Math.max(0, totalMinutesWorked - expectedMinutes);
        const attendance = new Attendance({
          userId,
          loginTime: loginDT,
          logoutTime: logoutDT,
          date: dateString,
          totalTime,
          workingHoursPerDay: workingHoursPerDay || 8,
          extraHours: formatMinutesToTimeString(extraMinutes),
          extraHoursInMinutes: extraMinutes,
          attendanceType,
          source: "import",
          remarks: `${toTitleCase(attendanceType)} day (imported) — ${totalTime} worked`,
        });
        await attendance.save();
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

// POST /leave/import
export const importLeaves = async (req, res) => {
  try {
    const leavesData = req.body;
    if (!Array.isArray(leavesData) || leavesData.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "No leave data provided" });
    const results = { success: 0, failed: 0, errors: [] };
    const importedDocs = [];
    const validLeaveTypes = ["paid", "unpaid", "swapleave"];
    for (const [index, row] of leavesData.entries()) {
      try {
        const { userId, leaveDate, reason, leaveType, status } = row;
        if (!userId || !leaveDate || !reason) {
          results.failed++;
          results.errors.push(
            `Row ${index + 1}: Missing userId, leaveDate, or reason`,
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
        if (parsedDate.getUTCDay() === 0) {
          results.failed++;
          results.errors.push(
            `Row ${index + 1}: Cannot import leave on Sunday`,
          );
          continue;
        }
        const holidayCheck = await isHolidayOrSunday(parsedDate);
        if (holidayCheck.isHoliday && holidayCheck.reason !== "Sunday") {
          results.failed++;
          results.errors.push(
            `Row ${index + 1}: Cannot import leave on holiday: ${holidayCheck.reason}`,
          );
          continue;
        }
        const { start, end } = getDayRange(parsedDate);
        if (
          await Leave.findOne({ userId, leaveDate: { $gte: start, $lte: end } })
        ) {
          results.failed++;
          results.errors.push(
            `Row ${index + 1}: Leave already exists for user ${userId} on ${formatDateForLog(parsedDate)}`,
          );
          continue;
        }
        const leave = new Leave({
          userId,
          leaveDate: parsedDate,
          reason,
          leaveType: leaveType || "unpaid",
          status: status || "approved",
        });
        await leave.save();
        importedDocs.push(leave.toObject());
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`Row ${index + 1}: ${err.message}`);
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
      return res.status(400).json({
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
    if (existingAttendance && !existingAttendance.isLeaveDay) {
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
      return res.status(400).json({
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
      return res.status(500).json({
        success: false,
        message: "Failed to deduct all required minutes.",
      });
    }
    let leaveAttendance;
    if (existingAttendance && existingAttendance.isLeaveDay) {
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
    res.status(500).json({
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
    res.status(500).json({
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
const resolveUserIdByEmail = async (emails) => {
  const cleanEmails = [
    ...new Set(emails.filter(Boolean).map((e) => e.toLowerCase())),
  ];
  if (cleanEmails.length === 0) return {};
  const users = await User.find({ email: { $in: cleanEmails } })
    .select("email")
    .lean();
  const map = {};
  users.forEach((u) => {
    if (u.email) map[u.email.toLowerCase()] = u._id;
  });
  return map;
};

export const getStaffSummary = async (req, res) => {
  try {
    const staffList = await Staff.find({ enabled: { $ne: false } })
      .sort({ staffName: 1 })
      .lean();
    const userIdByEmail = await resolveUserIdByEmail(
      staffList.map((s) => s.email),
    );

    const now = new Date();
    const currentYear = now.getFullYear();
    const startOfYear = new Date(Date.UTC(currentYear, 0, 1, 0, 0, 0, 0));
    const endOfYear = new Date(Date.UTC(currentYear, 11, 31, 23, 59, 59, 999));

    const data = await Promise.all(
      staffList.map(async (staff) => {
        const attendanceUserId = staff.email
          ? userIdByEmail[staff.email.toLowerCase()] || null
          : null;

        const [remainingPaid, leaveTaken, unpaidTaken, swapTaken] =
          await Promise.all([
            getAvailablePaidLeaves(staff._id, staff.date),
            Leave.countDocuments({
              userId: staff._id,
              leaveType: "paid",
              status: "approved",
              leaveDate: { $gte: startOfYear, $lte: endOfYear },
            }),
            Leave.countDocuments({
              userId: staff._id,
              leaveType: "unpaid",
              status: "approved",
            }),
            Leave.countDocuments({
              userId: staff._id,
              leaveType: "swapleave",
              status: "approved",
            }),
          ]);

        const extra = attendanceUserId
          ? await calculateExtraHoursSummary(attendanceUserId)
          : { leaveDaysAvailable: 0, remainingMinutes: 0 };

        return {
          staffId: staff._id,
          attendanceUserId,
          staffName: staff.staffName,
          email: staff.email || "",
          contactNo: staff.contactNo || "",
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

    res.json({ success: true, data });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

const buildMonthDays = (
  year,
  month,
  attendanceRecords,
  leaveRecords,
  holidays,
  today,
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
    const recDate = new Date(rec.loginTime);
    if (recDate.getUTCFullYear() !== year || recDate.getUTCMonth() !== month)
      return;
    const d = recDate.getUTCDate();
    if (!days[d]) return;
    days[d].status = rec.attendanceType === "half" ? "half" : "present";
    days[d].recordId = rec._id;
    days[d].loginTime = rec.loginTime; // ✅ added
    days[d].logoutTime = rec.logoutTime || null; // ✅ added
  });

  leaveRecords.forEach((rec) => {
    const recDate = new Date(rec.leaveDate);
    if (recDate.getUTCFullYear() !== year || recDate.getUTCMonth() !== month)
      return;
    const d = recDate.getUTCDate();
    if (!days[d]) return;
    days[d].status =
      rec.leaveType === "paid"
        ? "paid"
        : rec.leaveType === "swapleave"
          ? "swap"
          : "unpaid";
    days[d].leaveId = rec._id;
  });

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

  return { days, isCurrentMonth };
};

export const getStaffCalendar = async (req, res) => {
  try {
    const { staffId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(staffId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid staff ID" });
    }

    const staff = await Staff.findById(staffId).lean();
    if (!staff)
      return res
        .status(404)
        .json({ success: false, message: "Staff not found" });

    const today = new Date();
    const year = req.query.year
      ? parseInt(req.query.year, 10)
      : today.getFullYear();
    const isAnnual = req.query.mode === "annual";

    const attendanceUser = staff.email
      ? await User.findOne({ email: staff.email.toLowerCase() })
          .select("_id")
          .lean()
      : null;
    const attendanceUserId = attendanceUser?._id || null;

    const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const [unpaidCount, swapCount] = await Promise.all([
      Leave.countDocuments({
        userId: staffId,
        leaveType: "unpaid",
        status: "approved",
        leaveDate: { $gte: yearStart, $lte: yearEnd },
      }),
      Leave.countDocuments({
        userId: staffId,
        leaveType: "swapleave",
        status: "approved",
        leaveDate: { $gte: yearStart, $lte: yearEnd },
      }),
    ]);

    if (isAnnual) {
      const [attendanceRecords, leaveRecords, holidays] = await Promise.all([
        attendanceUserId
          ? Attendance.find({
              userId: attendanceUserId,
              loginTime: { $gte: yearStart, $lte: yearEnd },
            }).lean()
          : [],
        Leave.find({
          userId: staffId,
          leaveDate: { $gte: yearStart, $lte: yearEnd },
          status: "approved",
        }).lean(),
        Holiday.find({
          enabled: true,
          startDate: { $lte: yearEnd },
          endDate: { $gte: yearStart },
        }).lean(),
      ]);

      const saturdayHolidays = await getSaturdayHolidaysAsEntries(year);
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
        );
        months.push({
          month: m,
          isCurrentMonth,
          today: isCurrentMonth ? today.getDate() : null,
          days,
        });
      }

      return res.json({
        success: true,
        data: {
          staffId,
          attendanceUserId,
          staffName: staff.staffName,
          year,
          mode: "annual",
          unpaidCount,
          swapCount,
          months,
        },
      });
    }

    const month =
      req.query.month !== undefined
        ? parseInt(req.query.month, 10)
        : today.getMonth();
    const startOfMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

    const [attendanceRecords, leaveRecords, holidays] = await Promise.all([
      attendanceUserId
        ? Attendance.find({
            userId: attendanceUserId,
            loginTime: { $gte: startOfMonth, $lte: endOfMonth },
          }).lean()
        : [],
      Leave.find({
        userId: staffId,
        leaveDate: { $gte: startOfMonth, $lte: endOfMonth },
        status: "approved",
      }).lean(),
      Holiday.find({
        enabled: true,
        startDate: { $lte: endOfMonth },
        endDate: { $gte: startOfMonth },
      }).lean(),
    ]);

    const saturdayHolidaysForMonth = (
      await getSaturdayHolidaysAsEntries(year)
    ).filter(
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
    );

    res.json({
      success: true,
      data: {
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
        days,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};
