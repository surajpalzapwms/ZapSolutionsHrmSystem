// controllers/hrm/attendanceController.js
import mongoose from "mongoose";
import Attendance from "../models/Attendance.js";
import Holiday from "../models/holiday.js";
import SaturdayHolidayRule from "../models/saturdayHolidayRule.js";
import User from "../models/User.js";
import Staff from "../models/Staff.js";
import { asyncHandler, ApiError } from "../utils/asyncHandler.js";
import { classifyAttendance, getDayRange, toDateOnlyString } from "../utils/dateHelpers.js";
import { getDateStringIST } from "../services/leave.js";

// Swap for your real activity logger if one exists in Zap Solutionz.
const logActivity = async (_req, _entry) => {};

const assertValidId = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid attendance record ID");
  }
};

const assertValidUserId = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid user ID");
  }
};

const ORDINAL = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };

// Attendance.userId points at the login User account, while the staff
// lifecycle (joining date/status/relievingDate) lives on Staff — the two
// are only linked by email. This checks that the date being marked falls
// within the staff member's actual employment window (their joining date
// through their relieving date, if they've left) rather than blocking
// them outright the moment they're marked "Relieving" — an admin should
// still be able to backfill/correct attendance for months they actually
// worked, just not for dates before they joined or after they left.
const assertStaffCanMarkAttendance = async (userId, forDate) => {
  const user = await User.findById(userId).select("email").lean();
  if (!user?.email) return; // no linked Staff record to check against
  const staff = await Staff.findOne({ email: user.email.toLowerCase().trim() })
    .select("status staffName date relievingDate")
    .lean();
  if (!staff) return;

  const markDate = normalizedDateOf(forDate);

  if (staff.date) {
    const joinDate = normalizedDateOf(staff.date);
    if (markDate < joinDate) {
      throw new ApiError(
        400,
        `Cannot mark attendance — ${staff.staffName} joined the organization on ${toDateOnlyString(joinDate)}, which is after ${toDateOnlyString(markDate)}.`,
      );
    }
  }

  if (staff.status === "Relieving" && staff.relievingDate) {
    const relievingDate = normalizedDateOf(staff.relievingDate);
    if (markDate > relievingDate) {
      throw new ApiError(
        400,
        `Cannot mark attendance — ${staff.staffName} left the organization on ${toDateOnlyString(relievingDate)}, which is before ${toDateOnlyString(markDate)}.`,
      );
    }
  }
};

/**
 * Rejects attendance on a Sunday, a manually-added Holiday (including
 * one-off "Emergency" closures like heavy rain), or a Saturday the admin
 * has marked as a recurring holiday for that month (e.g. 2nd & 4th
 * Saturday for one month, 3rd & 4th for another).
 */

// controllers/hrm/attendanceController.js  (add this export)

/** GET /me/month?year=YYYY&month=1-12 — full calendar for the logged-in user. */
export const getMyMonthCalendar = asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10); // 1-12
  if (!year || !month || month < 1 || month > 12) {
    throw new ApiError(400, "Valid year and month (1-12) are required");
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const daysInMonth = monthEnd.getUTCDate();

  const [attendanceRecords, holidays] = await Promise.all([
    Attendance.find({ userId, date: { $gte: monthStart, $lte: monthEnd } }).lean(),
    Holiday.find({
      enabled: { $ne: false },
      startDate: { $lte: monthEnd },
      $or: [{ endDate: { $gte: monthStart } }, { endDate: null }],
    }).lean(),
  ]);

  const attendanceByDate = {};
  for (const rec of attendanceRecords) {
    attendanceByDate[toDateOnlyString(rec.date)] = rec;
  }

  const holidayByDate = {};
  for (const h of holidays) {
    const start = new Date(Math.max(new Date(h.startDate), monthStart));
    const end = new Date(Math.min(new Date(h.endDate || h.startDate), monthEnd));
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      holidayByDate[toDateOnlyString(d)] = h.name;
    }
  }

  const records = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const dateKey = toDateOnlyString(date);
    const dow = date.getUTCDay();
    const attendance = attendanceByDate[dateKey];

    let status;
    let holidayName;

    if (holidayByDate[dateKey]) {
      status = "holiday";
      holidayName = holidayByDate[dateKey];
    } else if (dow === 0) {
      status = "holiday";
      holidayName = "Sunday";
    } else if (dow === 6) {
      const { isHoliday, occurrence } = await SaturdayHolidayRule.isSaturdayHoliday(date);
      if (isHoliday) {
        status = "holiday";
        holidayName = `${ORDINAL[occurrence]} Saturday`;
      }
    }

    if (!status && attendance) {
      status = attendance.attendanceType; // present / half-day / absent etc.
    }

    records.push({
      date: dateKey,
      status,          // undefined = no record yet (future/unmarked day)
      holidayName,
      loginTime: attendance?.loginTime || null,
      logoutTime: attendance?.logoutTime || null,
    });
  }

  res.json({ success: true, year, month, records });
});
const guardAgainstHolidayOrSunday = async (date) => {
  const d = new Date(date);
  if (d.getUTCDay() === 0) {
    throw new ApiError(400, "Cannot record attendance on Sunday");
  }

  const { isHoliday, holiday } = await Holiday.isHoliday(d);
  if (isHoliday) {
    throw new ApiError(400, `Cannot record attendance on holiday: ${holiday.name}`);
  }

  if (d.getUTCDay() === 6) {
    const { isHoliday: isSaturdayHoliday, occurrence } = await SaturdayHolidayRule.isSaturdayHoliday(d);
    if (isSaturdayHoliday) {
      throw new ApiError(
        400,
        `Cannot record attendance on holiday: ${ORDINAL[occurrence]} Saturday`,
      );
    }
  }
};

// The `date` field is the "YYYY-MM-DD" IST calendar day (see Attendance
// model), not the UTC calendar day. Using UTC here would shift any login
// between 00:00–05:29 IST back onto the previous day, since that window is
// still the previous UTC day (IST = UTC+5:30). getDateStringIST is the same
// IST-aware helper used across leave/sign-in so both stay consistent.
const normalizedDateOf = (loginTime) => getDateStringIST(loginTime);

/** GET / — list attendance, paginated, with optional filters. */
export const getAllAttendance = asyncHandler(async (req, res) => {
  const { userId, from, to, page = 1, limit = 50 } = req.query;

  const filter = {};
  if (userId) {
    assertValidUserId(userId);
    filter.userId = userId;
  }
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = getDayRange(from).start;
    if (to) filter.date.$lte = getDayRange(to).end;
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

  const [records, total] = await Promise.all([
    Attendance.find(filter)
      .sort({ loginTime: -1 })
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Attendance.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: records.length,
    total,
    page: pageNum,
    totalPages: Math.ceil(total / pageSize),
    records,
  });
});

/** GET /today — all attendance for the current calendar day (UTC). */
export const getTodayAttendance = asyncHandler(async (req, res) => {
  const { start, end } = getDayRange(new Date());
  const records = await Attendance.find({ loginTime: { $gte: start, $lte: end } })
    .sort({ loginTime: -1 })
    .lean();
  res.json({ success: true, count: records.length, records });
});

/** GET /yesterday — all attendance for the previous calendar day (UTC). */
export const getYesterdayAttendance = asyncHandler(async (req, res) => {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const { start, end } = getDayRange(yesterday);
  const records = await Attendance.find({ loginTime: { $gte: start, $lte: end } })
    .sort({ loginTime: -1 })
    .lean();
  res.json({ success: true, count: records.length, records });
});

/** GET /:id — single attendance record. */
export const getAttendanceById = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const record = await Attendance.findById(req.params.id).lean();
  if (!record) throw new ApiError(404, "Attendance record not found");
  res.json({ success: true, record });
});

/** POST / — record attendance for a user on a given day (admin-entered). */
export const recordAttendance = asyncHandler(async (req, res) => {
  const { userId, loginTime, logoutTime, workingHoursPerDay } = req.body;
  assertValidUserId(userId);

  const loginDT = new Date(loginTime);
  const logoutDT = new Date(logoutTime);
  if (Number.isNaN(loginDT.getTime()) || Number.isNaN(logoutDT.getTime())) {
    throw new ApiError(400, "loginTime and logoutTime must be valid dates");
  }
  if (logoutDT <= loginDT) {
    throw new ApiError(400, "Logout time must be after login time");
  }

  await assertStaffCanMarkAttendance(userId, loginDT);
  await guardAgainstHolidayOrSunday(loginDT);

  const date = normalizedDateOf(loginDT);
  const totalMinutesWorked = Math.floor((logoutDT - loginDT) / 60000);
  const { type: attendanceType } = classifyAttendance(totalMinutesWorked);

  let attendance;
  try {
    attendance = await Attendance.create({
      userId,
      date,
      loginTime: loginDT,
      logoutTime: logoutDT,
      workingHoursPerDay: workingHoursPerDay || 8,
      attendanceType,
      source: "manual",
      recordedBy: req.user?.id,
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(
        409,
        `Attendance already recorded for this user on ${toDateOnlyString(loginDT)}`,
      );
    }
    throw err;
  }

  await logActivity(req, {
    action: "CREATE",
    tableName: "attendance",
    recordId: attendance._id,
    description: `${attendanceType} day attendance recorded for user ${userId} on ${toDateOnlyString(loginDT)}`,
  });

  res.status(201).json({
    success: true,
    message: "Attendance recorded successfully",
    attendance,
  });
});

/** PUT /:id — admin correction of an existing record. */
export const updateAttendance = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const { loginTime, logoutTime, workingHoursPerDay, remarks } = req.body;

  const previous = await Attendance.findById(req.params.id);
  if (!previous) throw new ApiError(404, "Attendance record not found");

  const loginDT = loginTime ? new Date(loginTime) : previous.loginTime;
  const logoutDT = logoutTime ? new Date(logoutTime) : previous.logoutTime;

  if (logoutDT && logoutDT <= loginDT) {
    throw new ApiError(400, "Logout time must be after login time");
  }

  previous.loginTime = loginDT;
  previous.logoutTime = logoutDT;
  previous.date = normalizedDateOf(loginDT);
  if (workingHoursPerDay) previous.workingHoursPerDay = workingHoursPerDay;
  if (remarks !== undefined) previous.remarks = remarks;
  previous.updatedBy = req.user?.id;

  if (logoutDT) {
    const totalMinutesWorked = Math.floor((logoutDT - loginDT) / 60000);
    previous.attendanceType = classifyAttendance(totalMinutesWorked).type;
  }

  let updated;
  try {
    updated = await previous.save();
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, "Another attendance record already exists for that user/date");
    }
    throw err;
  }

  await logActivity(req, {
    action: "UPDATE",
    tableName: "attendance",
    recordId: updated._id,
    description: `Attendance updated for user ${updated.userId} on ${toDateOnlyString(updated.loginTime)}`,
  });

  res.json({ success: true, message: "Attendance record updated successfully", attendance: updated });
});

/** DELETE /:id */
export const deleteAttendance = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const record = await Attendance.findByIdAndDelete(req.params.id);
  if (!record) throw new ApiError(404, "Attendance record not found");

  await logActivity(req, {
    action: "DELETE",
    tableName: "attendance",
    recordId: record._id,
    description: `Attendance deleted for user ${record.userId} on ${toDateOnlyString(record.loginTime)}`,
  });

  res.json({ success: true, message: "Attendance record deleted successfully" });
});

/** POST /import — bulk import from parsed Excel/CSV rows. */
export const importAttendance = asyncHandler(async (req, res) => {
  const rows = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(400, "No attendance data provided");
  }
  if (rows.length > 1000) {
    throw new ApiError(400, "Cannot import more than 1000 records at once");
  }

  const results = { success: 0, failed: 0, errors: [] };

  for (const [index, row] of rows.entries()) {
    const rowNum = index + 1;
    try {
      const { userId, loginTime, logoutTime, workingHoursPerDay } = row;
      if (!userId || !loginTime || !logoutTime) {
        results.failed++;
        results.errors.push(`Row ${rowNum}: userId, loginTime, logoutTime are required`);
        continue;
      }
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        results.failed++;
        results.errors.push(`Row ${rowNum}: invalid userId`);
        continue;
      }

      const loginDT = new Date(loginTime);
      const logoutDT = new Date(logoutTime);
      if (Number.isNaN(loginDT.getTime()) || Number.isNaN(logoutDT.getTime())) {
        results.failed++;
        results.errors.push(`Row ${rowNum}: invalid date format`);
        continue;
      }
      if (logoutDT <= loginDT) {
        results.failed++;
        results.errors.push(`Row ${rowNum}: logout must be after login`);
        continue;
      }

      try {
        await assertStaffCanMarkAttendance(userId, loginDT);
      } catch (windowErr) {
        results.failed++;
        results.errors.push(`Row ${rowNum}: ${windowErr.message}`);
        continue;
      }

      try {
        await guardAgainstHolidayOrSunday(loginDT);
      } catch (holidayErr) {
        results.failed++;
        results.errors.push(`Row ${rowNum}: ${holidayErr.message}`);
        continue;
      }

      const totalMinutesWorked = Math.floor((logoutDT - loginDT) / 60000);
      const { type: attendanceType } = classifyAttendance(totalMinutesWorked);

      await Attendance.create({
        userId,
        date: normalizedDateOf(loginDT),
        loginTime: loginDT,
        logoutTime: logoutDT,
        workingHoursPerDay: workingHoursPerDay || 8,
        attendanceType,
        source: "import",
        recordedBy: req.user?.id,
      });

      results.success++;
    } catch (err) {
      results.failed++;
      if (err.code === 11000) {
        results.errors.push(`Row ${rowNum}: attendance already exists for this user/date`);
      } else {
        results.errors.push(`Row ${rowNum}: ${err.message}`);
      }
    }
  }

  if (results.success > 0) {
    await logActivity(req, {
      action: "IMPORT",
      tableName: "attendance",
      description: `Imported ${results.success} attendance record(s), ${results.failed} failed`,
    });
  }

  res.json({
    success: results.success > 0,
    message: `${results.success} imported, ${results.failed} failed`,
    ...results,
  });
});

/** GET /summary/:userId — extra-hours summary for one user. */
export const getAttendanceSummary = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  assertValidUserId(userId);

  const records = await Attendance.find({
    userId,
    logoutTime: { $exists: true },
    isLeaveDay: { $ne: true },
  })
    .sort({ loginTime: -1 })
    .lean();

  let totalExtraMinutes = 0;
  let totalWorkedMinutes = 0;

  for (const rec of records) {
    totalWorkedMinutes += rec.totalMinutesWorked || 0;
    totalExtraMinutes += rec.extraHoursInMinutes || 0;
  }

  res.json({
    success: true,
    summary: {
      userId,
      totalRecords: records.length,
      totalWorkedHours: parseFloat((totalWorkedMinutes / 60).toFixed(2)),
      totalExtraHours: parseFloat((totalExtraMinutes / 60).toFixed(2)),
      leaveDaysAvailable: Math.floor(totalExtraMinutes / 480),
    },
  });
});