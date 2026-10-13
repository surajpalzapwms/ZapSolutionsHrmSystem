// services/leaveEncashment.js
//
// Month-wise PAID LEAVE VALUE — used by
//   * the attendance calendar  ("PL Amt" next to each month's salary), and
//   * the Full & Final Settlement (leave encashment, month by month).
//
// ─── How much Paid Leave a month earns ──────────────────────────────────
// Never hard-coded here. It comes from the Leave Policy the admin sets on
// the Leave tab (LeavePolicy.paidPerYear / 12, e.g. 18 / 12 = 1.5 per
// month), through the same month-by-month ledger the leave balance uses
// (buildMonthlyLedger in services/leaveBalance.js). So:
//   * months before the confirmation date earn nothing;
//   * the final (relieving) month earns nothing when the staff member was
//     in service (worked + holidays) fewer than 20 days of it — that month
//     comes back with `credited: false` and a PL amount of 0.
//
// ─── What a month's Paid Leave is worth ─────────────────────────────────
// That month's own salary rate:
//     per-day salary = basic salary in effect that month / days in month
//     PL amount      = PL days × per-day salary
//   e.g. 1.5 PL in a ₹26,500 month with 31 days = 1.5 × 854.84 = ₹1,282.26
//        1.5 PL in a ₹15,000 month with 30 days = 1.5 × 500.00 = ₹750.00
//
// ─── Which earned leave the leave TAKEN uses up (settlement) ────────────
// Sick and Casual leave are never paid out in cash, so leave taken is
// deducted from them FIRST and only what is left over comes out of Paid
// Leave:
//   1. For each calendar year, all Paid + Sick + Casual leave taken that
//      year is first set against the Sick + Casual earned that year
//      (oldest month first). Sick + Casual left unused lapses on 31 Dec.
//   2. Whatever is still left is deducted from Paid Leave, oldest month
//      first (Nov 2025, Dec 2025, Jan 2026, Feb 2026 …).
//   3. The Paid Leave still left in each month is encashed at THAT month's
//      per-day salary.
// Unpaid leave is never deducted from any balance (salary was already cut).
import mongoose from "mongoose";
import Staff from "../models/Staff.js";
import StaffBasicPayroll from "../models/StaffBasicPayroll.js";
import { computeLeaveBalances } from "./leaveBalance.js";

const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const EPS = 1e-9;

// Basic salary in effect for a period — same rule as payroll's
// getBasicSalaryForPeriod (latest revision effective on/before the period
// end, else the earliest revision, else the current basic salary).
export const basicSalaryForPeriod = (basicPayroll, periodEnd) => {
  if (!basicPayroll) return 0;
  const history = Array.isArray(basicPayroll.salaryHistory) ? basicPayroll.salaryHistory : [];
  const applicable = history
    .filter((h) => h && h.effectiveFrom && new Date(h.effectiveFrom) <= periodEnd)
    .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom));
  if (applicable.length > 0) return Number(applicable[0].basicSalary) || 0;
  if (history.length > 0) {
    const earliest = [...history].sort(
      (a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom),
    )[0];
    return Number(earliest.basicSalary) || 0;
  }
  return Number(basicPayroll.currentBasicSalary) || 0;
};

// "2026-07" -> { basicSalary, daysInMonth, perDaySalary } for that month.
const rateForPeriod = (basicPayroll, period) => {
  const [y, m] = period.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const periodEnd = new Date(y, m, 0); // same basis payroll uses
  const basicSalary = basicSalaryForPeriod(basicPayroll, periodEnd);
  return {
    basicSalary: round2(basicSalary),
    daysInMonth,
    perDaySalaryExact: basicSalary ? basicSalary / daysInMonth : 0,
    perDaySalary: round2(basicSalary ? basicSalary / daysInMonth : 0),
  };
};

// Pure allocation step (no DB) — takes the ledger months from
// buildMonthlyLedger plus the staff member's basic payroll record.
export const allocateLeaveEncashment = (ledgerMonths, basicPayroll) => {
  // Only months from the CONFIRMATION month onward are shown and counted —
  // leave recorded before confirmation (probation / joining period) is left
  // out of the statement and out of the Sick/Casual/Paid deduction.
  const months = (ledgerMonths || []).filter((m) => !m.beforeConfirmation).map((m) => {
    const rate = rateForPeriod(basicPayroll, m.period);
    const earned = {
      sick: round2(m.earned?.sick),
      casual: round2(m.earned?.casual),
      paid: round2(m.earned?.paid),
    };
    const taken = {
      sick: round2(m.taken?.sick),
      casual: round2(m.taken?.casual),
      paid: round2(m.taken?.paid),
      unpaid: round2(m.taken?.unpaid),
    };
    taken.total = round2(taken.sick + taken.casual + taken.paid); // unpaid excluded
    return {
      period: m.period,
      label: m.label,
      year: Number(m.period.slice(0, 4)),
      month: Number(m.period.slice(5, 7)) - 1, // 0-11
      credited: !!m.credited,
      beforeConfirmation: !!m.beforeConfirmation,
      ...rate,
      earned: { ...earned, total: round2(earned.sick + earned.casual + earned.paid) },
      taken,
      // Filled in by the allocation below.
      deducted: { sickCasual: 0, paid: 0, total: 0 },
      sickCasualUnused: 0,
      plRemaining: 0,
      // Value of the PL this month EARNED (calendar "PL Amt").
      plEarnedAmount: round2(earned.paid * rate.perDaySalaryExact),
      // Value of the PL from this month still left (settlement encashment).
      plAmount: 0,
    };
  });

  // ── Step 1: per year, leave taken uses Sick + Casual first ───────────
  let paidNeeded = 0;
  const years = [...new Set(months.map((m) => m.year))];
  const yearly = years.map((year) => {
    const rows = months.filter((m) => m.year === year);
    const takenInYear = round2(rows.reduce((s, m) => s + m.taken.total, 0));
    let left = takenInYear;
    rows.forEach((m) => {
      const available = round2(m.earned.sick + m.earned.casual);
      const use = round2(Math.min(available, Math.max(0, left)));
      m.deducted.sickCasual = use;
      m.sickCasualUnused = round2(available - use);
      left = round2(left - use);
    });
    paidNeeded = round2(paidNeeded + Math.max(0, left));
    return {
      year,
      earned: {
        sick: round2(rows.reduce((s, m) => s + m.earned.sick, 0)),
        casual: round2(rows.reduce((s, m) => s + m.earned.casual, 0)),
        paid: round2(rows.reduce((s, m) => s + m.earned.paid, 0)),
      },
      taken: {
        sick: round2(rows.reduce((s, m) => s + m.taken.sick, 0)),
        casual: round2(rows.reduce((s, m) => s + m.taken.casual, 0)),
        paid: round2(rows.reduce((s, m) => s + m.taken.paid, 0)),
        unpaid: round2(rows.reduce((s, m) => s + m.taken.unpaid, 0)),
        total: takenInYear,
      },
      fromSickCasual: round2(rows.reduce((s, m) => s + m.deducted.sickCasual, 0)),
      toPaid: round2(Math.max(0, left)),
      // Sick + Casual not used that year — lapses, never paid out.
      sickCasualLapsed: round2(rows.reduce((s, m) => s + m.sickCasualUnused, 0)),
    };
  });

  // ── Step 2: the rest comes out of Paid Leave, oldest month first ─────
  let need = paidNeeded;
  months.forEach((m) => {
    const use = round2(Math.min(m.earned.paid, Math.max(0, need)));
    m.deducted.paid = use;
    need = round2(need - use);
    m.deducted.total = round2(m.deducted.sickCasual + m.deducted.paid);
    m.plRemaining = round2(m.earned.paid - use);
    // ── Step 3: what is left is worth that month's per-day salary ─────
    m.plAmount = round2(m.plRemaining * m.perDaySalaryExact);
  });
  const overdrawn = round2(Math.max(0, need)); // taken beyond everything earned

  // Strip the unrounded helper before returning.
  months.forEach((m) => delete m.perDaySalaryExact);

  const sum = (pick) => round2(months.reduce((s, m) => s + (Number(pick(m)) || 0), 0));
  const totals = {
    earned: {
      sick: sum((m) => m.earned.sick),
      casual: sum((m) => m.earned.casual),
      paid: sum((m) => m.earned.paid),
      total: sum((m) => m.earned.total),
    },
    taken: {
      sick: sum((m) => m.taken.sick),
      casual: sum((m) => m.taken.casual),
      paid: sum((m) => m.taken.paid),
      unpaid: sum((m) => m.taken.unpaid),
      total: sum((m) => m.taken.total),
    },
    deducted: {
      sickCasual: sum((m) => m.deducted.sickCasual),
      paid: sum((m) => m.deducted.paid),
      total: sum((m) => m.deducted.total),
    },
    sickCasualUnused: sum((m) => m.sickCasualUnused),
    plEarnedAmount: sum((m) => m.plEarnedAmount),
    plRemaining: sum((m) => m.plRemaining),
    encashment: sum((m) => m.plAmount),
    overdrawn,
  };

  return { months, years: yearly, totals };
};

// Builds the month-wise leave + encashment statement.
//   staffId          Staff._id
//   confirmationDate staff.confirmationDate (null -> derived, see leaveBalance)
//   asOf             last day to include (relieving date / today)
//   relievingDate    real relieving date, or null if still working
export const buildLeaveEncashmentLedger = async ({
  staffId,
  confirmationDate = null,
  asOf = new Date(),
  relievingDate = null,
}) => {
  const [balances, basicPayroll] = await Promise.all([
    computeLeaveBalances(staffId, confirmationDate, null, asOf, relievingDate, {
      includeMonthly: true,
    }),
    StaffBasicPayroll.findOne({ employeeId: staffId }).lean(),
  ]);

  const { months, years: yearly, totals } = allocateLeaveEncashment(
    balances.monthly?.months || [],
    basicPayroll,
  );

  return {
    policy: {
      paidPerYear: balances.paid?.perYear,
      paidPerMonth: balances.paid?.perMonth,
      sickPerMonth: balances.sick?.perMonth,
      casualPerMonth: balances.casual?.perMonth,
    },
    relievingMonthAccrualQualified: balances.relievingMonthAccrualQualified,
    accrualStartDate: balances.accrualStartDate,
    months,
    years: yearly,
    totals,
  };
};

// Calendar helper: PL earned + its value for every month of `year`,
// keyed by month index (0-11). Months with nothing earned (before
// confirmation, in the future, or a final month under 20 days) come back
// with credited: false and amount 0.
export const buildPaidLeaveValueByMonth = async (staffOrId, year) => {
  const staff =
    staffOrId && staffOrId._id
      ? staffOrId
      : mongoose.Types.ObjectId.isValid(String(staffOrId))
      ? await Staff.findById(staffOrId).lean()
      : null;
  if (!staff) return {};

  const relievingDate =
    staff.status === "Relieved" && staff.relievingDate ? new Date(staff.relievingDate) : null;
  const now = new Date();
  const yearEnd = new Date(Date.UTC(year, 11, 31, 12, 0, 0, 0));
  let asOf = now < yearEnd ? now : yearEnd;
  if (relievingDate && relievingDate < asOf) asOf = relievingDate;
  if (asOf.getUTCFullYear() < year) return {}; // whole year is in the future / after relieving

  const ledger = await buildLeaveEncashmentLedger({
    staffId: staff._id,
    confirmationDate: staff.confirmationDate ?? null,
    asOf,
    relievingDate,
  });

  const byMonth = {};
  ledger.months
    .filter((m) => m.year === year && !m.beforeConfirmation)
    .forEach((m) => {
      byMonth[m.month] = {
        period: m.period,
        credited: m.credited,
        plDays: m.credited ? m.earned.paid : 0,
        perDaySalary: m.perDaySalary,
        basicSalary: m.basicSalary,
        daysInMonth: m.daysInMonth,
        amount: m.credited ? m.plEarnedAmount : 0,
        // Split of this month's Paid Leave after leave taken was set
        // against Sick + Casual first, then Paid (oldest month first):
        //   left  → still owed (GREEN on screen), taken → used (RED).
        plLeftDays: m.credited ? m.plRemaining : 0,
        plLeftAmount: m.credited ? m.plAmount : 0,
        plTakenDays: m.credited ? m.deducted.paid : 0,
        plTakenAmount: m.credited ? round2(m.deducted.paid * m.perDaySalaryExact) : 0,
        reason: m.credited
          ? null
          : "Not earned — fewer than 20 days worked (holidays included) in the final month",
      };
    });
  return byMonth;
};
