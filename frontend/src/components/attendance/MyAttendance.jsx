// src/components/attendance/MyAttendance.jsx
// Staff self-service Attendance page. Looks and behaves like the admin
// staff calendar (StaffCalendarView) but is strictly READ-ONLY: no edit
// pencil, no delete, no bulk mark — a staff member can only look.
//
//   • Everything starts from the staff member's JOINING DATE: months before
//     it are hidden, days before it in the joining month are blank, and the
//     month/year navigation can't go further back. (Same for the relieving
//     date at the other end.)
//   • Monthly view: month tabs + day grid + the same right-hand summary
//     panel the admin sees (Paid Leave, Salary, Advance, Total payable).
//   • Annual view: every month shows its Salary and Paid Leave amount by
//     default (no "View Salary" toggle needed).
//   • Hovering any day inside the internship / probation period shows
//     "Internship period" / "Probation period" (plus the date range).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import Spinner from "../common/Spinner";
import { useMyCalendar } from "./hooks/useMyCalendar";
import { useMySalary } from "./hooks/useMySalary";
import { staffService } from "../../services/staffService";
import { SHORT_DAYS, MONTHS } from "../../utils/constants";
import MonthSummaryPanel from "./MonthSummaryPanel";
import LateComingPanel, { LateDayBadge } from "./LateComingPanel";
import {
  LEGEND,
  TOOLTIP_STATUSES,
  dayCellClasses,
  dayCellSplitStyle,
  buildStaffTimeline,
  periodForDate,
  dateKeyOf,
} from "./calendarHelpers";
import { DayTooltip, MiniMonth, LeaveBalanceLine, ReferralLine } from "./calendarGridPieces";

// Header counts that a day's status contributes to.
const COUNT_FIELD = {
  paid: "paidCount",
  sick: "sickCount",
  casual: "casualCount",
  unpaid: "unpaidCount",
  swap: "swapCount",
  present: "presentCount",
  half: "halfCount",
};

// Defensive clean-up: if the server ever returns attendance / leave /
// holiday data for days before joining (or after relieving), blank those
// days and take them back out of the header counts, so nothing before the
// joining date is shown or counted.
const sanitizeDays = (days, year, month, minKey, maxKey, counts) => {
  if (!days || (!minKey && !maxKey)) return days;
  let changed = false;
  const out = {};
  Object.entries(days).forEach(([d, info]) => {
    const key = dateKeyOf(year, month, Number(d));
    const outside = (minKey && key < minKey) || (maxKey && key > maxKey);
    if (outside && info?.status) {
      changed = true;
      const field = COUNT_FIELD[info.status];
      if (field) counts[field] = (counts[field] || 0) + (info.isHalfDay ? 0.5 : 1);
      out[d] = { ...info, status: null };
    } else {
      out[d] = info;
    }
  });
  return changed ? out : days;
};

const clampCalendar = (calendar, year, month, minKey, maxKey) => {
  if (!calendar || (!minKey && !maxKey)) return calendar;
  const removed = {};
  let next;
  if (calendar.months) {
    next = {
      ...calendar,
      months: calendar.months.map((m) => ({
        ...m,
        days: sanitizeDays(m.days, year, m.month, minKey, maxKey, removed),
      })),
    };
  } else if (calendar.days) {
    next = { ...calendar, days: sanitizeDays(calendar.days, year, month, minKey, maxKey, removed) };
  } else {
    return calendar;
  }
  Object.entries(removed).forEach(([field, n]) => {
    next[field] = Math.max(0, (Number(calendar[field]) || 0) - n);
  });
  return next;
};

const MyAttendance = () => {
  // Own Staff record: joining / internship / probation / relieving dates,
  // and the Staff _id used for payroll + advances.
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    staffService
      .getMyProfile()
      .then((res) => setProfile(res.data?.data || null))
      .catch(() => setProfile(null));
  }, []);

  const timeline = useMemo(() => buildStaffTimeline(profile), [profile]);
  const { joinKey, relieveKey, periods } = timeline;

  const {
    viewMode,
    setViewMode,
    year,
    month,
    calendar: rawCalendar,
    loading,
    notLinked,
    goToPrevMonth,
    goToNextMonth,
    goToPrevYear,
    goToNextYear,
    goToMonth,
    goToYear,
  } = useMyCalendar();

  const calendar = useMemo(
    () => clampCalendar(rawCalendar, year, month, joinKey, relieveKey),
    [rawCalendar, year, month, joinKey, relieveKey],
  );

  const isAnnualView = viewMode === "annual";

  // ── Navigation bounds (joining date → relieving date) ──────────────
  const minYear = joinKey ? Number(joinKey.slice(0, 4)) : null;
  const minMonth = joinKey ? Number(joinKey.slice(5, 7)) - 1 : null;
  const maxYear = relieveKey ? Number(relieveKey.slice(0, 4)) : null;
  const maxMonth = relieveKey ? Number(relieveKey.slice(5, 7)) - 1 : null;

  // If the page opened on a month outside the allowed range (e.g. today is
  // before the joining month shown, or after relieving), jump inside it.
  useEffect(() => {
    if (minYear != null && (year < minYear || (year === minYear && month < minMonth))) {
      goToMonth(minYear, minMonth);
    } else if (maxYear != null && (year > maxYear || (year === maxYear && month > maxMonth))) {
      goToMonth(maxYear, maxMonth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minYear, minMonth, maxYear, maxMonth]);

  const yearOptions = useMemo(() => {
    const nowYear = new Date().getFullYear();
    return Array.from({ length: 12 }, (_, i) => nowYear - 8 + i).filter(
      (y) => (minYear == null || y >= minYear) && (maxYear == null || y <= maxYear),
    );
  }, [minYear, maxYear]);

  const monthAllowed = useCallback(
    (y, idx) => {
      if (minYear != null && (y < minYear || (y === minYear && idx < minMonth))) return false;
      if (maxYear != null && (y > maxYear || (y === maxYear && idx > maxMonth))) return false;
      return true;
    },
    [minYear, minMonth, maxYear, maxMonth],
  );

  const atMinMonth = minYear != null && year === minYear && month === minMonth;
  const atMinYear = minYear != null && year <= minYear;
  const atMaxMonth = maxYear != null && year === maxYear && month === maxMonth;
  const atMaxYear = maxYear != null && year >= maxYear;

  const handlePrev = () => {
    if (isAnnualView) {
      if (!atMinYear) goToPrevYear();
    } else if (!atMinMonth) goToPrevMonth();
  };
  const handleNext = () => {
    if (isAnnualView) {
      if (!atMaxYear) goToNextYear();
    } else if (!atMaxMonth) goToNextMonth();
  };
  const handleYearSelect = (y) => {
    if (isAnnualView) return goToYear(y);
    // Keep the same month when possible, otherwise the nearest allowed one.
    let m = month;
    if (minYear != null && y === minYear && m < minMonth) m = minMonth;
    if (maxYear != null && y === maxYear && m > maxMonth) m = maxMonth;
    goToMonth(y, m);
  };

  // Annual view: hide months before joining / after relieving.
  const visibleMonths = useMemo(
    () => calendar?.months?.filter((m) => monthAllowed(year, m.month)),
    [calendar, year, monthAllowed],
  );

  // Hover label for internship / probation days. Stable reference so the
  // memoized MiniMonth grids don't all re-render.
  const getPeriod = useCallback((key) => periodForDate(periods, key), [periods]);

  // ── Salary / Paid Leave / Advances (read-only) ─────────────────────
  const employeeId = profile?._id || null;
  const { salaryByMonth, salaryLoading, loadSalary, advancesByMonth, advancesLoading } =
    useMySalary(employeeId, year, joinKey);

  // Reload the figures whenever the calendar on screen changes: the whole
  // year in Annual view (shown by default), just this month in Monthly.
  useEffect(() => {
    if (!rawCalendar || !employeeId) return;
    if (rawCalendar.mode === "annual" || rawCalendar.months) loadSalary();
    else loadSalary(rawCalendar.month ?? month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawCalendar, employeeId]);

  const monthFirstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = calendar?.days ? Object.keys(calendar.days).length : 0;

  return (
    <div className="p-4 sm:p-6">
      {/* Title and the Monthly / Annual switch share one row. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">Attendance</h1>
        </div>
        {!(notLinked && !loading) && (
          <div className="inline-flex p-1 rounded-lg bg-gray-200/70">
            {[
              { key: "monthly", label: "Monthly" },
              { key: "annual", label: "Annual" },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setViewMode(opt.key)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-all ${
                  viewMode === opt.key
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-gray-600 hover:text-gray-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {notLinked && !loading ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow p-8 text-center text-gray-500">
          No staff profile is linked to your account yet — contact your admin.
        </div>
      ) : (
        <>
          <div className={`bg-white rounded-2xl border border-gray-200 shadow ${isAnnualView ? "p-3" : "p-4"}`}>
            <div className={`flex flex-wrap items-center justify-between gap-3 ${isAnnualView ? "mb-2" : "mb-4"}`}>
              <h3 className={isAnnualView ? "text-base font-bold text-gray-800" : "text-lg font-bold text-gray-800"}>
                {isAnnualView ? "Annual View" : "Monthly View"}{" "}
                <span className={isAnnualView ? "text-indigo-600 font-medium text-xs" : "text-indigo-600 font-medium text-base"}>
                  (Taken — Paid: {calendar?.paidCount ?? 0}, Sick: {calendar?.sickCount ?? 0}, Casual: {calendar?.casualCount ?? 0},
                  Unpaid: {calendar?.unpaidCount ?? 0}, Swap: {calendar?.swapCount ?? 0})
                </span>
                <LeaveBalanceLine balance={calendar?.leaveBalance} />
                <ReferralLine referral={profile?.referral} joinKey={joinKey} small={isAnnualView} />
                <span className={isAnnualView ? "block text-emerald-700 font-medium text-xs mt-0.5" : "block text-emerald-700 font-medium text-sm mt-1"}>
                  Total Working Days: {calendar?.totalWorkingDays ?? 0}
                </span>
                {joinKey && (
                  <span className="block text-gray-400 font-normal text-xs mt-0.5">
                    Showing from your joining date:{" "}
                    {new Date(`${joinKey}T00:00:00Z`).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                    {periods.map((p) => (
                      <span key={p.type}>
                        {" "}· {p.label.replace(" period", "")}: {p.rangeText}
                      </span>
                    ))}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2">
                {isAnnualView && salaryLoading && (
                  <span className="text-xs text-gray-400">Loading salary…</span>
                )}
                <button
                  onClick={handlePrev}
                  disabled={isAnnualView ? atMinYear : atMinMonth}
                  title={isAnnualView ? "Previous year" : "Previous month"}
                  className="p-2 rounded-full hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <ChevronLeft size={18} />
                </button>
                <select
                  value={year}
                  onChange={(e) => handleYearSelect(Number(e.target.value))}
                  className="text-sm border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  aria-label="Jump to year"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <button
                  onClick={handleNext}
                  disabled={isAnnualView ? atMaxYear : atMaxMonth}
                  title={isAnnualView ? "Next year" : "Next month"}
                  className="p-2 rounded-full hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            {loading && !calendar ? (
              <Spinner />
            ) : !calendar ? (
              <div className="py-16 text-center text-sm text-gray-500">Couldn't load your calendar.</div>
            ) : isAnnualView ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {visibleMonths?.map((m) => (
                  <MiniMonth
                    key={`${year}-${m.month}`}
                    year={year}
                    month={m.month}
                    days={m.days}
                    isCurrentMonth={m.isCurrentMonth}
                    today={m.today}
                    // Salary + Paid Leave amount always shown for staff.
                    showSalary
                    salary={salaryByMonth[m.month] || null}
                    paidLeave={calendar?.paidLeaveValue?.[m.month] || null}
                    minDate={joinKey}
                    maxDate={relieveKey}
                    getPeriod={getPeriod}
                  />
                ))}
              </div>
            ) : (
              <>
                {/* One tab per month of the selected year. */}
                <div className="flex gap-1 overflow-x-auto pb-2 mb-4 border-b border-gray-100" role="tablist">
                  {MONTHS.map((name, idx) => {
                    const allowed = monthAllowed(year, idx);
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
                        title={allowed ? `${name} ${year}` : "Before your joining date"}
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
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                        const pos = {
                          gridRow: Math.floor((monthFirstDow + day - 1) / 7) + 1,
                          gridColumn: ((monthFirstDow + day - 1) % 7) + 1,
                        };
                        const key = dateKeyOf(year, month, day);
                        const beforeJoin = joinKey && key < joinKey;
                        const afterRelieve = relieveKey && key > relieveKey;
                        if (beforeJoin || afterRelieve) {
                          return (
                            <div
                              key={key}
                              style={pos}
                              title={beforeJoin ? "Before your joining date" : "After your relieving date"}
                              className="w-full min-h-[52px] rounded-lg border border-dashed border-gray-200 bg-gray-50 text-gray-300 text-sm font-medium flex items-center justify-center"
                            >
                              {day}
                            </div>
                          );
                        }
                        const info = calendar.days[day];
                        const isToday = calendar?.isCurrentMonth && calendar?.today === day;
                        const period = getPeriod(key);
                        const hasTooltip = (info && TOOLTIP_STATUSES.includes(info.status)) || !!period;
                        const isSplit = !!info?.isHalfDayTopUp;
                        return (
                          <div key={key} className="relative group" style={pos}>
                            <div
                              style={isSplit ? dayCellSplitStyle(info) : undefined}
                              className={`w-full min-h-[52px] rounded-lg border font-medium text-sm flex items-center justify-center ${dayCellClasses(
                                info?.status,
                                isToday,
                                false,
                                isSplit,
                              )} ${hasTooltip ? "cursor-help" : "cursor-default"}`}
                            >
                              {day}
                            </div>
                            {(info?.isHalfDay || isSplit) && (
                              <span
                                className="pointer-events-none absolute top-1 right-1 w-4 h-4 rounded-full bg-white text-[9px] font-bold leading-none flex items-center justify-center border border-gray-400 text-gray-700"
                                title={isSplit ? `Worked Half Day, topped up with ${info.topUpLeaveType || "leave"}` : "Half Day"}
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
                                period={period}
                                align={pos.gridColumn <= 2 ? "left" : pos.gridColumn >= 6 ? "right" : "center"}
                                below={pos.gridRow === 1}
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
                    referral={profile?.referral}
                    joinDate={profile?.date}
                    period={`${year}-${String(month + 1).padStart(2, "0")}`}
                  />
                </div>

                {/* Read-only for staff — only the super admin can change it. */}
                <LateComingPanel
                  summary={calendar?.lateSummary || null}
                  monthLabel={`${MONTHS[month]} ${year}`}
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
                {joinKey && (
                  <div className="flex items-center gap-1.5">
                    <span className={`${isAnnualView ? "w-3 h-3" : "w-3.5 h-3.5"} rounded border border-dashed border-gray-300 bg-gray-50`} />
                    Before joining
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default MyAttendance;
