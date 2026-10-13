import LeavePolicy from "../models/LeavePolicy.js";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import { asyncHandler, ApiError } from "../utils/asyncHandler.js";
import { computeLeaveBalances } from "../services/leaveBalance.js";

// The Leave page shows leave EARNED MONTH BY MONTH from the staff member's
// confirmation date (same numbers as the attendance calendar's balance line):
//   - accrual runs from the confirmation month up to TODAY (IST), e.g.
//     confirmed 01 Jun 2026, viewed 29 Sep 2026 -> Jun, Jul, Aug, Sep = 4
//     months -> Paid 6, Sick 2, Casual 2 (policy 18 / 6 / 6). It is NOT the
//     whole year's allowance any more.
//   - "taken" still includes every approved leave of the year, even ones
//     dated after today, so days that are already booked are never offered
//     as "remaining" (options.takenThroughYearEnd).
//   - Paid carries forward year to year; Sick + Casual restart each year.
const BALANCE_OPTIONS = { takenThroughYearEnd: true };
const monthWiseAsOf = () => new Date();
import { cleanupAutoLeavesInUntrackedMonths } from "../services/leaveAutomation.js";

// Resolves the Attendance-side User._id for a staff member (Attendance is
// keyed by User, Leave/Staff balances are keyed by Staff._id) and, while
// we're there, clears out any stale auto-generated "unpaid absence" Leave
// left over from a month that turned out to have zero real attendance
// tracked — see cleanupAutoLeavesInUntrackedMonths. Doing this inline here
// (rather than only in the daily /reconcile-absences job) means a staff
// member's displayed balance self-corrects the moment their page is
// loaded, instead of staying wrong until an admin remembers to run the
// reconciliation endpoint by hand.
const resolveAttendanceUserAndClean = async (staff) => {
  const user = staff.email
    ? await User.findOne({ email: staff.email.toLowerCase() }).select("_id").lean()
    : null;
  const attendanceUserId = user?._id || null;
  await cleanupAutoLeavesInUntrackedMonths(staff, attendanceUserId);
  return attendanceUserId;
};

// GET /api/hrm/leave-policy
// Return the org-wide leave allowances (creating defaults on first access).
export const getLeavePolicy = asyncHandler(async (req, res) => {
  const policy = await LeavePolicy.getSingleton();
  res.json({
    success: true,
    data: {
      paidPerYear: policy.paidPerYear,
      sickPerYear: policy.sickPerYear,
      casualPerYear: policy.casualPerYear,
      advancePaidLimit: policy.advancePaidLimit,
      updatedAt: policy.updatedAt,
    },
  });
});

// PUT /api/hrm/leave-policy  (admin only)
// Update how many paid / sick / casual days staff get per year.
export const updateLeavePolicy = asyncHandler(async (req, res) => {
  const { paidPerYear, sickPerYear, casualPerYear, advancePaidLimit } = req.body;

  const parseCount = (val, label) => {
    if (val === undefined) return undefined;
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) {
      throw new ApiError(400, `${label} must be a number >= 0`);
    }
    // Keep decimals (e.g. 18 = 1.5/month, 7.5 = 0.625/month) instead of
    // silently flooring them away.
    return Math.round(n * 100) / 100;
  };

  const paid = parseCount(paidPerYear, "Paid leave per year");
  const sick = parseCount(sickPerYear, "Sick leave per year");
  const casual = parseCount(casualPerYear, "Casual leave per year");
  const advance = parseCount(advancePaidLimit, "Advance paid leave limit");

  const policy = await LeavePolicy.getSingleton();
  if (paid !== undefined) policy.paidPerYear = paid;
  if (sick !== undefined) policy.sickPerYear = sick;
  if (casual !== undefined) policy.casualPerYear = casual;
  if (advance !== undefined) policy.advancePaidLimit = advance;
  policy.updatedBy = req.user?._id || null;
  await policy.save();

  res.json({
    success: true,
    message: "Leave policy updated",
    data: {
      paidPerYear: policy.paidPerYear,
      sickPerYear: policy.sickPerYear,
      casualPerYear: policy.casualPerYear,
      advancePaidLimit: policy.advancePaidLimit,
      updatedAt: policy.updatedAt,
    },
  });
});

// GET /api/hrm/leave-policy/balances  (admin only)
// One row per active staff member: paid (with carry-forward), sick and casual
// allotted / taken / remaining for the current calendar year.
// A staff member who has been marked "Relieved" with a relieving date that
// has already passed has left the organization — they should drop off this
// list even if `enabled` was never separately toggled off for them (the two
// fields are set independently elsewhere in the app). Mirrors the same rule
// authController uses to block a relieved staff member's login.
const isRelievedAsOf = (staff, asOf) => {
  if (staff.status !== "Relieved" || !staff.relievingDate) return false;
  const relievingDate = new Date(staff.relievingDate);
  relievingDate.setHours(0, 0, 0, 0);
  return relievingDate <= asOf;
};

export const getAllStaffLeaveBalances = asyncHandler(async (req, res) => {
  const policy = await LeavePolicy.getSingleton();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const staffList = (
    await Staff.find({ enabled: { $ne: false } })
      .sort({ staffName: 1 })
      .lean()
  ).filter((s) => !isRelievedAsOf(s, today));

  const data = await Promise.all(
    staffList.map(async (staff) => {
      await resolveAttendanceUserAndClean(staff);
      const balances = await computeLeaveBalances(
        staff._id,
        staff.confirmationDate ?? null,
        policy,
        monthWiseAsOf(),
        staff.status === "Relieved" ? staff.relievingDate : null,
        BALANCE_OPTIONS,
      );
      return {
        staffId: staff._id,
        staffName: staff.staffName,
        email: staff.email || "",
        joiningDate: staff.date || null,
        confirmationDate: staff.confirmationDate || null,
        status: staff.status || "",
        ...balances,
      };
    }),
  );

  res.json({ success: true, data });
});

// GET /api/hrm/leave-policy/balances/me
// The logged-in staff member's own balances. Resolves their Staff record by
// the email on their login account.
export const getMyLeaveBalance = asyncHandler(async (req, res) => {
  const email = req.user?.email;
  if (!email) throw new ApiError(400, "No email on the current account");

  const staff = await Staff.findOne({
    email: email.toLowerCase().trim(),
  }).lean();
  if (!staff) {
    throw new ApiError(404, "No staff record linked to this account");
  }

  const policy = await LeavePolicy.getSingleton();
  await resolveAttendanceUserAndClean(staff);
  const balances = await computeLeaveBalances(
    staff._id,
    staff.confirmationDate ?? null,
    policy,
    monthWiseAsOf(),
    staff.status === "Relieved" ? staff.relievingDate : null,
    { ...BALANCE_OPTIONS, includeMonthly: true },
  );
  res.json({
    success: true,
    data: {
      staffId: staff._id,
      staffName: staff.staffName,
      joiningDate: staff.date || null,
      confirmationDate: staff.confirmationDate || null,
      ...balances,
    },
  });
});

// GET /api/hrm/leave-policy/balances/staff/:staffId  (admin only)
// One staff member's balances WITH the month-by-month statement
// (earned / taken / balance for every month since the confirmation month).
export const getStaffLeaveBalanceMonthly = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.staffId).lean();
  if (!staff) throw new ApiError(404, "Staff member not found");

  const policy = await LeavePolicy.getSingleton();
  await resolveAttendanceUserAndClean(staff);
  const balances = await computeLeaveBalances(
    staff._id,
    staff.confirmationDate ?? null,
    policy,
    monthWiseAsOf(),
    staff.status === "Relieved" ? staff.relievingDate : null,
    { ...BALANCE_OPTIONS, includeMonthly: true },
  );
  res.json({
    success: true,
    data: {
      staffId: staff._id,
      staffName: staff.staffName,
      email: staff.email || "",
      joiningDate: staff.date || null,
      confirmationDate: staff.confirmationDate || null,
      status: staff.status || "",
      ...balances,
    },
  });
});
