import LeavePolicy from "../models/LeavePolicy.js";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import { asyncHandler, ApiError } from "../utils/asyncHandler.js";
import { computeLeaveBalances } from "../services/leaveBalance.js";
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
      updatedAt: policy.updatedAt,
    },
  });
});

// PUT /api/hrm/leave-policy  (admin only)
// Update how many paid / sick / casual days staff get per year.
export const updateLeavePolicy = asyncHandler(async (req, res) => {
  const { paidPerYear, sickPerYear, casualPerYear } = req.body;

  const parseCount = (val, label) => {
    if (val === undefined) return undefined;
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) {
      throw new ApiError(400, `${label} must be a number >= 0`);
    }
    return Math.floor(n);
  };

  const paid = parseCount(paidPerYear, "Paid leave per year");
  const sick = parseCount(sickPerYear, "Sick leave per year");
  const casual = parseCount(casualPerYear, "Casual leave per year");

  const policy = await LeavePolicy.getSingleton();
  if (paid !== undefined) policy.paidPerYear = paid;
  if (sick !== undefined) policy.sickPerYear = sick;
  if (casual !== undefined) policy.casualPerYear = casual;
  policy.updatedBy = req.user?._id || null;
  await policy.save();

  res.json({
    success: true,
    message: "Leave policy updated",
    data: {
      paidPerYear: policy.paidPerYear,
      sickPerYear: policy.sickPerYear,
      casualPerYear: policy.casualPerYear,
      updatedAt: policy.updatedAt,
    },
  });
});

// GET /api/hrm/leave-policy/balances  (admin only)
// One row per active staff member: paid (with carry-forward), sick and casual
// allotted / taken / remaining for the current calendar year.
export const getAllStaffLeaveBalances = asyncHandler(async (req, res) => {
  const policy = await LeavePolicy.getSingleton();
  const staffList = await Staff.find({ enabled: { $ne: false } })
    .sort({ staffName: 1 })
    .lean();

  const data = await Promise.all(
    staffList.map(async (staff) => {
      await resolveAttendanceUserAndClean(staff);
      const balances = await computeLeaveBalances(
        staff._id,
        staff.date,
        policy,
        new Date(),
        staff.status === "Relieving" ? staff.relievingDate : null,
      );
      return {
        staffId: staff._id,
        staffName: staff.staffName,
        email: staff.email || "",
        joiningDate: staff.date || null,
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
    staff.date,
    policy,
    new Date(),
    staff.status === "Relieving" ? staff.relievingDate : null,
  );
  res.json({
    success: true,
    data: {
      staffId: staff._id,
      staffName: staff.staffName,
      joiningDate: staff.date || null,
      ...balances,
    },
  });
});