// src/components/attendance/hooks/useMySalary.js
// Staff self-service version of the salary + advance loading done inside
// StaffCalendarView (admin). Read-only: it only ever asks for the logged-in
// staff member's own records (`employeeId` = their own Staff _id from
// /api/staff/me — the backend also enforces this for non-admins).
//
// Month figures follow the same rules as the admin calendar:
//   • a saved Payroll doc is shown, recalculated live when possible so a
//     later calendar change is reflected (saved amount kept for comparison)
//   • a past/current month with no saved payroll shows a live estimate
//   • months before the joining month (or in the future) are skipped
import { useCallback, useEffect, useRef, useState } from "react";
import { payrollService } from "../../../services/payrollService";
import { advanceService } from "../../../services/advanceService";

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

export const useMySalary = (employeeId, year, joinKey) => {
  const [salaryByMonth, setSalaryByMonth] = useState({});
  const [salaryLoading, setSalaryLoading] = useState(false);
  const reqId = useRef(0);

  // A different year / person starts clean.
  useEffect(() => {
    reqId.current++;
    setSalaryByMonth({});
  }, [employeeId, year]);

  // `onlyMonth` (0-11) refreshes just that month (Monthly view); omit it to
  // load the whole year (Annual view).
  const loadSalary = useCallback(
    async (onlyMonth = null) => {
      if (!employeeId) return;
      const id = ++reqId.current;
      setSalaryLoading(true);
      try {
        const byMonth = {};
        try {
          const res = await payrollService.getAll({
            employeeId,
            periodFrom: `${year}-01`,
            periodTo: `${year}-12`,
          });
          const records = res.data?.data || res.data || [];
          (Array.isArray(records) ? records : []).forEach((rec) => {
            // Defensive: never show another person's payroll.
            const recEmp = rec.employeeId?._id || rec.employeeId;
            if (recEmp && !sameId(recEmp, employeeId)) return;
            const m = Number(String(rec.period).split("-")[1]) - 1;
            if (m < 0 || m > 11) return;
            byMonth[m] = {
              ...rec,
              payableDays: rec.attendanceInfo?.payableDays,
              totalDays: rec.attendanceInfo?.totalWorkingDays,
              unpaidDays: rec.attendanceInfo?.unpaidLeaves,
              leaveDeduction: rec.attendanceInfo?.leaveDeduction ?? 0,
            };
          });
        } catch {
          // No saved payroll visible — live estimates below may still work.
        }

        const now = new Date();
        const joinYear = joinKey ? Number(joinKey.slice(0, 4)) : null;
        const joinMonth = joinKey ? Number(joinKey.slice(5, 7)) - 1 : null;
        const months = Array.from({ length: 12 }, (_, m) => m).filter((m) => {
          if (onlyMonth !== null && m !== onlyMonth) return false;
          if (year > now.getFullYear()) return false;
          if (year === now.getFullYear() && m > now.getMonth()) return false;
          if (joinYear != null && (year < joinYear || (year === joinYear && m < joinMonth))) return false;
          return true;
        });

        const estimates = await Promise.allSettled(
          months.map((m) =>
            payrollService
              .calculate(employeeId, `${year}-${String(m + 1).padStart(2, "0")}`)
              .then((r) => ({ month: m, data: r.data?.data || r.data })),
          ),
        );
        estimates.forEach((result) => {
          if (result.status !== "fulfilled" || !result.value?.data) return;
          const { month, data } = result.value;
          const saved = byMonth[month];
          if (saved) {
            const live =
              Number(data.netSalary || 0) -
              Number(saved.advanceDeduction || 0) +
              Number(saved.totalAllowance || 0) -
              Number(saved.totalDeduction || 0);
            const liveRounded = Math.round(Math.max(0, live) * 100) / 100;
            const savedNet = Number(saved.netSalary || 0);
            byMonth[month] = {
              ...saved,
              netSalary: liveRounded,
              savedNetSalary: savedNet,
              differsFromSaved: Math.abs(liveRounded - savedNet) >= 0.01,
              payableDays: data.payableDays,
              payableNote: data.payableNote || null,
              totalDays: data.totalDaysInMonth,
              unpaidDays: data.unpaidLeaveDays,
              leaveDeduction: data.leaveDeduction ?? 0,
            };
            return;
          }
          byMonth[month] = {
            netSalary: data.finalSalary ?? data.netSalary,
            isEstimate: true,
            payableDays: data.payableDays,
            payableNote: data.payableNote || null,
            totalDays: data.totalDaysInMonth,
            unpaidDays: data.unpaidLeaveDays,
            leaveDeduction: data.leaveDeduction ?? 0,
          };
        });

        if (id !== reqId.current) return;
        if (onlyMonth === null) {
          setSalaryByMonth(byMonth);
        } else {
          setSalaryByMonth((prev) => {
            const next = { ...prev };
            if (byMonth[onlyMonth]) next[onlyMonth] = byMonth[onlyMonth];
            else delete next[onlyMonth];
            return next;
          });
        }
      } finally {
        if (id === reqId.current) setSalaryLoading(false);
      }
    },
    [employeeId, year, joinKey],
  );

  // Advances grouped by "YYYY-M" (month 0-11); rejected ones ignored.
  const [advancesByMonth, setAdvancesByMonth] = useState({});
  const [advancesLoading, setAdvancesLoading] = useState(false);
  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    setAdvancesLoading(true);
    advanceService
      .getAll({ employeeId })
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.data || [];
        const grouped = {};
        list
          .filter((a) => a.status !== "rejected")
          .filter((a) => sameId(a.employeeId?._id || a.employeeId, employeeId))
          .forEach((a) => {
            const d = new Date(a.date);
            if (Number.isNaN(d.getTime())) return;
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            (grouped[key] = grouped[key] || []).push(a);
          });
        Object.values(grouped).forEach((arr) =>
          arr.sort((x, y) => new Date(x.date) - new Date(y.date)),
        );
        setAdvancesByMonth(grouped);
      })
      .catch(() => {
        if (!cancelled) setAdvancesByMonth({});
      })
      .finally(() => {
        if (!cancelled) setAdvancesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  return { salaryByMonth, salaryLoading, loadSalary, advancesByMonth, advancesLoading };
};
