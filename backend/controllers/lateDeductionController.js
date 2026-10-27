// controllers/lateDeductionController.js
//
// Late-coming deduction controls (see services/lateDeduction.js).
//
//   GET  /api/hrm/late-deduction/:staffId/:period   — admin: month summary
//   PUT  /api/hrm/late-deduction/month              — SUPER ADMIN: deduct / don't deduct for a whole month
//   PUT  /api/hrm/late-deduction/day                — SUPER ADMIN: deduct / waive one date
//   PUT  /api/hrm/late-deduction/lunch              — SUPER ADMIN: lunch not taken / lunch minutes taken for one date
//
// After any change the still-pending payroll for that month (if one was
// already generated) is recalculated, so the saved salary follows.
import mongoose from "mongoose";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import Attendance from "../models/Attendance.js";
import LateDeductionSetting from "../models/LateDeductionSetting.js";
import { attendanceDayKey } from "../services/leave.js";
import {
  calculateSalary,
  refreshPendingPayrollForPeriod,
} from "./payrollController.js";

const PERIOD_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

const findStaff = async (staffId) => {
  if (!staffId || !mongoose.Types.ObjectId.isValid(staffId)) return null;
  return Staff.findById(staffId).select("_id staffName email").lean();
};

const refreshPayroll = async (staffId, period) => {
  try {
    await refreshPendingPayrollForPeriod(staffId, period);
  } catch (err) {
    // The calendar/preview always recalculate live, so this is best effort.
    console.error("Late deduction: pending payroll refresh failed:", err.message);
  }
};

/**
 * Attendance ids of one staff member on one IST date (YYYY-MM-DD).
 * Returns { ids } or { error: [status, message] }.
 */
const findAttendanceIdsForDate = async (staff, date) => {
  if (!staff.email) return { error: [400, "This staff member has no linked login account"] };
  const user = await User.findOne({ email: staff.email.toLowerCase() }).select("_id").lean();
  if (!user) return { error: [400, "This staff member has no linked login account"] };

  // Same IST day key the calendar uses; padded query then exact match.
  const [y, m, d] = date.split("-").map(Number);
  const dayStart = Date.UTC(y, m - 1, d);
  const candidates = await Attendance.find({
    userId: user._id,
    isLeaveDay: { $ne: true },
    loginTime: {
      $gte: new Date(dayStart - 86400000),
      $lte: new Date(dayStart + 2 * 86400000),
    },
  })
    .select("_id date loginTime")
    .lean();
  const ids = candidates.filter((r) => attendanceDayKey(r) === date).map((r) => r._id);
  if (ids.length === 0) return { error: [404, `No attendance found on ${date}`] };
  return { ids };
};

/** GET /:staffId/:period — month summary (uses the exact payroll calculation). */
export const getLateSummary = async (req, res) => {
  try {
    const { staffId, period } = req.params;
    if (!PERIOD_RE.test(period || "")) return fail(res, 400, "period must be YYYY-MM");
    const staff = await findStaff(staffId);
    if (!staff) return fail(res, 404, "Staff not found");

    const salary = await calculateSalary(staffId, period, null);
    res.json({
      success: true,
      data: {
        staffId,
        period,
        lateDeduction: salary.lateDeduction,
        lateDeductionEnabled: salary.lateDeductionEnabled,
        summary: salary.lateSummary,
      },
    });
  } catch (error) {
    fail(res, 400, error.message || "Failed to load late-coming summary");
  }
};

/** PUT /month  body: { staffId, period: "YYYY-MM", deductLate: boolean } */
export const setMonthLateDeduction = async (req, res) => {
  try {
    const { staffId, period, deductLate } = req.body || {};
    if (!PERIOD_RE.test(period || "")) return fail(res, 400, "period must be YYYY-MM");
    if (typeof deductLate !== "boolean") return fail(res, 400, "deductLate must be true or false");
    const staff = await findStaff(staffId);
    if (!staff) return fail(res, 404, "Staff not found");

    const setting = await LateDeductionSetting.findOneAndUpdate(
      { employeeId: staff._id, period },
      { $set: { deductLate, updatedBy: req.user?.id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await refreshPayroll(staffId, period);

    res.json({
      success: true,
      message: deductLate
        ? `Late coming WILL be deducted for ${staff.staffName} in ${period}`
        : `Late coming will NOT be deducted for ${staff.staffName} in ${period}`,
      data: setting,
    });
  } catch (error) {
    fail(res, 500, error.message || "Failed to update late-coming setting");
  }
};

/** PUT /day  body: { staffId, date: "YYYY-MM-DD", waived: boolean } */
export const setDayLateDeduction = async (req, res) => {
  try {
    const { staffId, date, waived } = req.body || {};
    if (!DATE_RE.test(date || "")) return fail(res, 400, "date must be YYYY-MM-DD");
    if (typeof waived !== "boolean") return fail(res, 400, "waived must be true or false");
    const staff = await findStaff(staffId);
    if (!staff) return fail(res, 404, "Staff not found");
    const found = await findAttendanceIdsForDate(staff, date);
    if (found.error) return fail(res, ...found.error);
    const ids = found.ids;

    await Attendance.updateMany(
      { _id: { $in: ids } },
      waived
        ? {
            $set: {
              lateDeductionWaived: true,
              lateDeductionWaivedBy: req.user?.id,
              lateDeductionWaivedAt: new Date(),
            },
          }
        : {
            $set: { lateDeductionWaived: false },
            $unset: { lateDeductionWaivedBy: "", lateDeductionWaivedAt: "" },
          },
    );

    await refreshPayroll(staffId, date.slice(0, 7));

    res.json({
      success: true,
      message: waived
        ? `Late coming on ${date} will NOT be deducted`
        : `Late coming on ${date} will be deducted`,
    });
  } catch (error) {
    fail(res, 500, error.message || "Failed to update late-coming for this date");
  }
};

/**
 * PUT /lunch
 * body: { staffId, date: "YYYY-MM-DD", lunchSkipped: boolean, lunchTakenMinutes?: number | null }
 *
 *   lunchSkipped: true             → lunch NOT taken; the whole lunch window counts as working time
 *   lunchSkipped: false + minutes  → lunch taken, this many minutes (unused part of 45 min counts as working time)
 *   lunchSkipped: false + null     → nothing recorded (standard lunch, no credit)
 *
 * The lunch time only ever reduces a late-coming deduction that exists
 * (see services/lateDeduction.js).
 */
export const setDayLunch = async (req, res) => {
  try {
    const { staffId, date, lunchSkipped } = req.body || {};
    let { lunchTakenMinutes } = req.body || {};
    if (!DATE_RE.test(date || "")) return fail(res, 400, "date must be YYYY-MM-DD");
    if (typeof lunchSkipped !== "boolean") return fail(res, 400, "lunchSkipped must be true or false");

    if (lunchSkipped || lunchTakenMinutes === null || lunchTakenMinutes === undefined || lunchTakenMinutes === "") {
      lunchTakenMinutes = null;
    } else {
      lunchTakenMinutes = Number(lunchTakenMinutes);
      if (!Number.isInteger(lunchTakenMinutes) || lunchTakenMinutes < 0 || lunchTakenMinutes > 480) {
        return fail(res, 400, "lunchTakenMinutes must be a whole number between 0 and 480");
      }
    }

    const staff = await findStaff(staffId);
    if (!staff) return fail(res, 404, "Staff not found");
    const found = await findAttendanceIdsForDate(staff, date);
    if (found.error) return fail(res, ...found.error);

    await Attendance.updateMany(
      { _id: { $in: found.ids } },
      {
        $set: {
          lunchSkipped,
          lunchTakenMinutes,
          lunchUpdatedBy: req.user?.id,
          lunchUpdatedAt: new Date(),
        },
      },
    );

    await refreshPayroll(staffId, date.slice(0, 7));

    res.json({
      success: true,
      message: lunchSkipped
        ? `Lunch not taken on ${date} — lunch time counted as working time`
        : lunchTakenMinutes === null
          ? `Lunch on ${date} reset to standard`
          : `Lunch on ${date} saved: ${lunchTakenMinutes} min taken`,
    });
  } catch (error) {
    fail(res, 500, error.message || "Failed to update lunch for this date");
  }
};
