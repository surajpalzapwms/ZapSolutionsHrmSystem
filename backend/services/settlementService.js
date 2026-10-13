import mongoose from "mongoose";
import Staff from "../models/Staff.js";
import StaffBasicPayroll from "../models/StaffBasicPayroll.js";
import Payroll from "../models/Payroll.js";
import StaffAdvance from "../models/StaffAdvance.js";
import { buildLeaveEncashmentLedger } from "./leaveEncashment.js";
import { calculateSalary } from "../controllers/payrollController.js";
import { getOrCompute } from "./responseCache.js";

// Runs `fn` over `items` with at most `limit` at a time, keeping order.
const mapWithLimit = async (items, limit, fn) => {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
};

// Month salary for the settlement; null when it can't be calculated (e.g.
// no basic payroll for that month — nothing to pay).
const safeMonthSalary = async (staffId, period) => {
  try {
    return await calculateSalary(staffId, period, null, null);
  } catch {
    return null;
  }
};

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const EPS_DAYS = 0.001;

const periodOf = (d) => {
  const dt = new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
};
const nextPeriod = (period) => {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const periodLabel = (period) => {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

// Resolves the basic salary that was actually in effect on `asOfDate`,
// the same salaryHistory lookup PayrollService.calculateSalary uses, so
// the settlement's "Monthly Salary" always matches what payroll would
// have paid for that period.
const resolveBasicSalaryAsOf = (basicPayroll, asOfDate) => {
  const history = Array.isArray(basicPayroll?.salaryHistory) ? basicPayroll.salaryHistory : [];
  const applicable = history
    .filter((h) => h && h.effectiveFrom && new Date(h.effectiveFrom) <= asOfDate)
    .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom));
  if (applicable.length > 0) return parseFloat(applicable[0].basicSalary || 0);
  return parseFloat(basicPayroll?.currentBasicSalary || 0);
};

// Builds a Full & Final Settlement Statement for a relieved staff member.
//
// HOW IT IS CALCULATED
//   1. Salary still owed, month by month. For every month from the first
//      payroll month (or joining month if payroll was never run) up to the
//      relieving month:
//        earned  = that month's salary exactly as payroll calculates it
//                  (unpaid / absent days deducted, last month only up to
//                  the relieving date) + allowances − deductions on the
//                  saved payroll record, if any
//        settled = what payroll actually paid for that month (paidAmount,
//                  plus any advance recovered from it)
//        pending = earned − settled (never below 0)
//      Leave days already TAKEN were already paid through the normal
//      monthly payroll, so they are not counted again here.
//   2. Leave encashment (Paid Leave only — Sick/Casual are never paid out):
//      leave taken is deducted from Sick + Casual first, then from Paid
//      Leave oldest month first; each month's Paid Leave still left is
//      paid at that month's per-day salary (basic / days in month).
//   3. Less any advance still outstanding.
//
// Example: PL left 1.5 in Jul 2026 (₹26,500, 31 days) and 1.5 in Jun 2026
// (₹15,000, 30 days):
//   Jul 2026 PL   1.5 × 854.84 = 1,282.26
//   Jun 2026 PL   1.5 × 500.00 =   750.00
// Cached wrapper: the settlement is expensive (one full salary calculation
// per month of employment + the leave ledger) and only changes when data
// is written, so reuse the last result until a write clears the cache.
export const computeFinalSettlement = (staffId) =>
  getOrCompute(`settlement:${staffId}`, () =>
    computeFinalSettlementUncached(staffId),
  );

const computeFinalSettlementUncached = async (staffId) => {
  if (!mongoose.Types.ObjectId.isValid(String(staffId))) {
    const err = new Error("Invalid staff ID");
    err.status = 400;
    throw err;
  }
  const staff = await Staff.findById(staffId).lean();
  if (!staff) {
    const err = new Error("Staff not found");
    err.status = 404;
    throw err;
  }
  if (staff.status !== "Relieved" || !staff.relievingDate) {
    const err = new Error(
      "This staff member has not left the organization yet — a final settlement only applies once status is Relieved and a relieving date is set.",
    );
    err.status = 400;
    throw err;
  }

  const relievingDate = new Date(staff.relievingDate);
  relievingDate.setUTCHours(0, 0, 0, 0);
  const relievingPeriod = periodOf(relievingDate);
  const daysInRelievingMonth = new Date(
    Date.UTC(relievingDate.getUTCFullYear(), relievingDate.getUTCMonth() + 1, 0),
  ).getUTCDate();

  // ── Salary rate as of the relieving date ─────────────────────────────
  const basicPayroll = await StaffBasicPayroll.findOne({ employeeId: staffId }).lean();
  const monthlySalary = basicPayroll ? resolveBasicSalaryAsOf(basicPayroll, relievingDate) : 0;
  const perDaySalaryExact = monthlySalary ? monthlySalary / daysInRelievingMonth : 0;
  const perDaySalary = round2(perDaySalaryExact);

  // ── Leave: month-wise earned / taken / encashment ───────────────────
  // See services/leaveEncashment.js. Leave taken is deducted from Sick +
  // Casual first (they are never paid out), then from Paid Leave oldest
  // month first. Only the Paid Leave left over is encashed, each month at
  // THAT month's own per-day salary (basic / days in month).
  const leave = await buildLeaveEncashmentLedger({
    staffId,
    confirmationDate: staff.confirmationDate ?? null,
    asOf: relievingDate,
    relievingDate,
  });
  const paidRemaining = leave.totals.plRemaining;
  const leaveEncashment = leave.totals.encashment;
  const encashedMonths = leave.months
    .filter((m) => m.plRemaining > EPS_DAYS)
    .map((m) => ({
      period: m.period,
      label: m.label,
      days: m.plRemaining,
      perDaySalary: m.perDaySalary,
      amount: m.plAmount,
    }));

  // ── Payroll already run for this staff member ────────────────────────
  const payrollRecords = await Payroll.find({
    employeeId: staffId,
    status: { $ne: "cancelled" },
    enabled: { $ne: false },
    period: { $lte: relievingPeriod },
  })
    .select(
      "period status paidAmount advanceDeduction previousPendingAmount totalAllowance totalDeduction",
    )
    .lean();

  // First month to check: the first month payroll was ever run (months
  // before that were settled outside this system), otherwise the joining
  // month, otherwise the confirmation month, otherwise the relieving month.
  const firstPayrollPeriod = payrollRecords.map((p) => p.period).sort()[0];
  const joinPeriod = staff.date ? periodOf(staff.date) : null;
  const confirmPeriod = staff.confirmationDate ? periodOf(staff.confirmationDate) : null;
  // The statement starts from the CONFIRMATION month (not the joining
  // month). Uses the stored confirmation date, or the effective one the
  // leave rules derive (joining date + probation) when it was never saved.
  const effectiveConfirmPeriod = leave.accrualStartDate
    ? periodOf(leave.accrualStartDate)
    : confirmPeriod;
  let startPeriod =
    effectiveConfirmPeriod || firstPayrollPeriod || joinPeriod || relievingPeriod;
  if (joinPeriod && startPeriod < joinPeriod) startPeriod = joinPeriod;
  if (startPeriod > relievingPeriod) startPeriod = relievingPeriod;

  // What was actually settled for each month. A payroll that also paid off
  // the previous month's pending balance (previousPendingAmount) has that
  // part credited to the previous month, not to its own month.
  const settledByPeriod = new Map();
  const recordByPeriod = new Map();
  const addSettled = (period, amount) =>
    settledByPeriod.set(period, (settledByPeriod.get(period) || 0) + amount);
  const prevPeriodOf = (period) => {
    const [y, m] = period.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  };
  payrollRecords.forEach((p) => {
    const paid = Number(p.paidAmount) || 0;
    const carried = Math.min(paid, Number(p.previousPendingAmount) || 0);
    if (carried > 0) addSettled(prevPeriodOf(p.period), carried);
    const advanceRecovered = paid > 0 ? Number(p.advanceDeduction) || 0 : 0;
    addSettled(p.period, paid - carried + advanceRecovered);
    if (!recordByPeriod.has(p.period)) recordByPeriod.set(p.period, []);
    recordByPeriod.get(p.period).push(p);
  });

  // Salary still pending for a month BEFORE confirmation is not shown in the
  // month-wise table, but must not be lost silently — it is reported
  // separately (and still added to the amount payable).
  const preConfirmationPending = [];
  const earliestPeriod = [firstPayrollPeriod, joinPeriod].filter(Boolean).sort()[0];
  if (earliestPeriod && earliestPeriod < startPeriod) {
    // Only months that actually had a payroll run need a salary calculation
    // (no payroll run -> settled outside the system). Calculate them in
    // parallel instead of one after another.
    const prePeriods = [];
    for (let period = earliestPeriod; period < startPeriod; period = nextPeriod(period)) {
      if ((recordByPeriod.get(period) || []).length) prePeriods.push(period);
    }
    const preSalaries = await mapWithLimit(prePeriods, 4, (period) =>
      safeMonthSalary(staffId, period),
    );
    for (let i = 0; i < prePeriods.length; i++) {
      const period = prePeriods[i];
      const records = recordByPeriod.get(period) || [];
      const salary = preSalaries[i];
      const extras = records.reduce(
        (sum, r) => sum + (Number(r.totalAllowance) || 0) - (Number(r.totalDeduction) || 0),
        0,
      );
      const earned = round2(Math.max(0, (salary?.netSalary || 0) + extras));
      const paid = round2(settledByPeriod.get(period) || 0);
      const pending = round2(Math.max(0, earned - paid));
      if (pending > 0) preConfirmationPending.push({ period, label: periodLabel(period), pending });
    }
  }

  // ── Month-by-month salary still owed ────────────────────────────────
  const months = [];
  const periods = [];
  for (let period = startPeriod; period <= relievingPeriod; period = nextPeriod(period)) {
    periods.push(period);
  }
  // Every month's salary calculated in parallel (a few at a time) instead of
  // one after another — this loop was the slowest part of the settlement.
  const salaries = await mapWithLimit(periods, 4, (period) =>
    safeMonthSalary(staffId, period),
  );
  for (let i = 0; i < periods.length; i++) {
    const period = periods[i];
    const salary = salaries[i];
    const records = recordByPeriod.get(period) || [];
    const extras = records.reduce(
      (sum, r) => sum + (Number(r.totalAllowance) || 0) - (Number(r.totalDeduction) || 0),
      0,
    );
    const earned = round2(Math.max(0, (salary?.netSalary || 0) + extras));
    // Months after confirmation but before payroll was first run in this
    // system were settled outside it — shown, but never counted as pending.
    const beforePayroll = !!firstPayrollPeriod && period < firstPayrollPeriod;
    const paid = beforePayroll ? earned : round2(settledByPeriod.get(period) || 0);
    const pending = beforePayroll ? 0 : round2(Math.max(0, earned - paid));
    months.push({
      period,
      label: periodLabel(period),
      payableDays: salary?.payableDays ?? 0,
      unpaidDays: salary?.unpaidLeaveDays ?? 0,
      totalDays: salary?.totalDaysInMonth ?? 0,
      earned,
      paid,
      pending,
      payrollStatus: records.length
        ? records[0].status
        : beforePayroll
        ? "settled outside payroll"
        : "not generated",
    });
  }

  const totalEarned = round2(months.reduce((s, m) => s + m.earned, 0));
  const amountAlreadyPaid = round2(months.reduce((s, m) => s + Math.min(m.paid, m.earned), 0));
  const preConfirmationPendingTotal = round2(
    preConfirmationPending.reduce((s, m) => s + m.pending, 0),
  );
  const pendingSalary = round2(
    months.reduce((s, m) => s + m.pending, 0) + preConfirmationPendingTotal,
  );

  // ── Advances still outstanding ──────────────────────────────────────
  const advances = await StaffAdvance.find({
    employeeId: staffId,
    status: { $in: ["pending", "approved"] },
  })
    .select("amount repaidAmount")
    .lean();
  const outstandingAdvance = round2(
    advances.reduce(
      (s, a) => s + Math.max(0, (Number(a.amount) || 0) - (Number(a.repaidAmount) || 0)),
      0,
    ),
  );

  const totalAmountPayable = round2(pendingSalary + leaveEncashment);
  const balancePayable = round2(Math.max(0, totalAmountPayable - outstandingAdvance));

  return {
    staff: {
      staffId: staff.staffId,
      staffName: staff.staffName,
      confirmationDate: staff.confirmationDate,
      relievingDate: staff.relievingDate,
    },
    monthlySalary: round2(monthlySalary),
    perDaySalary,
    leaveBalance: {
      // Paid Leave still left after leave taken was set against Sick +
      // Casual first and then Paid (oldest month first). Only this is paid.
      paidRemaining,
      // Sick + Casual that was never used — lapses, NOT paid out.
      sickCasualUnused: leave.totals.sickCasualUnused,
      // Kept for older clients: the encashable balance is Paid only.
      sickCasualRemaining: 0,
      totalLeaveBalance: paidRemaining,
      overdrawn: leave.totals.overdrawn,
      relievingMonthAccrualQualified: leave.relievingMonthAccrualQualified,
      accrualStartDate: leave.accrualStartDate,
      policy: leave.policy,
      // Month-by-month statement from the confirmation month to the
      // relieving month (see buildLeaveEncashmentLedger).
      monthly: leave.months,
      yearly: leave.years,
      totals: leave.totals,
    },
    salaryPeriod: {
      from: startPeriod,
      to: relievingPeriod,
      fromLabel: periodLabel(startPeriod),
      toLabel: periodLabel(relievingPeriod),
    },
    months,
    pendingMonths: [
      ...preConfirmationPending.map((m) => ({ ...m, beforeConfirmation: true })),
      ...months.filter((m) => m.pending > 0),
    ],
    finalSettlement: {
      totalEarned,
      amountAlreadyPaid,
      pendingSalary,
      leaveEncashmentDays: paidRemaining,
      leaveEncashment,
      // One line per month that still has Paid Leave left.
      leaveEncashmentMonths: encashedMonths,
      totalAmountPayable,
      outstandingAdvance,
      balancePayable,
    },
  };
};
