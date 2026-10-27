// src/utils/settlementBreakdown.js
//
// "How was this month's salary worked out?" for the Full & Final Settlement.
// Used by the "View details" button on the website statement AND printed in
// the PDF, so both always show the same lines. The mobile app has the same
// file (Mobile/src/utils/settlementBreakdown.js) — keep them in sync.
//
// Each line: { label, amount?, text?, sign?: "+" | "-" | "=", sub?, kind? }
//   kind: "total" (bold), "muted" (info only), "pending", "paid"

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const d = (n) => String(r2(n));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (key) => {
  const [, m, day] = String(key).split("-").map(Number);
  return m ? `${String(day).padStart(2, "0")} ${MONTHS[m - 1]}` : String(key);
};
const dateList = (keys = [], max = 12) => {
  const list = keys.slice(0, max).map(shortDate).join(", ");
  return keys.length > max ? `${list} +${keys.length - max} more` : list;
};

/** True when the statement is for someone who left during probation. */
export const isProbationExit = (data) => !!data?.probationExit;

/** Lines explaining one month row of the settlement. */
export function monthBreakdownLines(m) {
  const b = m?.breakdown;
  const lines = [];

  if (!b) {
    lines.push({
      label:
        m?.payrollStatus === "not generated"
          ? "Payroll not generated yet — estimated from attendance"
          : "Salary for the month",
      amount: m?.earned,
    });
  } else {
    lines.push({ label: "Monthly basic salary", amount: b.basicSalary, kind: "muted" });
    lines.push({
      label: `Per day salary (basic ÷ ${b.totalDaysInMonth} days)`,
      amount: b.perDaySalary,
      kind: "muted",
    });
    lines.push({
      label: `Salary for ${d(b.payableDays)} of ${b.totalDaysInMonth} days`,
      sub: b.payableNote || `${d(b.payableDays)} days × per day salary`,
      amount: b.salaryForPayableDays,
    });
    if (b.unpaidLeaveDays > 0) {
      const unmarked = (b.unmarkedDates || []).length;
      const halves = b.halfDayDates || [];
      lines.push({
        sign: "-",
        label: `Unpaid leave / absent${halves.length ? " / half days" : ""} (${d(b.unpaidLeaveDays)} days × per day)`,
        sub:
          dateList(b.unpaidLeaveDates) +
          (unmarked ? ` · ${unmarked} day(s) with no attendance marked` : "") +
          (halves.length
            ? ` · ${halves.length} half day(s) = ${d(halves.length * 0.5)} day: ${dateList(halves)}`
            : ""),
        amount: b.leaveDeduction,
      });
    }
    if (b.lateDeduction > 0) {
      lines.push({
        sign: "-",
        label: "Late coming",
        sub: `${b.lateMinutes} min on ${b.lateDays} day(s)`,
        amount: b.lateDeduction,
      });
    }
    if (b.referralCommission > 0) {
      lines.push({
        sign: "-",
        label: `Referral commission${b.referralOrganization ? ` — ${b.referralOrganization}` : ""}${
          b.referralPercent ? ` (${d(b.referralPercent)}%)` : ""
        }`,
        amount: b.referralCommission,
      });
    }
    lines.push({ sign: "=", label: "Net salary", amount: b.netSalary, kind: "total" });
    (b.allowances || []).forEach((a) =>
      lines.push({ sign: "+", label: `Allowance — ${a.type || "Other"}`, amount: a.amount }),
    );
    if (!(b.allowances || []).length && b.totalAllowance > 0)
      lines.push({ sign: "+", label: "Allowances", amount: b.totalAllowance });
    (b.deductions || []).forEach((x) =>
      lines.push({ sign: "-", label: `Deduction — ${x.type || "Other"}`, amount: x.amount }),
    );
    if (!(b.deductions || []).length && b.totalDeduction > 0)
      lines.push({ sign: "-", label: "Deductions", amount: b.totalDeduction });
  }

  lines.push({ sign: "=", label: "Salary earned for the month", amount: m?.earned, kind: "total" });
  lines.push({
    label: "Already paid",
    sub: b?.advanceRecovered > 0 ? `includes advance recovered ${b.advanceRecovered.toFixed(2)}` : undefined,
    amount: m?.paid,
    kind: "paid",
  });
  lines.push({
    label: m?.pending > 0 ? "Pending" : "Settled",
    amount: m?.pending > 0 ? m.pending : 0,
    kind: m?.pending > 0 ? "pending" : "paid",
  });
  return lines;
}

/** Totals across the month-wise salary table. */
export function monthTotals(months = []) {
  return {
    unpaidDays: r2(months.reduce((s, m) => s + (Number(m.unpaidDays) || 0), 0)),
    earned: r2(months.reduce((s, m) => s + (Number(m.earned) || 0), 0)),
    paid: r2(months.reduce((s, m) => s + (Number(m.paid) || 0), 0)),
    pending: r2(months.reduce((s, m) => s + (Number(m.pending) || 0), 0)),
  };
}
