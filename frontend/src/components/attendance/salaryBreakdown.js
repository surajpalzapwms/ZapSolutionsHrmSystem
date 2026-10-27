// src/components/attendance/salaryBreakdown.js
// The full "how was this month's salary worked out" figures, taken from
// either a saved Payroll doc or the live calculate endpoint, so the month
// card, its tooltip and the Month Summary panel can all show the same
// breakdown, always to 2 decimal places:
//
//   Basic salary              ₹20,000.00
//   Per day (÷ 30 days)          ₹666.67
//   − Leave (2 days unpaid)    ₹1,333.33
//   − Late coming                  ₹0.00
//   − Navkar commission (25%)  ₹5,000.00
//   = Salary                  ₹13,666.67

import { formatMoney } from "../../utils/brand";

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const money2 = (n) => formatMoney(round2(n));

// From a saved Payroll document (GET /api/hrm/payroll).
export const breakdownFromSaved = (rec) => ({
  basicSalary: round2(rec?.basicSalary),
  perDaySalary: round2(rec?.attendanceInfo?.perDaySalary),
  leaveDeduction: round2(rec?.attendanceInfo?.leaveDeduction),
  lateDeduction: round2(rec?.attendanceInfo?.lateDeduction),
  referralCommission: round2(rec?.referralCommission),
  referralOrganization: rec?.referral?.organizationName || "",
  referralPercent: Number(rec?.referral?.percent) || 0,
});

// From the live calculate endpoint (GET /api/hrm/payroll/calculate/...).
export const breakdownFromLive = (data) => ({
  basicSalary: round2(data?.basicSalary),
  perDaySalary: round2(data?.perDaySalary),
  leaveDeduction: round2(data?.leaveDeduction),
  lateDeduction: round2(data?.lateDeduction),
  referralCommission: round2(data?.referralCommission),
  referralOrganization: data?.referralOrganization || "",
  referralPercent: Number(data?.referralPercent) || 0,
  referralCommissionCapped: !!data?.referralCommissionCapped,
});

export const referralLabel = (s) =>
  `${s?.referralOrganization || "Referral"} commission${
    s?.referralPercent ? ` (${round2(s.referralPercent)}%)` : ""
  }`;

// Plain-text lines for a hover tooltip.
export const breakdownLines = (s) => {
  if (!s) return [];
  const lines = [];
  if (s.basicSalary) lines.push(`Basic salary: ${money2(s.basicSalary)}`);
  if (s.perDaySalary && s.totalDays)
    lines.push(`Per day: ${money2(s.perDaySalary)} (÷ ${s.totalDays} days)`);
  if (s.payableDays != null && s.totalDays != null)
    lines.push(
      `Payable days: ${s.payableDays}/${s.totalDays}${
        s.unpaidDays ? ` · ${round2(s.unpaidDays)} unpaid` : ""
      }`,
    );
  if (Number(s.leaveDeduction) > 0)
    lines.push(`− Leave deduction: ${money2(s.leaveDeduction)}`);
  if (Number(s.lateDeduction) > 0)
    lines.push(`− Late coming: ${money2(s.lateDeduction)}`);
  if (Number(s.referralCommission) > 0)
    lines.push(`− ${referralLabel(s)}: ${money2(s.referralCommission)}`);
  if (Number(s.advanceDeduction) > 0)
    lines.push(`− Advance recovered: ${money2(s.advanceDeduction)}`);
  lines.push(`= Salary: ${money2(s.netSalary)}`);
  return lines;
};
