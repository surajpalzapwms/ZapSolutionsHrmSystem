// src/utils/settlementMerge.js
//
// Website copy of the mobile app's mergePendingIntoSettlement
// (Mobile/src/components/Settlement.jsx), so the website's Full & Final
// Settlement shows the SAME months and totals as the app.
//
//   Pending salary   = Pending Amount total (every unpaid month)
//   Total payable    = Pending salary + Paid Leave encashment
//   Balance payable  = Total payable − outstanding advance
// (an advance already taken off a "not generated" month's estimate is not
// taken off a second time).
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const labelOf = (p) => {
  const [y, m] = String(p).split("-").map(Number);
  return `${MONTHS[m - 1] || m} ${y}`;
};

export function mergePendingIntoSettlement(data, pending) {
  if (!data || !pending) return data;
  const items = pending.items || [];
  const byPeriod = new Map(items.map((it) => [it.period, it]));
  const rows = new Map();

  (data.months || []).forEach((m) => {
    const it = byPeriod.get(m.period);
    const pend = it ? r2(it.pending) : 0;
    rows.set(m.period, {
      ...m,
      earned: it ? r2(Math.max(Number(m.earned) || 0, (Number(it.paid) || 0) + pend)) : m.earned,
      // Not in Pending Amount = fully paid.
      paid: it ? r2(it.paid) : r2(m.earned),
      pending: pend,
      payrollStatus: it ? (it.kind === "not_generated" ? "not generated" : it.kind) : m.payrollStatus,
    });
  });
  items.forEach((it) => {
    if (rows.has(it.period)) return;
    rows.set(it.period, {
      period: it.period,
      label: labelOf(it.period),
      payableDays: it.payableDays ?? it.record?.attendanceInfo?.payableDays ?? 0,
      unpaidDays: it.unpaidDays ?? it.record?.attendanceInfo?.unpaidLeaves ?? 0,
      totalDays: it.totalDays ?? it.record?.attendanceInfo?.totalWorkingDays ?? 0,
      earned: r2((Number(it.paid) || 0) + (Number(it.pending) || 0)),
      paid: r2(it.paid),
      pending: r2(it.pending),
      payrollStatus: it.kind === "not_generated" ? "not generated" : it.kind,
    });
  });

  const months = [...rows.values()].sort((a, b) => a.period.localeCompare(b.period));
  const fs = data.finalSettlement || {};
  const pendingSalary = r2(pending.total);
  const leaveEncashment = r2(fs.leaveEncashment);
  const advanceInEstimates = r2(
    items.filter((it) => it.kind === "not_generated").reduce((s, it) => s + (Number(it.advance) || 0), 0),
  );
  const outstandingAdvance = r2(Math.max(0, (Number(fs.outstandingAdvance) || 0) - advanceInEstimates));
  const totalAmountPayable = r2(pendingSalary + leaveEncashment);

  return {
    ...data,
    salaryPeriod: months.length
      ? {
          ...(data.salaryPeriod || {}),
          from: months[0].period,
          fromLabel: months[0].label,
        }
      : data.salaryPeriod,
    months,
    pendingMonths: months.filter((m) => m.pending > 0),
    finalSettlement: {
      ...fs,
      totalEarned: r2(months.reduce((s, m) => s + (Number(m.earned) || 0), 0)),
      amountAlreadyPaid: r2(months.reduce((s, m) => s + (Number(m.paid) || 0), 0)),
      pendingSalary,
      totalAmountPayable,
      outstandingAdvance,
      balancePayable: r2(Math.max(0, totalAmountPayable - outstandingAdvance)),
    },
  };
}

// Salary the settlement already calculated for each month, in the shape
// getPendingSalary() expects — so "not generated" months need no extra
// salary-calculation request (the backend just did that same calculation).
export function salaryEstimatesFromSettlement(data) {
  const out = {};
  (data?.months || []).forEach((m) => {
    const net = m.breakdown?.netSalary;
    if (net == null) return;
    out[m.period] = {
      netSalary: net,
      payableDays: m.payableDays,
      unpaidLeaveDays: m.unpaidDays,
      totalDaysInMonth: m.totalDays,
    };
  });
  return out;
}
