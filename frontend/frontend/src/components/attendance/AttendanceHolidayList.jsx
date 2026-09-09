// src/components/attendance/AttendanceHolidayList.jsx
//
// Shows the same holidays as the Holiday tab, but scoped to just the
// current month (both the ones already passed and the ones still coming
// up) so staff can see at a glance what's affecting this month's
// attendance without leaving the Attendance screen.
import React, { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { formatDateToDDMMMYYYY, getMonthName } from "../../utils/dateUtils";

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Holidays that overlap the given month at all, ordered by start date,
// each tagged with whether it's already over, happening today, or coming up.
const getHolidaysForMonth = (holidays, year, month) => {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const today = startOfDay(new Date());

  return holidays
    .filter((h) => h.enabled !== false)
    .filter((h) => {
      const start = new Date(h.startDate);
      const end = new Date(h.endDate || h.startDate);
      return start <= monthEnd && end >= monthStart;
    })
    .map((h) => {
      const start = startOfDay(h.startDate);
      const end = startOfDay(h.endDate || h.startDate);
      let status = "upcoming";
      if (today > end) status = "passed";
      else if (today >= start && today <= end) status = "today";
      return { ...h, status };
    })
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
};

const STATUS_STYLES = {
  passed: "bg-gray-100 text-gray-500 border-gray-200",
  today: "bg-amber-100 text-amber-700 border-amber-200",
  upcoming: "bg-blue-50 text-blue-700 border-blue-100",
};

const STATUS_LABELS = {
  passed: "Passed",
  today: "Today",
  upcoming: "Upcoming",
};

const AttendanceHolidayList = ({ holidays = [], date = new Date() }) => {
  const year = date.getFullYear();
  const month = date.getMonth();

  const monthHolidays = useMemo(
    () => getHolidaysForMonth(holidays, year, month),
    [holidays, year, month]
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <CalendarDays size={16} className="text-blue-600" />
          Holidays — {getMonthName(month)} {year}
        </h3>
        <span className="text-xs text-gray-400">
          {monthHolidays.length} holiday{monthHolidays.length === 1 ? "" : "s"}
        </span>
      </div>

      {monthHolidays.length === 0 ? (
        <p className="text-sm text-gray-400">No holidays this month.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {monthHolidays.map((h) => (
            <div
              key={h._id}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${STATUS_STYLES[h.status]}`}
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{h.name}</div>
                <div className="text-[11px] opacity-80">
                  {formatDateToDDMMMYYYY(h.startDate)}
                  {h.endDate && h.endDate !== h.startDate
                    ? ` – ${formatDateToDDMMMYYYY(h.endDate)}`
                    : ""}
                </div>
              </div>
              <span className="shrink-0 font-semibold uppercase tracking-wide text-[10px]">
                {STATUS_LABELS[h.status]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AttendanceHolidayList;
