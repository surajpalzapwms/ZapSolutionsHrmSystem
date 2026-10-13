// src/components/holidays/HolidayCalendar.jsx
import React, { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getDaysInMonth, getMonthName, getShortMonthName } from "../../utils/dateUtils";
import { SHORT_DAYS } from "../../utils/constants";
import { saturdayHolidayService } from "../../services/saturdayHolidayService";
import { filterHolidaysFromJoiningDate } from "../../utils/holidayHelpers";

const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// Builds a { "YYYY-M-D": [holiday, ...] } lookup so any day in any month can
// be checked in O(1) without re-scanning the holidays array per cell.
const buildHolidayMap = (holidays) => {
  const map = {};
  holidays.forEach((h) => {
    const start = new Date(h.startDate);
    const end = h.endDate ? new Date(h.endDate) : start;
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
      map[key] = map[key] ? [...map[key], h] : [h];
      cursor.setDate(cursor.getDate() + 1);
    }
  });
  return map;
};

// { year, month } (month 0-11) of the staff member's joining date, or null for
// admins / no joining date. Months before it are never shown.
const getJoinMonth = (joiningDate) => {
  if (!joiningDate) return null;
  const d = new Date(joiningDate);
  if (isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), month: d.getMonth() };
};

const monthIndex = (year, month) => year * 12 + month;

const Legend = () => (
  <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
    <span className="flex items-center gap-1.5">
      <span className="w-3.5 h-3.5 rounded bg-red-500 inline-block" /> Holiday
    </span>
    <span className="flex items-center gap-1.5">
      <span className="w-3.5 h-3.5 rounded bg-gray-400 inline-block" /> Sunday
    </span>
    <span className="flex items-center gap-1.5">
      <span className="w-3.5 h-3.5 rounded border border-gray-300 inline-block" /> Working Day
    </span>
    <span className="flex items-center gap-1.5">
      <span className="w-3.5 h-3.5 rounded border-2 border-blue-500 inline-block" /> Today
    </span>
  </div>
);

const MonthlyView = ({ current, setCurrent, holidayMap, today, onView, minMonth }) => {
  const year = current.getFullYear();
  const month = current.getMonth();
  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);

  const canGoPrev =
    !minMonth || monthIndex(year, month) > monthIndex(minMonth.year, minMonth.month);
  const goPrev = () => canGoPrev && setCurrent(new Date(year, month - 1, 1));
  const goNext = () => setCurrent(new Date(year, month + 1, 1));

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={goPrev}
          disabled={!canGoPrev}
          className="p-2 rounded-full hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <ChevronLeft size={18} />
        </button>
        <h3 className="text-lg font-semibold text-gray-800">
          {getMonthName(month)} {year}
        </h3>
        <button onClick={goNext} className="p-2 rounded-full hover:bg-gray-100">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-gray-500 mb-2">
        {SHORT_DAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map((day, idx) => {
          if (!day) return <div key={idx} />;
          const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
          const dayHolidays = holidayMap[key];
          const isHoliday = !!dayHolidays;
          const isSunday = day.getDay() === 0;
          const isToday = isSameDay(day, today);

          let cellClasses = "min-h-[64px] rounded-lg border p-2 text-sm font-medium text-center ";
          if (isHoliday) {
            cellClasses += "bg-red-500 text-white border-red-500";
          } else if (isSunday) {
            cellClasses += "bg-gray-400 text-white border-gray-400";
          } else {
            cellClasses += "bg-white text-gray-700 border-gray-200";
          }
          if (isToday) {
            cellClasses += " ring-2 ring-blue-500 ring-offset-1";
          }

          return (
            <button
              key={idx}
              type="button"
              onClick={() => isHoliday && onView(dayHolidays[0])}
              title={isHoliday ? dayHolidays.map((h) => h.name).join(", ") : undefined}
              className={cellClasses}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-6 pt-4 border-t border-gray-100 flex justify-center">
        <Legend />
      </div>
    </div>
  );
};

// ---- Annual view: 12 mini month calendars in a 4-column grid ----
const MiniMonth = ({ year, month, holidayMap, holidaysForMonth, today, isCurrent, onView }) => {
  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);

  return (
    <div
      className={`bg-white rounded-xl border p-3 flex flex-col ${
        isCurrent ? "border-blue-400 ring-1 ring-blue-200" : "border-gray-200"
      }`}
    >
      <div className="text-center mb-2">
        <div className="font-semibold text-gray-800">{getShortMonthName(month)}</div>
        {holidaysForMonth.length > 0 && (
          <div className="text-xs text-red-500 font-medium">
            {holidaysForMonth.length} holiday(s)
          </div>
        )}
        {isCurrent && <div className="text-[11px] text-blue-500 font-medium">(Current)</div>}
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold text-gray-400 mb-1">
        {SHORT_DAYS.map((d) => (
          <div key={d}>{d[0]}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-2">
        {days.map((day, idx) => {
          if (!day) return <div key={idx} className="h-6" />;
          const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
          const isHoliday = !!holidayMap[key];
          const isSunday = day.getDay() === 0;
          const isToday = isSameDay(day, today);

          let classes = "h-6 rounded flex items-center justify-center text-[11px] ";
          if (isHoliday) classes += "bg-red-500 text-white font-semibold";
          else if (isSunday) classes += "bg-gray-300 text-gray-600";
          else classes += "text-gray-600";
          if (isToday) classes += " ring-1 ring-blue-500";

          return (
            <div key={idx} className={classes}>
              {day.getDate()}
            </div>
          );
        })}
      </div>

      {holidaysForMonth.length > 0 && (
        <div className="border-t border-gray-100 pt-1.5 space-y-1 mt-auto">
          {holidaysForMonth.slice(0, 3).map((h) => (
            <button
              key={h._id}
              type="button"
              onClick={() => onView(h)}
              className="w-full flex justify-between items-baseline text-left text-[11px] hover:bg-red-50 rounded px-1"
            >
              <span className="text-red-500 font-medium truncate max-w-[70px]">{h.name}</span>
              <span className="text-gray-400 shrink-0">
                {new Date(h.startDate).toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const AnnualView = ({ year, setYear, holidays, holidayMap, today, onView, minMonth }) => {
  const canGoPrev = !minMonth || year > minMonth.year;
  // In the joining year, skip the months before the one they joined in.
  const visibleMonths = Array.from({ length: 12 }, (_, m) => m).filter(
    (m) => !minMonth || monthIndex(year, m) >= monthIndex(minMonth.year, minMonth.month),
  );

  const holidaysByMonth = useMemo(() => {
    const buckets = Array.from({ length: 12 }, () => []);
    holidays.forEach((h) => {
      const start = new Date(h.startDate);
      const end = h.endDate ? new Date(h.endDate) : start;
      const seenMonths = new Set();
      const cursor = new Date(start);
      while (cursor <= end) {
        if (cursor.getFullYear() === year) seenMonths.add(cursor.getMonth());
        cursor.setDate(cursor.getDate() + 1);
      }
      seenMonths.forEach((m) => buckets[m].push(h));
    });
    return buckets;
  }, [holidays, year]);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => canGoPrev && setYear(year - 1)}
          disabled={!canGoPrev}
          className="p-2 rounded-full hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <ChevronLeft size={18} />
        </button>
        <h3 className="text-lg font-semibold text-gray-800">{year}</h3>
        <button onClick={() => setYear(year + 1)} className="p-2 rounded-full hover:bg-gray-100">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {visibleMonths.map((month) => (
          <MiniMonth
            key={month}
            year={year}
            month={month}
            holidayMap={holidayMap}
            holidaysForMonth={holidaysByMonth[month]}
            today={today}
            isCurrent={year === today.getFullYear() && month === today.getMonth()}
            onView={onView}
          />
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-gray-100 flex justify-center">
        <Legend />
      </div>
    </div>
  );
};

const HolidayCalendar = ({
  holidays,
  onView,
  saturdayRefreshKey = 0,
  viewMode = "annual",
  joiningDate = null,
}) => {
  const today = useMemo(() => new Date(), []);
  // Monthly/Annual is now controlled entirely by the parent (the toggle
  // buttons in index.jsx's actions row) via the viewMode prop, rather than
  // owned here. This component no longer renders its own toggle.
  const mode = viewMode; // "monthly" | "annual"
  const minMonth = useMemo(() => getJoinMonth(joiningDate), [joiningDate]);
  const [current, setCurrent] = useState(new Date());
  const [yearState, setYear] = useState(new Date().getFullYear());
  // Never sit on a year before the joining year.
  const year = minMonth ? Math.max(yearState, minMonth.year) : yearState;
  const [saturdayHolidays, setSaturdayHolidays] = useState([]);

  // Whichever year is actually on screen right now, depending on view mode.
  const activeYear = mode === "monthly" ? current.getFullYear() : year;

  // Recurring Saturday holidays are admin-configured separately from the
  // one-off Holiday records, so pull the computed dates for the visible
  // year and fold them into the same map/legend the manual holidays use.
  // `saturdayRefreshKey` is bumped by the parent whenever the admin saves
  // new Saturday rules in the settings modal — without it in the dependency
  // array, this effect only reruns when `activeYear` changes, so a save
  // made while staying on the same year would never be re-fetched and the
  // calendar would keep showing the old pattern until a full page reload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await saturdayHolidayService.getComputedDates(activeYear);
        if (!cancelled) setSaturdayHolidays(res.data?.holidays || []);
      } catch {
        if (!cancelled) setSaturdayHolidays([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeYear, saturdayRefreshKey]);

  // Saturday holidays come from a separate endpoint, so they need the same
  // "not before the staff member joined" filter as the manual holidays.
  const mergedHolidays = useMemo(
    () =>
      filterHolidaysFromJoiningDate(
        [...holidays, ...saturdayHolidays],
        joiningDate,
      ),
    [holidays, saturdayHolidays, joiningDate],
  );

  const holidayMap = useMemo(() => buildHolidayMap(mergedHolidays), [mergedHolidays]);

  return (
    <div className="space-y-4">
      {mode === "monthly" ? (
        <MonthlyView
          current={current}
          setCurrent={setCurrent}
          holidayMap={holidayMap}
          today={today}
          onView={onView}
          minMonth={minMonth}
        />
      ) : (
        <AnnualView
          year={year}
          setYear={setYear}
          holidays={mergedHolidays}
          holidayMap={holidayMap}
          today={today}
          onView={onView}
          minMonth={minMonth}
        />
      )}
    </div>
  );
};

export default HolidayCalendar;