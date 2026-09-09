import Payroll from "../models/Payroll.js";
import Staff from "../models/Staff.js";
import StaffBasicPayroll from "../models/StaffBasicPayroll.js";
import StaffAdvance from "../models/StaffAdvance.js";
import Attendance from "../models/Attendance.js";
import Leave from "../models/Leave.js";
import User from "../models/User.js";

export class PayrollService {
  static async calculateSalary(employeeId, period, session = null) {
    const employee = await Staff.findById(employeeId).session(session);
    if (!employee) throw new Error("Employee not found");

    const basicPayroll = await StaffBasicPayroll.findOne({ employeeId }).session(session);
    if (!basicPayroll) throw new Error("Basic payroll not found");

    const fullBasicSalary = parseFloat(basicPayroll.currentBasicSalary || 0);
    const [year, month] = period.split("-").map(Number);
    const totalDaysInMonth = new Date(year, month, 0).getDate();
    const perDaySalary = fullBasicSalary / totalDaysInMonth;

    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0);

    // If this staff member's last working day falls inside (or before) this
    // period, only pay through that date instead of the full month.
    let payableDays = totalDaysInMonth;
    let effectivePeriodEnd = periodEnd;
    if (employee.relievingDate) {
      const relievingDate = new Date(employee.relievingDate);
      if (relievingDate < periodStart) {
        payableDays = 0;
      } else if (relievingDate <= periodEnd) {
        payableDays = relievingDate.getDate();
        effectivePeriodEnd = relievingDate;
      }
    }

    // Get unpaid leaves (only up through the last payable day)
    const startDate = periodStart;
    const endDate = effectivePeriodEnd < periodEnd ? effectivePeriodEnd : periodEnd;
    const leaves =
      payableDays > 0
        ? await Leave.find({
            userId: employeeId,
            leaveDate: { $gte: startDate, $lte: endDate },
            status: "approved",
            leaveType: "unpaid",
          }).session(session)
        : [];

    // Attendance.userId points at the login User account, not the Staff
    // doc, so absent/half-day marks recorded there wouldn't be found by
    // filtering on employeeId directly — resolve the linked User first.
    const dateKey = (d) => {
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    };

    // Previously, payroll only looked at approved unpaid Leave records and
    // ignored the Attendance collection entirely — a day marked "absent" or
    // "half day" via attendance (self-service, admin entry, or Excel import)
    // never reduced pay unless someone *also* filed a matching Leave record.
    // Now: merge unpaid-leave days with Attendance absent/half-day marks by
    // calendar date so each day is deducted once, using whichever source
    // has a stronger claim on it (a Leave record — explicit reason/approval
    // — takes precedence over a same-day Attendance mark).
    const deductionByDate = new Map();
    // Use the leave's actual dayValue (0.5 for a half-day unpaid leave)
    // instead of always charging a full day — `?? 1` covers records saved
    // before dayValue existed.
    leaves.forEach((l) =>
      deductionByDate.set(dateKey(l.leaveDate), l.dayValue ?? 1),
    );

    if (payableDays > 0) {
      const staffUser = await User.findOne({ email: employee.email })
        .select("_id")
        .session(session);
      if (staffUser) {
        const attendanceRecords = await Attendance.find({
          userId: staffUser._id,
          loginTime: { $gte: startDate, $lte: endDate },
          $or: [{ status: "absent" }, { attendanceType: "half" }],
        }).session(session);

        attendanceRecords.forEach((rec) => {
          const key = rec.date || dateKey(rec.loginTime);
          if (deductionByDate.has(key)) return; // Leave record already covers this day
          if (rec.status === "absent") deductionByDate.set(key, 1);
          else if (rec.attendanceType === "half") deductionByDate.set(key, 0.5);
        });
      }
    }

    const unpaidLeaveDays = [...deductionByDate.values()].reduce(
      (sum, d) => sum + d,
      0,
    );
    const leaveDeduction = unpaidLeaveDays * perDaySalary;
    const effectiveDays = Math.max(0, payableDays - unpaidLeaveDays);
    const netSalary = Math.max(0, perDaySalary * effectiveDays);

    // Get pending advances
    const advances = await StaffAdvance.aggregate([
      { $match: { employeeId: employeeId, status: "pending" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]).session(session);

    const advanceDeduction = advances[0]?.total || 0;
    const finalSalary = Math.max(0, netSalary - advanceDeduction);

    return {
      employee,
      basicSalary: fullBasicSalary,
      perDaySalary,
      totalDaysInMonth,
      payableDays,
      unpaidLeaveDays,
      leaveDeduction,
      effectiveDays,
      netSalary,
      advanceDeduction,
      finalSalary,
    };
  }

  static async getPayrollAnalytics(startDate, endDate) {
    const match = {};
    if (startDate) match.createdAt = { $gte: new Date(startDate) };
    if (endDate) match.createdAt = { $lte: new Date(endDate) };

    const analytics = await Payroll.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalNetSalary: { $sum: "$netSalary" },
          averageSalary: { $avg: "$netSalary" },
        },
      },
    ]);

    const total = await Payroll.countDocuments(match);
    const totalNetSalary = await Payroll.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: "$netSalary" } } },
    ]);

    return {
      analytics,
      totalRecords: total,
      totalNetSalary: totalNetSalary[0]?.total || 0,
    };
  }
}