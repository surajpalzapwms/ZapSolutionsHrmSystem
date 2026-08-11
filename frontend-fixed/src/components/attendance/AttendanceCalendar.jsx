// src/components/attendance/AttendanceCalendar.jsx
import React, { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCalendar } from "./hooks/useCalendar";
import { SHORT_DAYS } from "../../utils/constants";

const AttendanceCalendar = ({ attendance = [], leaves = [] }) => {
  const { year, month, days, monthLabel, goToPrevMonth, goToNextMonth, goToToday, isSunday } = useCalendar();

  const recordsByDay = useMemo(() => {
    const map = {};
    attendance.forEach((a) => {
      const d = new Date(a.date || a.createdAt);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = d.getDate();
        map[key] = map[key] || { attendance: [], leave: [] };
        map[key].attendance.push(a);
      }
    });
    leaves.forEach((l) => {
      const d = new Date(l.leaveDate);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = d.getDate();
        map[key] = map[key] || { attendance: [], leave: [] };
        map[key].leave.push(l);
      }
    });
    return map;
  }, [attendance, leaves, year, month]);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow p-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={goToPrevMonth} className="p-2 rounded-full hover:bg-gray-100">
          <ChevronLeft size={18} />
        </button>
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-gray-800">{monthLabel}</h3>
          <button onClick={goToToday} className="text-xs text-indigo-600 hover:underline">
            Today
          </button>
        </div>
        <button onClick={goToNextMonth} className="p-2 rounded-full hover:bg-gray-100">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-500 mb-2">
        {SHORT_DAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, idx) => {
          const dayData = day ? recordsByDay[day.getDate()] : null;
          const weekend = day && isSunday(day);
          return (
            <div
              key={idx}
              className={`min-h-[70px] rounded-lg border text-xs p-1 ${
                day ? "border-gray-100" : "border-transparent"
              } ${weekend ? "bg-gray-50" : ""}`}
            >
              {day && (
                <>
                  <div className="text-right text-gray-500">{day.getDate()}</div>
                  {dayData?.leave.length > 0 && (
                    <div className="mt-1 truncate bg-red-100 text-red-700 rounded px-1 py-0.5">
                      Leave ({dayData.leave.length})
                    </div>
                  )}
                  {dayData?.attendance.length > 0 && (
                    <div className="mt-1 truncate bg-green-100 text-green-700 rounded px-1 py-0.5">
                      Present ({dayData.attendance.length})
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AttendanceCalendar;
