import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  ShieldCheck,
  CalendarRange,
} from "lucide-react";
import Button from "../common/Button";
import Spinner from "../common/Spinner";
import { useMRCalendar } from "./hooks/useMRCalendar";
import { SHORT_DAYS, MONTHS } from "../../utils/constants";
import { showToast } from "../../utils/toast";
import { attendanceService } from "../../services/attendanceService";
import { breakdownFromSaved, breakdownFromLive } from "./salaryBreakdown";
import { payrollService } from "../../services/payrollService";
import { advanceService } from "../../services/advanceService";
import { staffService } from "../../services/staffService";
import MonthSummaryPanel from "./MonthSummaryPanel";
import { eachDateInRange } from "../../utils/dateUtils";
import EditDayModal from "./EditDayModal";
import BulkMarkMonthModal from "./BulkMarkMonthModal.jsx";
import LateComingPanel, { LateDayBadge } from "./LateComingPanel";
import { lateDeductionService } from "../../services/lateDeductionService";
import { isSuperAdminUser } from "../../utils/authUser";
import { leftBeforeConfirmation } from "../../utils/staffStatus";
import {
  LEGEND,
  TOOLTIP_STATUSES,
  DELETABLE_STATUSES,
  EDITABLE_STATUSES,
  dayCellClasses,
  dayCellSplitStyle,
} from "./calendarHelpers";
import {
  DayTooltip,
  DayEditButton,
  MiniMonth,
  SalaryBoxContent,
  LeaveBalanceLine,
  ReferralLine,
} from "./calendarGridPieces";

import { formatMoney } from "../../utils/brand";
// Annual view badge: the total PAID LEAVE amount the company has given this
// staff member this year (Jan up to the current month, or the whole year for
// a past year). Only the paid-leave value is counted — NOT the salary and
// NOT the payroll amounts paid out. Each month's figure comes from the
// calendar payload's `paidLeaveValue[month]` (backend
// services/leaveEncashment.js): PL days credited that month × that month's
// per-day salary — the same "PL Amt" shown on each month card.
const fmtINR = (n) => formatMoney(n);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const TotalPaidLeaveBadge = ({ paidLeaveValue, year, loading }) => {
  const now = new Date();
  const lastMonth =
    year < now.getFullYear() ? 11 : year > now.getFullYear() ? -1 : now.getMonth();
  let amount = 0;
  let days = 0;
  let takenAmount = 0;
  let leftAmount = 0;
  for (let m = 0; m <= lastMonth; m++) {
    const pl = paidLeaveValue?.[m];
    if (!pl?.credited) continue;
    amount += Number(pl.amount) || 0;
    days += Number(pl.plDays) || 0;
    takenAmount += Number(pl.plTakenAmount) || 0;
    leftAmount += Number(pl.plLeftAmount) || 0;
  }
  const range =
    lastMonth < 0 ? "" : `Jan–${MONTHS[lastMonth].slice(0, 3)} ${year}`;
  const daysText = `${round2(days)} day${round2(days) === 1 ? "" : "s"}`;
  return (
    <div
      className="flex flex-col items-end rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 leading-tight"
      title={
        `Paid leave given by the company ${range ? `(${range})` : ""}: ${daysText} = ${fmtINR(amount)}\n` +
        `Used: ${fmtINR(takenAmount)} · Still available: ${fmtINR(leftAmount)}\n` +
        "Salary and payroll payouts are not included."
      }
    >
      <span className="text-[11px] font-medium text-emerald-700">
        Total Paid Leave {range && `(${range})`}
      </span>
      <span className="text-sm font-bold text-emerald-800">
        {loading ? "Loading…" : fmtINR(amount)}
        {!loading && (
          <span className="ml-2 text-xs font-medium text-emerald-700">{daysText}</span>
        )}
      </span>
    </div>
  );
};

const MRCalendarView = ({
  staff,
  onBack,
  onDeleted,
  holidays = [],
  // Bumped by the parent after an import / Record Attendance / delete so
  // this view refetches in place — it used to be part of this component's
  // `key`, which unmounted and remounted the whole calendar (losing the
  // month being viewed and jumping back to today) after every change.
  refreshKey = 0,
}) => {
  const isRelieved = staff.status === "Relieved" && !!staff.relievingDate;
  const relievingDateObj = isRelieved ? new Date(staff.relievingDate) : null;
  const maxYear = relievingDateObj ? relievingDateObj.getFullYear() : null;
  const maxMonth = relievingDateObj ? relievingDateObj.getMonth() : null;
  const defaultCalendarDate = isRelieved ? staff.relievingDate : undefined;

  const joinDateObj = staff.date ? new Date(staff.date) : null;
  const minYear = joinDateObj ? joinDateObj.getFullYear() : null;
  const minMonth = joinDateObj ? joinDateObj.getMonth() : null;

  const {
    viewMode,
    setViewMode,
    year,
    month,
    calendar,
    loading,
    error,
    selectedDay,
    setSelectedDay,
    goToPrevMonth,
    goToNextMonth,
    goToPrevYear,
    goToNextYear,
    goToMonth,
    goToYear,
    fetchCalendar,
  } = useMRCalendar(staff.staffId, defaultCalendarDate);

  const firstRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === firstRefreshKey.current) return;
    fetchCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const isAnnualView = viewMode === "annual";

  const yearOptions = useMemo(() => {
    const nowYear = new Date().getFullYear();
    const all = Array.from({ length: 12 }, (_, i) => nowYear - 8 + i);
    return all.filter(
      (y) => (maxYear == null || y <= maxYear) && (minYear == null || y >= minYear),
    );
  }, [maxYear, minYear]);

  const monthOptions = useMemo(() => {
    return MONTHS.map((m, idx) => ({ m, idx })).filter(({ idx }) => {
      if (maxYear != null && year === maxYear && idx > maxMonth) return false;
      if (minYear != null && year === minYear && idx < minMonth) return false;
      return true;
    });
  }, [year, maxYear, maxMonth, minYear, minMonth]);

  const atMaxMonth = maxYear != null && year === maxYear && month === maxMonth;
  const atMaxYear = maxYear != null && year >= maxYear;
  const atMinMonth = minYear != null && year === minYear && month === minMonth;
  const atMinYear = minYear != null && year <= minYear;

  const handleNextMonth = () => {
    if (atMaxMonth) return;
    goToNextMonth();
  };
  const handleNextYear = () => {
    if (atMaxYear) return;
    goToNextYear();
  };
  const handlePrevMonth = () => {
    if (atMinMonth) return;
    goToPrevMonth();
  };
  const handlePrevYear = () => {
    if (atMinYear) return;
    goToPrevYear();
  };

  const visibleMonths = useMemo(() => {
    if (!calendar?.months) return calendar?.months;
    return calendar.months.filter((m) => {
      if (isRelieved && year === maxYear && m.month > maxMonth) return false;
      if (minYear != null && year === minYear && m.month < minMonth) return false;
      return true;
    });
  }, [calendar, isRelieved, year, maxYear, maxMonth, minYear, minMonth]);

  const [selectedAnnualCell, setSelectedAnnualCell] = useState(null);
  useEffect(() => {
    setSelectedAnnualCell(null);
  }, [year, viewMode]);

  // The day currently open in the Edit modal — holds the calendar API's
  // per-day info object (date, status, leaveType, isHalfDay, loginTime,
  // logoutTime, recordId, leaveId) directly, so EditDayModal doesn't need
  // to know whether it came from the monthly grid or an annual MiniMonth.
  const [editingDay, setEditingDay] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [bulkTarget, setBulkTarget] = useState(null); // { month } | null
  // Late-coming switches (month / single date) — super admin only.
  const canEditLate = isSuperAdminUser();
  const [lateBusy, setLateBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const openBulkForMonth = useCallback((m) => setBulkTarget({ month: m }), []);

  // Month-wise salary (Annual view only) — toggled on by the "View Salary"
  // button. Keyed by calendar month index (0-11) -> that month's Payroll
  // record for this staff member, refetched whenever the visible year
  // changes so it never shows a stale year's figures.
  // Salary is always shown in the Annual view (the old View/Hide Salary
  // toggle was removed).
  const showSalary = true;
  const [salaryLoading, setSalaryLoading] = useState(false);
  const [salaryByMonth, setSalaryByMonth] = useState({});

  // Advances given to this staff member, grouped by "YYYY-M" (month 0-11)
  // of the advance date — the Monthly view's summary panel shows the ones
  // given in the month on the selected tab. Rejected advances are ignored.
  // Referral organisation (set by the super admin in Staff Details).
  const [staffReferral, setStaffReferral] = useState(staff.referral || null);
  useEffect(() => {
    if (!staff.staffId) return;
    let cancelled = false;
    staffService
      .getById(staff.staffId)
      .then((res) => {
        if (!cancelled) setStaffReferral(res.data?.data?.referral || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [staff.staffId, refreshKey]);

  const [advancesByMonth, setAdvancesByMonth] = useState({});
  const [advancesLoading, setAdvancesLoading] = useState(false);
  useEffect(() => {
    if (!staff.staffId) return;
    let cancelled = false;
    setAdvancesLoading(true);
    advanceService
      .getAll({ employeeId: staff.staffId })
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.data || [];
        const grouped = {};
        list
          .filter((a) => a.status !== "rejected")
          .forEach((a) => {
            const d = new Date(a.date);
            if (Number.isNaN(d.getTime())) return;
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            (grouped[key] = grouped[key] || []).push(a);
          });
        Object.values(grouped).forEach((arr) => arr.sort((x, y) => new Date(x.date) - new Date(y.date)));
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
  }, [staff.staffId, refreshKey]);

  // Full & Final Paid Leave for a staff member who has LEFT: every month's
  // Paid Leave still left (the same figure as the Settlement Statement's
  // leave encashment). It is added to Total payable ONLY in the relieving
  // month — ordinary months never include Paid Leave in Total payable.
  const [finalPaidLeave, setFinalPaidLeave] = useState(null);
  useEffect(() => {
    if (!isRelieved || !staff.staffId) {
      setFinalPaidLeave(null);
      return;
    }
    let cancelled = false;
    staffService
      .getSettlement(staff.staffId)
      .then((res) => {
        const fs = res.data?.data?.finalSettlement;
        if (cancelled || !fs) return;
        setFinalPaidLeave({
          days: Number(fs.leaveEncashmentDays) || 0,
          amount: Number(fs.leaveEncashment) || 0,
          months: fs.leaveEncashmentMonths || [],
        });
      })
      .catch(() => {
        if (!cancelled) setFinalPaidLeave(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isRelieved, staff.staffId, refreshKey]);

  // Bumped for every salary fetch so a slow, out-of-date response can never
  // overwrite a newer one.
  const salaryReqId = useRef(0);

  // `onlyMonth` (0-11) refreshes just that month and merges it into the
  // existing figures — used by the Monthly view, which only shows one month
  // at a time. Omit it to (re)load the whole year for the Annual view.
  const loadSalary = useCallback(async (onlyMonth = null) => {
    const reqId = ++salaryReqId.current;
    setSalaryLoading(true);
    try {
      const res = await payrollService.getAll({
        employeeId: staff.staffId,
        periodFrom: `${year}-01`,
        periodTo: `${year}-12`,
      });
      const records = res.data?.data || res.data || [];
      const byMonth = {};
      records.forEach((rec) => {
        const monthIdx = Number(String(rec.period).split("-")[1]) - 1;
        if (monthIdx < 0 || monthIdx > 11) return;
        // Normalize a saved Payroll doc's field names to match the live
        // estimate shape below (payableDays/totalDays/unpaidDays), so
        // SalaryBoxContent can show a "why is this low" tooltip either way.
        // A saved doc has no day-by-day list, only the attendanceInfo counts.
        byMonth[monthIdx] = {
          ...rec,
          ...breakdownFromSaved(rec),
          payableDays: rec.attendanceInfo?.payableDays,
          totalDays: rec.attendanceInfo?.totalWorkingDays,
          unpaidDays: rec.attendanceInfo?.unpaidLeaves,
          leaveDeduction: rec.attendanceInfo?.leaveDeduction ?? 0,
        };
      });

      // No saved Payroll doc for a month just means nobody has generated
      // one yet — it doesn't mean there's nothing to show. For any month
      // that's already happened (not in the future) and isn't saved, fetch
      // a live estimate from the same calculate/preview endpoint the "Add
      // Payroll" screen uses, so "View Salary" always shows a figure.
      //
      // A month WITH a saved Payroll doc is recalculated live too: the saved
      // doc is a snapshot taken when payroll was generated, so after an
      // admin edits a day (e.g. Unpaid -> Holiday) it would keep showing
      // the old figure (14,516.13 instead of 15,000). The live figure is
      // shown, and the saved amount is kept alongside for comparison.
      const now = new Date();
      const monthsNeedingEstimate = Array.from({ length: 12 }, (_, m) => m).filter((m) => {
        if (onlyMonth !== null && m !== onlyMonth) return false;
        if (year > now.getFullYear()) return false;
        if (year === now.getFullYear() && m > now.getMonth()) return false;
        return true;
      });

      const estimates = await Promise.allSettled(
        monthsNeedingEstimate.map((m) => {
          const period = `${year}-${String(m + 1).padStart(2, "0")}`;
          return payrollService
            .calculate(staff.staffId, period)
            .then((r) => ({ month: m, data: r.data?.data || r.data }));
        }),
      );
      estimates.forEach((result) => {
        // A month can fail to calculate (e.g. before the staff member
        // joined, or no Basic Payroll configured for them yet) — in that
        // case just leave it out, so it still falls back to the normal
        // "No salary record" message instead of showing a wrong figure.
        if (result.status === "fulfilled" && result.value?.data) {
          const { month, data } = result.value;
          const saved = byMonth[month];
          if (saved) {
            // Same basis as the saved doc: live attendance-based salary,
            // minus the advance recovered on that doc, plus its own
            // allowances/deductions.
            const live =
              Number(data.netSalary || 0) -
              Number(saved.advanceDeduction || 0) +
              Number(saved.totalAllowance || 0) -
              Number(saved.totalDeduction || 0);
            const liveRounded = Math.round(Math.max(0, live) * 100) / 100;
            const savedNet = Number(saved.netSalary || 0);
            byMonth[month] = {
              ...saved,
              ...breakdownFromLive(data),
              netSalary: liveRounded,
              savedNetSalary: savedNet,
              differsFromSaved: Math.abs(liveRounded - savedNet) >= 0.01,
              payableDays: data.payableDays,
              payableNote: data.payableNote || null,
              totalDays: data.totalDaysInMonth,
              unpaidDays: data.unpaidLeaveDays,
              leaveDeduction: data.leaveDeduction ?? 0,
              lateDeduction: data.lateDeduction ?? 0,
              lateDeductionEnabled: data.lateDeductionEnabled !== false,
              unmarkedDates: data.unmarkedDates,
              halfDayDates: data.halfDayDates,
            };
            return;
          }
          byMonth[month] = {
            ...breakdownFromLive(data),
            netSalary: data.finalSalary ?? data.netSalary,
            isEstimate: true,
            payableDays: data.payableDays,
            payableNote: data.payableNote || null,
            totalDays: data.totalDaysInMonth,
            unpaidDays: data.unpaidLeaveDays,
            leaveDeduction: data.leaveDeduction ?? 0,
              lateDeduction: data.lateDeduction ?? 0,
              lateDeductionEnabled: data.lateDeductionEnabled !== false,
            // Dates counted unpaid because the calendar had NO attendance,
            // leave or holiday record for them at all — as opposed to an
            // explicit approved Unpaid leave. If a date shows up here that
            // the calendar/attendance sheet clearly marks present, that
            // means the imported attendance for that day isn't linked to
            // this staff member's login account (wrong/stale userId),
            // which is the most common cause of a much-lower-than-expected
            // month.
            unmarkedDates: data.unmarkedDates,
            // Half Days with nothing covering the other half — 0.5 day each.
            halfDayDates: data.halfDayDates,
          };
        }
      });

      if (reqId === salaryReqId.current) {
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
      }
    } catch (err) {
      if (reqId === salaryReqId.current) {
        showToast("error", err.response?.data?.message || "Failed to load salary");
      }
    } finally {
      if (reqId === salaryReqId.current) setSalaryLoading(false);
    }
  }, [year, staff.staffId]);

  // A different year/staff starts from a clean slate.
  useEffect(() => {
    salaryReqId.current++; // drop any in-flight response for the old year/staff
    setSalaryByMonth({});
  }, [year, staff.staffId]);

  // BUGFIX ("calendar shows 4 unpaid days but salary deducted 5"): the
  // salary figures used to be fetched once and cached for the whole year
  // ("already loaded" early-return), so after editing/deleting/importing a
  // leave day the calendar updated (4 unpaid) while the salary strip kept
  // the OLD estimate (5 unpaid days). Whenever the calendar data reloads,
  // throw the cached figures away and — if the salary strip is open —
  // recalculate them from the current data.
  useEffect(() => {
    if (!calendar) return;
    if (calendar.mode === "annual") {
      setSalaryByMonth({});
      loadSalary();
    } else {
      // Monthly: the summary panel on the right always shows this month's
      // salary, so load (just) this month whenever the calendar changes.
      loadSalary(calendar.month);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar]);

  // Day-by-day info for a given month, wherever it's currently loaded —
  // calendar.months[m] in Annual view, or calendar.days for the single
  // month currently shown in Monthly view.
  const getMonthDaysMap = useCallback(
    (m) => {
      const fromAnnual = calendar?.months?.find((mm) => mm.month === m);
      if (fromAnnual?.days) return fromAnnual.days;
      if (calendar?.days && m === month) return calendar.days;
      return {};
    },
    [calendar, month],
  );

  const cells = useMemo(() => {
    if (!calendar?.days) return [];
    const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = Object.keys(calendar.days).length;
    return [
      ...Array(firstDow).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
  }, [calendar, year, month]);

  // Where the Monthly view tucks the salary box: the blank cells before
  // day 1 (leading) or after the last day (trailing) when at least 2 wide,
  // otherwise only the detail line under the grid is shown.
  const monthFirstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const monthTrailingBlanks = (7 - (cells.length % 7)) % 7;
  const monthLastRow = Math.max(1, Math.ceil(cells.length / 7));
  // The Monthly view now shows salary in the right-hand summary panel, so
  // the old salary box squeezed into the blank calendar cells is off.
  const monthSalaryPlacement = "none";

  const handleDayClick = (day) => {
    if (!day) return;
    const info = calendar.days[day];
    if (!info || !DELETABLE_STATUSES.includes(info.status)) return;
    setSelectedDay(selectedDay === day ? null : day);
  };

  // Stable callbacks (MiniMonth passes the month back as 2nd argument) so
  // the memoized MiniMonth grids in the Annual view only re-render the
  // month that actually changed instead of all 12 on every click.
  const handleAnnualDayClick = useCallback((day, month) => {
    if (!day) return;
    setSelectedAnnualCell((prev) =>
      prev && prev.month === month && prev.day === day
        ? null
        : { month, day },
    );
  }, []);

  const handleEditClick = (day) => {
    if (!day) return;
    const info = calendar?.days?.[day];
    if (!info || !EDITABLE_STATUSES.includes(info.status)) return;
    setEditingDay(info);
  };

  const handleAnnualEditClick = useCallback(
    (day, month) => {
      if (!day) return;
      const info = calendar?.months?.find((mm) => mm.month === month)?.days?.[day];
      if (!info || !EDITABLE_STATUSES.includes(info.status)) return;
      setEditingDay(info);
    },
    [calendar],
  );

  // Applying leave for a future date (e.g. booking November or April ahead
  // of time) is allowed as long as the staff member has the balance for
  // it, but the backend won't commit a future-dated day without an
  // explicit go-ahead first — it comes back with `requiresConfirmation`
  // instead of creating anything. This wraps that round trip: ask once via
  // a plain confirm dialog, and only resend with `confirmed: true` if the
  // person says yes. A past/today date never trips this — it resolves on
  // the first call.
  const applyLeaveWithConfirmation = async (payload) => {
    const res = await attendanceService.applyLeave(payload);
    if (res.data?.requiresConfirmation) {
      const proceed = window.confirm(
        `${res.data.message || "This date is in the future."} Apply this leave now?`,
      );
      if (!proceed) return res;
      return attendanceService.applyLeave({ ...payload, confirmed: true });
    }
    return res;
  };

  // Admin-only edit of a single day. One server call does the whole
  // change (validate -> replace old record -> re-check sandwich Sundays),
  // so the day is never left blank if the change is refused — e.g. when
  // there's no Paid/Sick/Casual left, which are fixed counts.
  const handleEditSubmit = async ({ day, newStatus, loginTime, logoutTime, reason }) => {
    if (!day) return false;
    setEditBusy(true);
    try {
      const res = await attendanceService.changeDayStatus({
        staffId: staff.staffId,
        date: day.date,
        status: newStatus,
        loginTime: loginTime || undefined,
        logoutTime: logoutTime || undefined,
        reason,
      });
      if (res.data?.success === false) {
        showToast("error", res.data?.message || `Could not update ${day.date}`);
        return false;
      }
      showToast("success", res.data?.message || `${day.date} updated successfully`);
      setEditingDay(null);
      setSelectedDay(null);
      setSelectedAnnualCell(null);
      await fetchCalendar();
      return true;
    } catch (err) {
      // Nothing was changed on the server — keep the modal open so the
      // admin can pick a different status.
      showToast(
        "error",
        err.response?.data?.message || `Could not update ${day.date} — nothing was changed`,
      );
      return false;
    } finally {
      setEditBusy(false);
    }
  };

  // Super admin: deduct / don't deduct late coming for the whole month.
  const handleLateMonthToggle = async (deductLate) => {
    setLateBusy(true);
    try {
      const period = `${year}-${String(month + 1).padStart(2, "0")}`;
      const res = await lateDeductionService.setMonth({ staffId: staff.staffId, period, deductLate });
      showToast("success", res.data?.message || "Late-coming setting saved");
      await fetchCalendar(); // salary reloads with the calendar
    } catch (err) {
      showToast("error", err.response?.data?.message || "Could not change the late-coming setting");
    } finally {
      setLateBusy(false);
    }
  };

  // Super admin: waive / deduct late coming for one date.
  const handleLateDayToggle = async (date, waived) => {
    setLateBusy(true);
    try {
      const res = await lateDeductionService.setDay({ staffId: staff.staffId, date, waived });
      showToast("success", res.data?.message || `${date} updated`);
      await fetchCalendar();
    } catch (err) {
      showToast("error", err.response?.data?.message || `Could not update ${date}`);
    } finally {
      setLateBusy(false);
    }
  };

  // Super admin: lunch not taken / minutes of lunch taken for one date.
  const handleLateLunchChange = async (date, lunchSkipped, lunchTakenMinutes = null) => {
    setLateBusy(true);
    try {
      const res = await lateDeductionService.setLunch({
        staffId: staff.staffId,
        date,
        lunchSkipped,
        lunchTakenMinutes,
      });
      showToast("success", res.data?.message || `${date} lunch updated`);
      await fetchCalendar();
    } catch (err) {
      showToast("error", err.response?.data?.message || `Could not update lunch for ${date}`);
    } finally {
      setLateBusy(false);
    }
  };

  const handleDeleteAttendance = async () => {
    const isAnnual = viewMode === "annual";
    const info = isAnnual
      ? selectedAnnualCell &&
        calendar?.months?.[selectedAnnualCell.month]?.days?.[
          selectedAnnualCell.day
        ]
      : selectedDay && calendar?.days?.[selectedDay];

    if (!info) {
      showToast("error", "Click a date on the calendar first, then delete it");
      return;
    }
    if (!calendar?.attendanceUserId) {
      showToast("error", "This Staff has no linked login account, so attendance can't be recorded or deleted.");
      return;
    }
    // The parent refreshes this calendar (via refreshKey) once the delete
    // is done — no second fetch needed here.
    await onDeleted(calendar.attendanceUserId, info.date);
    setSelectedDay(null);
    setSelectedAnnualCell(null);
  };

  // Called by BulkMarkMonthModal on submit. For leave types, the backend's
  // range mode already skips Sundays/holidays/existing attendance/leave on
  // its own, so we just forward the range. For Present/Half Day there's no
  // range endpoint, so we build the list of days ourselves — using the
  // month's calendar data we already have loaded — and only send the days
  // that have no attendance/leave/holiday on them yet, via the bulk
  // attendance import endpoint.
  const handleBulkSubmit = async ({ kind, status, leaveType, startDate, endDate, loginTime, logoutTime, reason }) => {
    setBulkBusy(true);
    try {
      if (kind === "leave") {
        if (!staff.staffId) {
          showToast("error", "Missing staff record — can't apply leave.");
          return false;
        }
        try {
          const res = await applyLeaveWithConfirmation({
            userId: staff.staffId,
            leaveDate: startDate,
            endDate,
            reason,
            leaveType,
          });
          if (res.data?.success === false) {
            showToast("error", res.data?.message || "Failed to apply leave for this range");
            return false;
          }
          showToast("success", res.data?.message || "Leave applied for the selected range");
        } catch (err) {
          showToast("error", err.response?.data?.message || "Failed to apply leave for this range");
          return false;
        }
      } else {
        if (!calendar?.attendanceUserId) {
          showToast("error", "This staff has no linked login account, so attendance can't be recorded.");
          return false;
        }
        const daysMap = getMonthDaysMap(bulkTarget?.month);
        const dates = eachDateInRange(startDate, endDate);
        const rows = [];
        let skippedLocal = 0;
        dates.forEach((dateStr) => {
          const dayNum = Number(dateStr.slice(-2));
          const info = daysMap[dayNum];
          const dow = new Date(`${dateStr}T00:00:00`).getDay();
          if (dow === 0 || info?.status) {
            skippedLocal++;
            return;
          }
          rows.push({
            userId: calendar.attendanceUserId,
            date: dateStr,
            status: status === "half" ? "half-day" : undefined,
            loginTime: `${dateStr}T${loginTime}:00`,
            logoutTime: status === "half" ? undefined : `${dateStr}T${logoutTime}:00`,
          });
        });

        if (rows.length === 0) {
          showToast("error", "Every day in that range is a Sunday, a holiday, or already marked — nothing to add.");
          return false;
        }

        try {
          const res = await attendanceService.importAttendance(rows);
          const { importedCount = 0, failedCount = 0 } = res.data || {};
          const skippedTotal = skippedLocal + failedCount;
          showToast(
            importedCount > 0 ? "success" : "error",
            `${importedCount} day(s) marked as ${status === "half" ? "Half Day" : "Present"}` +
              (skippedTotal > 0 ? `, ${skippedTotal} day(s) skipped (already marked / Sunday / holiday).` : "."),
          );
          if (importedCount === 0) return false;
        } catch (err) {
          showToast("error", err.response?.data?.message || "Failed to mark attendance for this range");
          return false;
        }
      }

      await fetchCalendar();
      return true;
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={onBack}>
            <ChevronLeft size={16} className="mr-1" /> Back to Staff List
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleDeleteAttendance}
            title="Click a Present/Half Day/Leave date on the calendar below, then click here to delete it"
          >
            <Trash2 size={16} className="mr-1" /> Delete Attendance
          </Button>
          {viewMode === "monthly" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openBulkForMonth(month)}
              title="Mark Present/Half Day/Leave for every unmarked day in a date range within this month"
            >
              <CalendarRange size={16} className="mr-1" /> Bulk Mark Month
            </Button>
          )}
        </div>
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
          <button
            onClick={() => setViewMode("monthly")}
            className={`px-4 py-1.5 text-sm font-medium cursor-pointer ${
              viewMode === "monthly" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Monthly          </button>
          <button
            onClick={() => setViewMode("annual")}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-300 cursor-pointer ${
              viewMode === "annual" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Annual
          </button>
        </div>
      </div>

      <div className={`bg-white rounded-2xl border border-gray-200 shadow ${isAnnualView ? "p-3" : "p-4"}`}>
        <div className={`flex flex-wrap items-center justify-between gap-3 ${isAnnualView ? "mb-2" : "mb-4"}`}>
          <h3 className={isAnnualView ? "text-base font-bold text-gray-800" : "text-lg font-bold text-gray-800"}>
              {viewMode === "annual" ? "Annual View" : "Monthly View"}{" "}
            <span className={isAnnualView ? "text-indigo-600 font-medium text-xs" : "text-indigo-600 font-medium text-base"}>
              (Taken — Paid: {calendar?.paidCount ?? 0}, Sick: {calendar?.sickCount ?? 0}, Casual: {calendar?.casualCount ?? 0},
              Unpaid: {calendar?.unpaidCount ?? 0}, Swap: {calendar?.swapCount ?? 0})
            </span>
            <LeaveBalanceLine balance={calendar?.leaveBalance} leftBeforeConfirmation={leftBeforeConfirmation(staff)} />
            <ReferralLine
              referral={staffReferral}
              joinKey={staff.date ? new Date(new Date(staff.date).getTime() + 19800000).toISOString().slice(0, 10) : null}
              small={isAnnualView}
            />
            <span className={isAnnualView ? "block text-emerald-700 font-medium text-xs mt-0.5" : "block text-emerald-700 font-medium text-sm mt-1"}>
              Total Working Days: {calendar?.totalWorkingDays ?? 0}{" "}
              {/* <span className="text-gray-400 font-normal">
                (Days Elapsed: {calendar?.elapsedCalendarDays ?? 0} − Unpaid Leave: {calendar?.totalLeaveTaken ?? 0}; Present: {calendar?.presentCount ?? 0}
                {calendar?.halfCount ? ` + Half Day: ${calendar.halfCount}` : ""})
              </span> */}
            </span>
          </h3>
          <div className="flex items-center gap-2">
            {isAnnualView && (
              <TotalPaidLeaveBadge
                paidLeaveValue={calendar?.paidLeaveValue}
                year={year}
                loading={loading && !calendar}
              />
            )}
            <button
              onClick={viewMode === "annual" ? handlePrevYear : handlePrevMonth}
              disabled={viewMode === "annual" ? atMinYear : atMinMonth}
              title={viewMode === "annual" ? "Previous year" : "Previous month"}
              className="p-2 rounded-full hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <ChevronLeft size={18} />
            </button>

            <select
              value={year}
              onChange={(e) =>
                viewMode === "annual" ? goToYear(Number(e.target.value)) : goToMonth(Number(e.target.value), month)
              }
              className="text-sm border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              aria-label="Jump to year"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            <button
              onClick={viewMode === "annual" ? handleNextYear : handleNextMonth}
              disabled={viewMode === "annual" ? atMaxYear : atMaxMonth}
              className="p-2 rounded-full hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {loading ? (
          // Only shown for a month/year that isn't cached yet — a month
          // viewed before renders instantly (see useMRCalendar).
          <Spinner />
        ) : !calendar ? (
          // A failed/timed-out fetch (this endpoint can be slow — see the
          // timeout comment in attendanceService.getStaffCalendar) used to
          // leave this area completely blank once loading finished, with
          // no spinner and no indication anything had gone wrong. Show a
          // visible retry instead so it's obvious what happened and the
          // user isn't left waiting on nothing.
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-gray-500">
            <p className="text-sm">{error || "Couldn't load this calendar."}</p>
            <Button variant="outline" size="sm" onClick={fetchCalendar}>
              Retry
            </Button>
          </div>
        ) : viewMode === "annual" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {visibleMonths?.map((m) => (
              <MiniMonth
                key={`${year}-${m.month}`}
                year={year}
                month={m.month}
                days={m.days}
                isCurrentMonth={m.isCurrentMonth}
                today={m.today}
                selectedDay={selectedAnnualCell?.month === m.month ? selectedAnnualCell.day : null}
                onDayClick={handleAnnualDayClick}
                onEditClick={handleAnnualEditClick}
                onMonthDoubleClick={openBulkForMonth}
                showSalary={showSalary}
                salary={salaryByMonth[m.month] || null}
                paidLeave={calendar?.paidLeaveValue?.[m.month] || null}
              />
            ))}
          </div>
        ) : (
          <>
            {/* One tab per month of the selected year — click to open it. */}
            <div className="flex gap-1 overflow-x-auto pb-2 mb-4 border-b border-gray-100" role="tablist">
              {MONTHS.map((name, idx) => {
                const allowed = monthOptions.some((o) => o.idx === idx);
                const active = idx === month;
                const hasAdvance = !!advancesByMonth[`${year}-${idx}`];
                return (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    disabled={!allowed}
                    onClick={() => goToMonth(year, idx)}
                    title={allowed ? `${name} ${year}` : "Outside joining / relieving dates"}
                    className={`relative shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? "bg-blue-600 text-white shadow-sm"
                        : allowed
                        ? "bg-gray-50 text-gray-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
                        : "bg-gray-50 text-gray-300 cursor-not-allowed"
                    }`}
                  >
                    {name.slice(0, 3)}
                    {hasAdvance && (
                      <span
                        className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${active ? "bg-amber-300" : "bg-orange-500"}`}
                        aria-label="Advance given this month"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5">
            <div>
            <div className="grid grid-cols-7 gap-2 text-center text-sm font-medium text-gray-500 mb-2">
              {SHORT_DAYS.map((d) => (
                <div key={d} className={d === "Sun" ? "text-red-500" : ""}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {monthSalaryPlacement === "leading" && (
                <div
                  style={{ gridRow: 1, gridColumn: `1 / span ${monthFirstDow}` }}
                  className="h-full min-h-[52px] rounded-lg border border-dashed border-blue-300 bg-blue-50 flex flex-col items-center justify-center px-1 text-center leading-tight"
                  title="This month's salary"
                >
                  <SalaryBoxContent
                    salary={salaryByMonth[month] || null}
                    pl={calendar?.paidLeaveValue?.[month] || null}
                    large
                  />
                </div>
              )}
              {monthSalaryPlacement === "trailing" && (
                <div
                  style={{
                    gridRow: monthLastRow,
                    gridColumn: `${8 - monthTrailingBlanks} / span ${monthTrailingBlanks}`,
                  }}
                  className="h-full min-h-[52px] rounded-lg border border-dashed border-blue-300 bg-blue-50 flex flex-col items-center justify-center px-1 text-center leading-tight"
                  title="This month's salary"
                >
                  <SalaryBoxContent
                    salary={salaryByMonth[month] || null}
                    pl={calendar?.paidLeaveValue?.[month] || null}
                    large
                  />
                </div>
              )}
              {cells.map((day, idx) => {
                if (day === null) return null; // days are positioned explicitly below
                const info = day ? calendar.days[day] : null;
                const isToday = calendar?.isCurrentMonth && calendar?.today === day;
                const hasTooltip = info && TOOLTIP_STATUSES.includes(info.status);
                const isEditable = info && EDITABLE_STATUSES.includes(info.status);
                const isSplit = !!info?.isHalfDayTopUp;
                return (
                  <div
                    key={`${year}-${month}-${day || idx}`}
                    className="relative group"
                    style={{
                      gridRow: Math.floor((monthFirstDow + day - 1) / 7) + 1,
                      gridColumn: ((monthFirstDow + day - 1) % 7) + 1,
                    }}
                  >
                    <button
                      onClick={() => handleDayClick(day)}
                      disabled={!day}
                      style={isSplit ? dayCellSplitStyle(info) : undefined}
                      className={`w-full min-h-[52px] rounded-lg border font-medium text-sm transition-colors ${
                        day ? dayCellClasses(info?.status, isToday, selectedDay === day, isSplit) : "border-transparent"
                      } ${hasTooltip ? "cursor-pointer" : "cursor-default"}`}
                    >
                      {day || ""}
                    </button>
                    {isEditable && <DayEditButton onClick={() => handleEditClick(day)} />}
                    {(info?.isHalfDay || isSplit) && (
                      <span
                        className="pointer-events-none absolute top-1 right-1 w-4 h-4 rounded-full bg-white text-[9px] font-bold leading-none flex items-center justify-center border border-gray-400 text-gray-700"
                        title={
                          isSplit
                            ? `Worked Half Day, topped up with ${info.topUpLeaveType || "leave"}`
                            : "Half Day"
                        }
                      >
                        ½
                      </span>
                    )}
                    {info?.late && (
                      <LateDayBadge late={info.late} monthEnabled={calendar?.lateSummary?.enabled !== false} />
                    )}
                    {hasTooltip && (
                      <DayTooltip
                        info={info}
                        align={(monthFirstDow + day - 1) % 7 <= 1 ? "left" : (monthFirstDow + day - 1) % 7 >= 5 ? "right" : "center"}
                        below={Math.floor((monthFirstDow + day - 1) / 7) === 0}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            </div>

            <MonthSummaryPanel
              monthLabel={`${MONTHS[month]} ${year}`}
              pl={calendar?.paidLeaveValue?.[month] || null}
              salary={salaryByMonth[month] || null}
              salaryLoading={salaryLoading}
              advances={advancesByMonth[`${year}-${month}`] || []}
              advancesLoading={advancesLoading}
              isRelievingMonth={isRelieved && year === maxYear && month === maxMonth}
              finalPaidLeave={finalPaidLeave}
              referral={staffReferral}
              joinDate={staff.date}
              period={`${year}-${String(month + 1).padStart(2, "0")}`}
              adminView
            />
            </div>

            <LateComingPanel
              summary={calendar?.lateSummary || null}
              monthLabel={`${MONTHS[month]} ${year}`}
              canEdit={canEditLate}
              busy={lateBusy}
              onToggleMonth={handleLateMonthToggle}
              onToggleDay={handleLateDayToggle}
              onChangeLunch={handleLateLunchChange}
            />
          </>
        )}

        <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-gray-100 ${isAnnualView ? "mt-3 pt-2" : "mt-6 pt-4"}`}>
          <div className={isAnnualView ? "flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-gray-600" : "flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-600"}>
            {LEGEND.map((l) => (
              <div key={l.label} className="flex items-center gap-1.5">
                <span className={`${isAnnualView ? "w-3 h-3" : "w-3.5 h-3.5"} rounded ${l.className}`} />
                {l.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      <EditDayModal
        isOpen={!!editingDay}
        onClose={() => !editBusy && setEditingDay(null)}
        onSubmit={handleEditSubmit}
        day={editingDay}
        holidays={holidays}
        canMarkAttendance={!!calendar?.attendanceUserId}
        leaveBalance={calendar?.leaveBalance}
      />

      <BulkMarkMonthModal
        isOpen={!!bulkTarget}
        onClose={() => !bulkBusy && setBulkTarget(null)}
        onSubmit={handleBulkSubmit}
        month={bulkTarget?.month ?? null}
        year={year}
        canMarkAttendance={!!calendar?.attendanceUserId}
        minDateOverall={joinDateObj || null}
        maxDateOverall={relievingDateObj || null}
      />
    </div>
  );
};

export default MRCalendarView;