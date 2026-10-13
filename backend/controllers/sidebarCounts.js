// controllers/sidebarCounts.js
//
// One lightweight endpoint that feeds the little notification badges on the
// sidebar (web) so the client doesn't have to download whole lists just to
// show a number:
//
//   holidays            -> declared holidays that fall in the CURRENT month
//                          (everyone). Saturday-holiday rules and Sundays are
//                          NOT counted - they are not "declared" holidays.
//   pendingResignations -> resignation requests nobody has acted on yet
//                          (admin / super admin with the Resignations tab).
//   presentToday        -> staff who are present today (attendance tab).
//
// A value of `null` means "this role doesn't get that badge".
import Holiday from "../models/holiday.js";
import Resignation from "../models/Resignation.js";
import Attendance from "../models/Attendance.js";
import Staff from "../models/Staff.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { hasTabAccess, isAdminRole } from "../config/permissions.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, "0");

// An auto-generated "Saturday" / "Sunday" style entry (e.g. one imported
// from a sheet) must never inflate the holiday count. Real named holidays
// ("Diwali", "Republic Day", ...) are unaffected.
const WEEKEND_NAME_RE = /^\s*(?:\d+(?:st|nd|rd|th)\s+)?(?:saturday|sunday)(?:\s+holiday)?\s*$/i;

/** Current IST calendar parts + the IST-day / IST-month boundaries as real instants. */
const istNow = () => {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth(); // 0-11
  const d = ist.getUTCDate();
  return {
    todayStr: `${y}-${pad(m + 1)}-${pad(d)}`,
    monthStr: `${y}-${pad(m + 1)}`,
    monthStart: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS),
    monthEnd: new Date(Date.UTC(y, m + 1, 1) - IST_OFFSET_MS - 1),
    dayStart: new Date(Date.UTC(y, m, d) - IST_OFFSET_MS),
    dayEnd: new Date(Date.UTC(y, m, d + 1) - IST_OFFSET_MS - 1),
  };
};

async function countHolidaysThisMonth(user, { monthStart, monthEnd }) {
  // Staff only: ignore holidays that were already over before they joined
  // (same rule the Holidays page applies).
  let joiningDate = null;
  if (!isAdminRole(user.role) && user.email) {
    const staff = await Staff.findOne({ email: user.email.toLowerCase().trim() })
      .select("date")
      .lean();
    joiningDate = staff?.date ? new Date(staff.date) : null;
  }

  const holidays = await Holiday.find({
    enabled: true,
    startDate: { $lte: monthEnd },
    endDate: { $gte: monthStart },
  })
    .select("name startDate endDate")
    .lean();

  return holidays.filter((h) => {
    if (WEEKEND_NAME_RE.test(h.name || "")) return false;
    if (joiningDate && h.endDate && new Date(h.endDate) < joiningDate) return false;
    return true;
  }).length;
}

async function countPresentToday({ todayStr, dayStart, dayEnd }) {
  const ids = await Attendance.distinct("userId", {
    $or: [
      { date: todayStr },
      // Older / imported rows may have no `date` string - fall back to loginTime.
      { date: { $exists: false }, loginTime: { $gte: dayStart, $lte: dayEnd } },
    ],
    isLeaveDay: { $ne: true },
    attendanceType: { $ne: "absent" },
    status: { $ne: "absent" },
  });
  return ids.length;
}

/** GET /api/hrm/sidebar-counts */
export const getSidebarCounts = asyncHandler(async (req, res) => {
  const user = req.user;
  const admin = isAdminRole(user.role);
  const range = istNow();

  const [holidays, pendingResignations, presentToday] = await Promise.all([
    countHolidaysThisMonth(user, range),
    admin && hasTabAccess(user, "resignations")
      ? Resignation.countDocuments({ status: "pending" })
      : null,
    // Admins need the attendance tab; plain staff just get the aggregate
    // number (no names) for their own "Attendance" entry.
    !admin || hasTabAccess(user, "attendance") ? countPresentToday(range) : null,
  ]);

  // Always fresh - this is a live "notification" number.
  res.set("Cache-Control", "no-store");
  res.json({
    success: true,
    data: {
      month: range.monthStr,
      today: range.todayStr,
      holidays,
      pendingResignations,
      presentToday,
    },
  });
});
