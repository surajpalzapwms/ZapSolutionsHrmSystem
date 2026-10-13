// services/staffPurge.js
//
// Deletes a staff member AND everything recorded about them, so nothing is
// left behind once a super admin removes someone from the staff list:
//
//   staff record (incl. its letters) · login account · attendance · leaves ·
//   payroll / salary slips · basic payroll (salary history) · advances ·
//   expenses · resignations · counseling sessions · uploaded documents &
//   photo · birthday wishes (to / from them) · registered presence devices
//
// Some collections store the Staff _id and some store the login (User) _id
// — and a few store either, depending on which screen created the record —
// so every lookup matches BOTH ids. ObjectIds are unique across the whole
// database, so matching on both can never touch someone else's data.
//
// Company-wide settings (holidays, Saturday rules, leave policy, office
// networks…) only remember who last edited them; those are kept.
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import Attendance from "../models/Attendance.js";
import Leave from "../models/Leave.js";
import Payroll from "../models/Payroll.js";
import StaffBasicPayroll from "../models/StaffBasicPayroll.js";
import StaffAdvance from "../models/StaffAdvance.js";
import Expense from "../models/Expense.js";
import Resignation from "../models/Resignation.js";
import Counseling from "../models/Counseling.js";
import StaffDocument from "../models/StaffDocument.js";
import BirthdayWish from "../models/BirthdayWish.js";
import PresenceDevice from "../models/PresenceDevice.js";
import { invalidateResponseCache } from "./responseCache.js";
import { invalidateReportCaches } from "../utils/reportCache.js";

const PROTECTED_ROLES = new Set(["super-admin", "superadmin"]);

/** The staff records plus their linked login accounts. */
const loadTargets = async (staffIds) => {
  const staff = await Staff.find({ _id: { $in: staffIds } }, { email: 1, staffName: 1, staffId: 1 }).lean();
  const emails = staff.map((s) => s.email).filter(Boolean).map((e) => e.toLowerCase().trim());
  const users = emails.length
    ? await User.find({ email: { $in: emails } }, { email: 1, role: 1 }).lean()
    : [];
  return { staff, users };
};

/**
 * What would be deleted — used by the confirmation dialog so the admin can
 * see exactly how much data goes with the staff member(s).
 */
export const previewStaffPurge = async (staffIds) => {
  const { staff, users } = await loadTargets(staffIds);
  const ids = [...staff.map((s) => s._id), ...users.map((u) => u._id)];
  const any = { $in: ids };
  const [attendance, leaves, payrolls, basicPayroll, advances, expenses, resignations, counseling, documents, birthdayWishes, devices] =
    await Promise.all([
      Attendance.countDocuments({ userId: any }),
      Leave.countDocuments({ userId: any }),
      Payroll.countDocuments({ employeeId: any }),
      StaffBasicPayroll.countDocuments({ employeeId: any }),
      StaffAdvance.countDocuments({ employeeId: any }),
      Expense.countDocuments({ employeeId: any }),
      Resignation.countDocuments({ userId: any }),
      Counseling.countDocuments({ userId: any }),
      StaffDocument.countDocuments({ staff: any }),
      BirthdayWish.countDocuments({ $or: [{ staff: any }, { fromStaff: any }, { fromUser: any }] }),
      PresenceDevice.countDocuments({ userId: any }),
    ]);
  return {
    staff: staff.map((s) => ({ _id: s._id, staffName: s.staffName, staffId: s.staffId, email: s.email })),
    counts: {
      loginAccounts: users.filter((u) => !PROTECTED_ROLES.has(u.role)).length,
      attendance,
      leaves,
      payrolls,
      basicPayroll,
      advances,
      expenses,
      resignations,
      counseling,
      documents,
      birthdayWishes,
      devices,
    },
  };
};

/** Deletes the staff member(s) and all their related data. */
export const purgeStaff = async (staffIds) => {
  const { staff, users } = await loadTargets(staffIds);
  if (!staff.length) return { deletedCount: 0, counts: {} };

  const staffObjIds = staff.map((s) => s._id);
  // Never delete a super admin's login, even if a staff row shares the e-mail.
  const userObjIds = users.filter((u) => !PROTECTED_ROLES.has(u.role)).map((u) => u._id);
  const any = { $in: [...staffObjIds, ...users.map((u) => u._id)] };

  const results = await Promise.all([
    Attendance.deleteMany({ userId: any }),
    Leave.deleteMany({ userId: any }),
    Payroll.deleteMany({ employeeId: any }),
    StaffBasicPayroll.deleteMany({ employeeId: any }),
    StaffAdvance.deleteMany({ employeeId: any }),
    Expense.deleteMany({ employeeId: any }),
    Resignation.deleteMany({ userId: any }),
    Counseling.deleteMany({ userId: any }),
    StaffDocument.deleteMany({ staff: any }),
    BirthdayWish.deleteMany({ $or: [{ staff: any }, { fromStaff: any }, { fromUser: any }] }),
    PresenceDevice.deleteMany({ userId: any }),
  ]);
  const keys = ["attendance", "leaves", "payrolls", "basicPayroll", "advances", "expenses", "resignations", "counseling", "documents", "birthdayWishes", "devices"];
  const counts = Object.fromEntries(keys.map((k, i) => [k, results[i]?.deletedCount || 0]));

  const loginResult = userObjIds.length ? await User.deleteMany({ _id: { $in: userObjIds } }) : { deletedCount: 0 };
  counts.loginAccounts = loginResult.deletedCount || 0;

  // Staff last, so a failure above leaves the staff row in place to retry.
  const staffResult = await Staff.deleteMany({ _id: { $in: staffObjIds } });

  try {
    invalidateResponseCache();
    invalidateReportCaches(""); // "" = every cached report
  } catch {
    /* caches are best-effort */
  }
  return { deletedCount: staffResult.deletedCount || 0, counts };
};
