// src/components/attendance/calendarGridPieces.jsx
// Shared between StaffCalendarView (admin: any staff member) and
// MyAttendance (staff self-service) so both calendars look and behave
// identically — only the data source and the admin-only actions differ.
import React from "react";
import { Pencil } from "lucide-react";
import { SHORT_DAYS, MONTHS } from "../../utils/constants";
import {
  getSplitLeaveType,
  isSplitDay,
  dayCellSplitStyle,
  formatTime,
  LEAVE_LABELS,
  dayCellClasses,
  TOOLTIP_STATUSES,
  DELETABLE_STATUSES,
  EDITABLE_STATUSES,
  PERIOD_STYLES,
  dateKeyOf,
} from "./calendarHelpers";

export const DayEditButton = ({ onClick }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    title="Edit this day"
    className="pointer-events-auto absolute -top-1.5 -left-1.5 z-10 w-5 h-5 rounded-full
      bg-white border border-gray-300 text-gray-600 shadow-sm flex items-center
      justify-center opacity-0 group-hover:opacity-100 hover:bg-indigo-50 hover:text-indigo-600
      hover:border-indigo-300 transition-opacity"
  >
    <Pencil size={10} />
  </button>
);

// `period` (optional): { type, label, rangeText } — the internship or
// probation period this day falls in. Shown as an extra line, and on its
// own for a day with no attendance/leave/holiday yet.
export const DayTooltip = ({ info, period = null }) => {
  const hasStatus = !!info && TOOLTIP_STATUSES.includes(info.status);
  if (!hasStatus && !period) return null;
  const split = hasStatus && isSplitDay(info);
  const isAttendance =
    split || info?.status === "present" || info?.status === "half";
  return (
    <div
      className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-2 w-max -translate-x-1/2
        rounded-lg bg-gray-900 px-3 py-2 text-xs text-white opacity-0 shadow-lg
        transition-opacity duration-150 group-hover:opacity-100"
    >
      {period && (
        <div className={hasStatus ? "mb-1 pb-1 border-b border-gray-700" : ""}>
          <span className={`font-semibold ${PERIOD_STYLES[period.type] || "text-gray-300"}`}>
            {period.label}
          </span>
          {period.rangeText && (
            <span className="block text-[10px] text-gray-400">{period.rangeText}</span>
          )}
        </div>
      )}
      {!hasStatus ? null : split ? (
        <>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-green-400">Worked half:</span>
            <span>
              {formatTime(info.loginTime)} – {formatTime(info.logoutTime)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-red-400">Other half:</span>
            <span>
              {LEAVE_LABELS[getSplitLeaveType(info)] || "Leave"} (0.5 day)
            </span>
          </div>
        </>
      ) : isAttendance ? (
        <>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-green-400">Sign In:</span>
            <span>{formatTime(info.loginTime)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-red-400">Sign Out:</span>
            <span>{formatTime(info.logoutTime)}</span>
          </div>
        </>
      ) : info.status === "holiday" ? (
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-gray-300">Holiday:</span>
          <span>{info.holidayName || "Holiday"}</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-gray-300">Leave:</span>
          <span>
            {LEAVE_LABELS[info.status] || "Leave"}
            {info.isHalfDay ? " (Half Day)" : ""}
          </span>
        </div>
      )}
      <div
        className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent
          border-t-gray-900"
      />
    </div>
  );
};

const fmtMoney = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const SALARY_STATUS_STYLES = {
  paid: "bg-green-100 text-green-700",
  partial: "bg-orange-100 text-orange-700",
  pending: "bg-yellow-100 text-yellow-700",
  cancelled: "bg-red-100 text-red-600",
};

// ─── Paid Leave amount for a month ("PL Amt") ─────────────────────────
// Comes from the backend (calendar payload `paidLeaveValue[month]`), so the
// PL earned per month is always the value the ADMIN set in the Leave Policy
// (paid per year / 12) — nothing is hard-coded here. Its value is that
// month's own per-day salary (basic / days in month) × PL days, e.g.
//   ₹26,500 in a 31-day month -> 1.5 × 854.84 = ₹1,282.26
//   ₹15,000 in a 30-day month -> 1.5 × 500.00 = ₹750.00
// A month that earned nothing (before confirmation, or a final month with
// fewer than 20 days worked incl. holidays) has credited: false.
const fmtDays = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return String(v);
};

const plTooltip = (pl) => {
  if (!pl) return "No paid leave earned this month";
  if (!pl.credited) return pl.reason || "No paid leave earned this month";
  return `Paid Leave earned: ${fmtDays(pl.plDays)} day${
    Number(pl.plDays) === 1 ? "" : "s"
  } × ${fmtMoney(pl.perDaySalary)}/day (${fmtMoney(pl.basicSalary)} ÷ ${pl.daysInMonth} days)`;
};

// "PL Amt: ₹1,282.26" when the month earned PL. A month that earned no PL
// (before confirmation, etc.) shows the salary DEDUCTED for unpaid leave
// instead of a bare "—": "Ded: ₹1,129.03".
export const PaidLeaveAmount = ({ pl, labelClass, valueClass, deduction = null }) => {
  if (pl?.credited) {
    return (
      <span title={plTooltip(pl)}>
        <span className={labelClass}>PL Amt:</span>{" "}
        <span className={valueClass}>{fmtMoney(pl.amount)}</span>
      </span>
    );
  }
  if (deduction != null) {
    const amt = Number(deduction) || 0;
    return (
      <span
        title={`${plTooltip(pl)}\nSalary deducted for unpaid leave this month: ${fmtMoney(amt)}`}
      >
        <span className={labelClass}>Ded:</span>{" "}
        <span className={amt > 0 ? "font-bold text-red-600" : valueClass}>
          {fmtMoney(amt)}
        </span>
      </span>
    );
  }
  return (
    <span title={plTooltip(pl)}>
      <span className={labelClass}>PL Amt:</span>{" "}
      <span className={valueClass}>—</span>
    </span>
  );
};

// Builds a hover tooltip explaining WHY a month's figure is what it is.
const salaryTooltip = (salary) => {
  if (salary.payableDays == null || salary.totalDays == null) return undefined;
  let text = `Payable ${salary.payableDays}/${salary.totalDays} day${
    salary.totalDays === 1 ? "" : "s"
  }`;
  if (salary.unpaidDays) {
    text += ` · ${salary.unpaidDays} unpaid`;
  }
  if (salary.differsFromSaved) {
    text += `\nSaved payroll: ${fmtMoney(salary.savedNetSalary)} (${
      salary.status || "saved"
    }) — calendar has changed since it was generated`;
  }
  if (salary.unmarkedDates?.length) {
    const shown = salary.unmarkedDates.slice(0, 6).join(", ");
    const extra = salary.unmarkedDates.length > 6 ? ", …" : "";
    text += `\nNo attendance/leave record found for: ${shown}${extra}`;
  }
  return text;
};

export const MonthSalaryStrip = ({ salary }) => {
  if (!salary) {
    return (
      <div className="px-3 py-2 border-t border-gray-100 text-center text-xs text-gray-400">
        No salary record
      </div>
    );
  }
  return (
    <div
      className="px-3 py-2 border-t border-gray-100 flex items-center justify-between gap-2"
      title={salaryTooltip(salary)}
    >
      <span className="text-sm font-semibold text-gray-800">
        {fmtMoney(salary.netSalary)}
      </span>
    </div>
  );
};

// Amount + status, used for the salary box inside a month grid.
export const SalaryBoxContent = ({ salary, pl = null, large = false }) =>
  salary ? (
    <span title={salaryTooltip(salary)}>
      <span
        className={`${large ? "text-base" : "text-[11px]"} font-semibold text-blue-800`}
      >
        {fmtMoney(salary.netSalary)}
      </span>
      {large && (
        <span className="block text-[11px]">
          <PaidLeaveAmount pl={pl} deduction={salary.leaveDeduction} labelClass="font-medium text-blue-400" valueClass="font-semibold text-blue-700" />
        </span>
      )}
      {large && salary.payableDays != null && salary.totalDays != null && (
        <span className="block text-[11px] font-medium text-blue-400">
          {salary.payableDays}/{salary.totalDays} days paid
          {salary.unpaidDays ? ` · ${salary.unpaidDays} unpaid` : ""}
        </span>
      )}
      {salary.differsFromSaved && (
        <span
          className={`block ${large ? "text-[11px]" : "text-[9px]"} font-medium text-orange-500`}
        >
          Saved {fmtMoney(salary.savedNetSalary)}
        </span>
      )}
    </span>
  ) : (
    <span
      className={`${large ? "text-xs" : "text-[9px]"} font-medium text-blue-400`}
    >
      No salary
    </span>
  );

const MiniMonthInner = ({
  year,
  month,
  days,
  isCurrentMonth,
  today,
  selectedDay,
  onDayClick,
  onEditClick,
  onMonthDoubleClick,
  showSalary = false,
  salary = null,
  // This month's entry from the calendar payload's `paidLeaveValue`.
  paidLeave = null,
  // Optional (staff self-service): "YYYY-MM-DD" bounds — days before the
  // joining date / after the relieving date render as empty, muted cells
  // with no status, holiday or tooltip.
  minDate = null,
  maxDate = null,
  // Optional: (dateKey) => internship/probation period for the hover tooltip.
  getPeriod = null,
}) => {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = Object.keys(days).length;
  const cells = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // "January" -> "Jan"
  const shortMonth = MONTHS[month].slice(0, 3);

  const salaryTitle = salary
    ? salary.isEstimate
      ? "Estimated — calculated live, no payroll saved for this month yet"
      : salary.differsFromSaved
      ? `Current figure from the calendar. Saved payroll (${
          salary.status || "pending"
        }): ${fmtMoney(salary.savedNetSalary)}`
      : `Payroll status: ${salary.status || "pending"}`
    : "No salary record for this month";

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Unified light-blue header block: month name + weekday row */}
      <div>
        <button
          type="button"
          onDoubleClick={
            onMonthDoubleClick ? () => onMonthDoubleClick(month) : undefined
          }
          title={
            onMonthDoubleClick
              ? "Double-click to bulk mark attendance/leave for this month"
              : undefined
          }
          className={`w-full flex items-center justify-between gap-2 text-base font-semibold text-sky-800 py-1.5 px-3 transition-colors bg-sky-300 ${
            onMonthDoubleClick
              ? "cursor-pointer select-none hover:bg-sky-500"
              : "cursor-default"
          }`}
        >
          {/* Short month name on the left: Jan, Feb, … */}
          <span>{shortMonth}</span>

          {/* Sal + PL Amount on the right (only while "View Salary" is on) */}
          {showSalary &&
            (salary ? (
              <span className="flex items-baseline gap-3 text-xs whitespace-nowrap">
                <span title={salaryTitle}>
                  <span className="font-medium text-sky-700">Sal:</span>{" "}
                  <span className="font-bold text-sky-900">
                    {fmtMoney(salary.netSalary)}
                  </span>
                  {salary.differsFromSaved && (
                    <span
                      className="ml-0.5 text-orange-500"
                      aria-label="Differs from saved payroll"
                    >
                      *
                    </span>
                  )}
                </span>
                <PaidLeaveAmount
                  pl={paidLeave}
                  deduction={salary.leaveDeduction}
                  labelClass="font-medium text-sky-700"
                  valueClass="font-bold text-sky-900"
                />
              </span>
            ) : (
              <span className="text-xs font-medium text-sky-700" title={salaryTitle}>
                No salary
              </span>
            ))}
        </button>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-sky-700 pb-1 px-1">
          {SHORT_DAYS.map((d) => (
            <div key={d}>{d[0]}</div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 p-3">
        {cells.map((day, idx) => {
          if (day === null) return null; // leading blanks: days are positioned explicitly
          const key = dateKeyOf(year, month, day);
          const outOfRange =
            (minDate && key < minDate) || (maxDate && key > maxDate);
          if (outOfRange) {
            return (
              <div
                key={`${year}-${month}-${day}`}
                style={{
                  gridRow: Math.floor((firstDow + day - 1) / 7) + 1,
                  gridColumn: ((firstDow + day - 1) % 7) + 1,
                }}
                title={minDate && key < minDate ? "Before your joining date" : "After your relieving date"}
                className="w-full aspect-square rounded text-sm flex items-center justify-center border border-dashed border-gray-200 bg-gray-50 text-gray-300"
              >
                {day}
              </div>
            );
          }
          const info = day ? days[day] : null;
          const period = getPeriod ? getPeriod(key) : null;
          const hasTooltip =
            (info && TOOLTIP_STATUSES.includes(info.status)) || !!period;
          const isDeletable =
            onDayClick && info && DELETABLE_STATUSES.includes(info.status);
          const isEditable =
            onEditClick && info && EDITABLE_STATUSES.includes(info.status);
          const isToday = isCurrentMonth && today === day;
          const isSelected = isDeletable && selectedDay === day;
          const isSplit = isSplitDay(info);

          return (
            <div
              key={`${year}-${month}-${day || idx}`}
              className="relative group"
              style={
                day
                  ? {
                      gridRow: Math.floor((firstDow + day - 1) / 7) + 1,
                      gridColumn: ((firstDow + day - 1) % 7) + 1,
                    }
                  : undefined
              }
            >
              <button
                type="button"
                disabled={!isDeletable}
                onClick={() => isDeletable && onDayClick?.(day, month)}
                style={isSplit ? dayCellSplitStyle(info) : undefined}
                className={`w-full aspect-square rounded text-sm flex items-center justify-center border ${
                  day
                    ? dayCellClasses(info?.status, isToday, isSelected, isSplit)
                    : "border-transparent"
                } ${isDeletable ? "cursor-pointer" : "cursor-default"}`}
              >
                {day || ""}
              </button>
              {isEditable && <DayEditButton onClick={() => onEditClick(day, month)} />}
              {(info?.isHalfDay || isSplit) && (
                <span
                  className="pointer-events-none absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full
                    bg-white text-[9px] font-bold leading-none flex items-center justify-center
                    border border-gray-400 text-gray-700"
                  title={
                    isSplit
                      ? `Half Present + Half ${LEAVE_LABELS[getSplitLeaveType(info)] || "Leave"}`
                      : "Half Day"
                  }
                >
                  ½
                </span>
              )}
              {hasTooltip && <DayTooltip info={info} period={period} />}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// PERFORMANCE: memoized so the Annual view (12 of these, ~365 day cells
// plus tooltips) only re-renders the month whose props actually changed —
// e.g. clicking a day re-renders that one month, not the whole year.
// Callbacks receive the month as a 2nd argument so parents can pass one
// stable function instead of a new arrow per month.
export const MiniMonth = React.memo(MiniMonthInner);

const fmtNum = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
};

export const LeaveBalanceLine = ({ balance }) => {
  if (!balance) return null;
  if (!balance.confirmationDate) {
    return (
      <span className="block text-amber-700 font-medium text-sm mt-1">
        Leave Balance: not accruing yet (no confirmation date on file)
      </span>
    );
  }
  const item = (label, b, color) => (
    <span className="whitespace-nowrap">
      <span className={color}>{label}:</span>{" "}
      <span className="font-semibold">{fmtNum(b?.remaining)}</span>
    </span>
  );
  const pool = balance.sickCasualPool;
  const paidBorrowable = Number(balance.paid?.borrowable) || 0;
  return (
    <span className="block text-sm mt-1 text-gray-700 font-medium">
      <span className="text-blue-700">Leave Balance</span>{" "}
      ({item("Paid", balance.paid, "text-blue-600")}
      {paidBorrowable > 0 && (
        <span className="text-gray-400 font-normal text-xs">
          {" "}
          (incl. {fmtNum(paidBorrowable)} from Sick/Casual)
        </span>
      )}
      <span className="text-gray-300"> | </span>
      {/* Sick and Casual shown separately (e.g. Sick: 2 + Casual: 2). They
          still share one pool in the backend, so the remaining pool is shown
          as a hint only when it is smaller than the two added together. */}
      {item("Sick", balance.sick, "text-teal-600")}
      <span className="text-gray-500"> + </span>
      {item("Casual", balance.casual, "text-pink-600")}
      {pool &&
        Number(pool.remaining) <
          (Number(balance.sick?.remaining) || 0) +
            (Number(balance.casual?.remaining) || 0) && (
          <span className="text-gray-400 font-normal text-xs">
            {" "}
            (max {fmtNum(pool.remaining)} together)
          </span>
        )}
      )
      <span className="text-gray-400 font-normal text-xs">
        {" "}· Paid/Sick/Casual from{" "}
        {new Date(balance.confirmationDate).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Kolkata",
        })}
        ; earlier leave is Unpaid
      </span>
    </span>
  );
};
