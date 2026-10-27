// src/services/pendingSalaryService.js — salary still owed, month by month.
//
// Website copy of the mobile app's Mobile/src/services/pendingSalaryService.js
// so the Full & Final Settlement on the website shows EXACTLY the same months
// and amounts as the app. Keep the two files in sync.
//
// Rules:
//   • The CURRENT month is never listed. Exception: someone who has left —
//     their last (relieving) month is listed even if it is the current month.
//   • Fully paid month          → not listed.
//   • Partly paid month         → listed with only the UNPAID part.
//   • Month with no payment     → listed with the full amount.
//   • Month with no payroll yet → listed as "Not generated":
//       Total payable = Salary (estimate) − Advance given that month.
//
// How far back: from the joining month, or from the first month that has a
// payroll record (whichever is later). With no payroll at all, at most the
// last 12 months.
import { payrollService } from "./payrollService";
import { advanceService } from "./advanceService";

const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round(v * 100) / 100;
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const empOf = (rec) =>
  rec?.employeeId && typeof rec.employeeId === "object" ? rec.employeeId._id : rec?.employeeId;
const periodOf = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`; // m 0-11
const periodKey = (p) => {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(p || ""));
  return m ? periodOf(Number(m[1]), Number(m[2]) - 1) : null;
};
const addMonths = (period, n) => {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return periodOf(d.getFullYear(), d.getMonth());
};

// Same as the app's utils/helpers unwrapList — pulls the array out of any
// API response shape.
export const unwrapList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === "object") {
    const nested = unwrapList(payload.data);
    if (nested.length) return nested;
  }
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) return value;
  }
  return [];
};

// "YYYY-MM-DD" of a stored date, read in India time (IST, UTC+5:30) — same
// as the app's utils/staffStatus dateKeyFrom.
const IST_OFFSET_MS = 330 * 60 * 1000;
const dateKeyFrom = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
};

/** Figures of one SAVED payroll record: { payable, paid, pending, kind, status }. */
export function savedPayrollFigures(rec) {
  const net = num(rec.netSalary ?? rec.netPay ?? rec.amount);
  const payable = rec.totalPayable != null ? num(rec.totalPayable) : net;
  const payments = Array.isArray(rec.payments) ? rec.payments : [];
  const status = String(rec.status || "").toLowerCase();
  let paid =
    rec.paidAmount != null
      ? num(rec.paidAmount)
      : payments.length
        ? payments.reduce((s, p) => s + num(p.amount), 0)
        : status === "paid"
          ? payable
          : 0;
  let pending = rec.pendingAmount != null ? num(rec.pendingAmount) : Math.max(0, payable - paid);
  if (status === "paid" && rec.pendingAmount == null) pending = 0;
  pending = round2(Math.max(0, pending));
  paid = round2(paid);
  const kind = pending <= 0.5 ? "paid" : paid > 0.5 ? "partial" : "unpaid";
  return { payable: round2(payable), paid, pending, kind, status: rec.status || "" };
}

/**
 * Pending salary for ONE staff member.
 * @returns {Promise<{ items: object[], total:number, months:number }>}
 */
export async function getPendingSalary({
  employeeId,
  joiningDate = null,
  relievingDate = null,
  hasLeft = false,
  payroll = null,
  withEstimates = true,
  // Optional, to skip requests the caller has already made / can answer:
  //   advances       — the staff member's advance list (any API shape)
  //   salaryByPeriod — { "YYYY-MM": { netSalary, payableDays,
  //                      unpaidLeaveDays, totalDaysInMonth } } for months
  //                      whose salary is already calculated (e.g. by the
  //                      settlement). Only the other "not generated" months
  //                      are calculated through the API.
  advances: prefetchedAdvances = null,
  salaryByPeriod = null,
}) {
  if (!employeeId) return { items: [], total: 0, months: 0 };

  const now = new Date();
  const current = periodOf(now.getFullYear(), now.getMonth());
  const relieveKey = relievingDate ? dateKeyFrom(relievingDate)?.slice(0, 7) : null;
  const joinKey = joiningDate ? dateKeyFrom(joiningDate)?.slice(0, 7) : null;

  let last = addMonths(current, -1);
  if (relieveKey) {
    if (hasLeft) last = relieveKey < current ? relieveKey : current;
    else if (relieveKey < last) last = relieveKey;
  }

  const records = (payroll || unwrapList((await payrollService.getAll({ employeeId })).data))
    .filter((r) => !empOf(r) || sameId(empOf(r), employeeId))
    .map((r) => ({ ...r, _period: periodKey(r.period || r.month) }))
    .filter((r) => r._period && r._period <= last);

  const byPeriod = {};
  records.forEach((r) => {
    if (!byPeriod[r._period] || (r.updatedAt || "") > (byPeriod[r._period].updatedAt || ""))
      byPeriod[r._period] = r;
  });

  const earliest = records.map((r) => r._period).sort()[0] || null;
  let first = earliest || addMonths(last, -11);
  if (joinKey && joinKey > first) first = joinKey;

  const periods = [];
  for (let p = first; p <= last && periods.length < 120; p = addMonths(p, 1)) periods.push(p);

  const items = [];
  const missing = [];
  periods.forEach((p) => {
    const rec = byPeriod[p];
    if (rec) {
      const f = savedPayrollFigures(rec);
      if (f.kind !== "paid") {
        items.push({
          period: p,
          kind: f.kind,
          payable: f.payable,
          paid: f.paid,
          pending: f.pending,
          salary: num(rec.netSalary ?? rec.netPay),
          advance: num(rec.advanceDeduction),
          estimate: false,
          record: rec,
        });
      }
    } else {
      missing.push(p);
    }
  });

  if (missing.length) {
    let advances = {};
    if (withEstimates) {
      try {
        const payload = prefetchedAdvances ?? (await advanceService.getAll({ employeeId })).data;
        unwrapList(payload)
          .filter((a) => a.status !== "rejected")
          .filter((a) => !empOf(a) || sameId(empOf(a), employeeId))
          .forEach((a) => {
            const d = new Date(a.date);
            if (Number.isNaN(d.getTime())) return;
            const k = periodOf(d.getFullYear(), d.getMonth());
            advances[k] = (advances[k] || 0) + num(a.amount);
          });
      } catch {
        advances = {};
      }
    }
    const estimates = await Promise.all(
      missing.map((p) =>
        !withEstimates
          ? Promise.resolve(null)
          : salaryByPeriod?.[p]
            ? Promise.resolve(salaryByPeriod[p])
            : payrollService
                .calculate(employeeId, p)
                .then((r) => r.data?.data || r.data || null)
                .catch(() => null),
      ),
    );
    missing.forEach((p, i) => {
      const data = estimates[i];
      const salary = data ? num(data.finalSalary ?? data.netSalary) : null;
      const advance = round2(advances[p] || 0);
      const payable = salary != null ? round2(Math.max(0, salary - advance)) : null;
      if (payable === 0) return;
      items.push({
        period: p,
        kind: "not_generated",
        payable,
        paid: 0,
        pending: payable ?? 0,
        salary,
        advance,
        estimate: true,
        payableDays: data?.payableDays,
        unpaidDays: data?.unpaidLeaveDays || 0,
        totalDays: data?.totalDaysInMonth,
        record: null,
      });
    });
  }

  items.sort((a, b) => b.period.localeCompare(a.period)); // newest first
  return {
    items,
    total: round2(items.reduce((s, it) => s + it.pending, 0)),
    months: items.length,
  };
}
