// src/components/holidays/HolidayCalendar.jsx
import React, { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getDaysInMonth, getMonthName, getShortMonthName } from "../../utils/dateUtils";
import { SHORT_DAYS } from "../../utils/constants";
import { saturdayHolidayService } from "../../services/saturdayHolidayService";

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

// ---- Monthly view: one full-size month grid ----
const MonthlyView = ({ current, setCurrent, holidayMap, today, onView }) => {
  const year = current.getFullYear();
  const month = current.getMonth();
  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);

  const goPrev = () => setCurrent(new Date(year, month - 1, 1));
  const goNext = () => setCurrent(new Date(year, month + 1, 1));

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={goPrev} className="p-2 rounded-full hover:bg-gray-100">
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

const AnnualView = ({ year, setYear, holidays, holidayMap, today, onView }) => {
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
        <button onClick={() => setYear(year - 1)} className="p-2 rounded-full hover:bg-gray-100">
          <ChevronLeft size={18} />
        </button>
        <h3 className="text-lg font-semibold text-gray-800">{year}</h3>
        <button onClick={() => setYear(year + 1)} className="p-2 rounded-full hover:bg-gray-100">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 12 }, (_, month) => (
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

const HolidayCalendar = ({ holidays, onView }) => {
  const today = useMemo(() => new Date(), []);
  const [mode, setMode] = useState("monthly"); // "monthly" | "annual"
  const [current, setCurrent] = useState(new Date());
  const [year, setYear] = useState(new Date().getFullYear());
  const [saturdayHolidays, setSaturdayHolidays] = useState([]);

  // Whichever year is actually on screen right now, depending on view mode.
  const activeYear = mode === "monthly" ? current.getFullYear() : year;

  // Recurring Saturday holidays are admin-configured separately from the
  // one-off Holiday records, so pull the computed dates for the visible
  // year and fold them into the same map/legend the manual holidays use.
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
  }, [activeYear]);

  const mergedHolidays = useMemo(
    () => [...holidays, ...saturdayHolidays],
    [holidays, saturdayHolidays],
  );

  const holidayMap = useMemo(() => buildHolidayMap(mergedHolidays), [mergedHolidays]);

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg bg-gray-100 p-1">
        <button
          type="button"
          onClick={() => setMode("monthly")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            mode === "monthly" ? "bg-blue-600 text-white" : "text-gray-600 hover:text-gray-800"
          }`}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setMode("annual")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            mode === "annual" ? "bg-blue-600 text-white" : "text-gray-600 hover:text-gray-800"
          }`}
        >
          Annual
        </button>
      </div>

      {mode === "monthly" ? (
        <MonthlyView
          current={current}
          setCurrent={setCurrent}
          holidayMap={holidayMap}
          today={today}
          onView={onView}
        />
      ) : (
        <AnnualView
          year={year}
          setYear={setYear}
          holidays={mergedHolidays}
          holidayMap={holidayMap}
          today={today}
          onView={onView}
        />
      )}
    </div>
  );
};

export default HolidayCalendar;
