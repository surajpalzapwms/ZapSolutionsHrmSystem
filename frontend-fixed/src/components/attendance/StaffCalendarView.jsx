import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import Button from "../common/Button";
import Spinner from "../common/Spinner";
import { useMRCalendar } from "./hooks/useStaffCalendar";
import { SHORT_DAYS, MONTHS } from "../../utils/constants";
import { showToast } from "../../utils/toast";
import { attendanceService } from "../../services/attendanceService";

const STATUS_STYLES = {
  present: "bg-green-500 text-white border-green-500",
  half: "bg-orange-400 text-white border-orange-400",
  swap: "bg-purple-500 text-white border-purple-500",
  paid: "bg-blue-500 text-white border-blue-500",
  unpaid: "bg-red-600 text-white border-red-600",
  holiday: "bg-yellow-400 text-gray-900 border-yellow-400",
};

const LEGEND = [
  { label: "Present", className: "bg-green-500" },
  { label: "Half Day", className: "bg-orange-400" },
  { label: "Swap Leave", className: "bg-purple-500" },
  { label: "Paid Leave", className: "bg-blue-500" },
  { label: "Unpaid Leave", className: "bg-red-600" },
  { label: "Holiday", className: "bg-yellow-400" },
  { label: "Today", className: "bg-white border-2 border-indigo-400" },
];

const formatTime = (value) => {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatDuration = (totalMinutes) => {
  const mins = Math.max(0, Math.floor(totalMinutes || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
};

// Statuses that should be hoverable/clickable in the calendar grid, and what
// each non-attendance status should say in the hover tooltip.
const TOOLTIP_STATUSES = [
  "present",
  "half",
  "holiday",
  "paid",
  "unpaid",
  "swap",
];

const LEAVE_LABELS = {
  paid: "Paid Leave",
  unpaid: "Unpaid Leave",
  swap: "Swap Leave",
};

const DayTooltip = ({ info }) => {
  const isAttendance = info.status === "present" || info.status === "half";
  return (
    <div
      className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-2 w-max -translate-x-1/2
        rounded-lg bg-gray-900 px-3 py-2 text-xs text-white opacity-0 shadow-lg
        transition-opacity duration-150 group-hover:opacity-100"
    >
      {isAttendance ? (
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
          <span>{LEAVE_LABELS[info.status] || "Leave"}</span>
        </div>
      )}
      <div
        className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent
          border-t-gray-900"
      />
    </div>
  );
};

const dayCellClasses = (status, isToday, isSelected) => {
  const base =
    STATUS_STYLES[status] || "bg-white text-gray-600 border-gray-200";
  const todayRing = isToday ? "ring-2 ring-indigo-400 ring-offset-1" : "";
  const selectedRing = isSelected ? "ring-2 ring-gray-800 ring-offset-1" : "";
  return `${base} ${todayRing} ${selectedRing}`;
};

const MiniMonth = ({ year, month, days, isCurrentMonth, today }) => {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = Object.keys(days).length;
  const cells = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="border border-gray-200 rounded-xl p-3">
      <h4 className="text-sm font-semibold text-gray-700 mb-2 text-center">
        {MONTHS[month]}
      </h4>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-gray-400 mb-1">
        {SHORT_DAYS.map((d) => (
          <div key={d}>{d[0]}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          const info = day ? days[day] : null;
          const hasTooltip = info && TOOLTIP_STATUSES.includes(info.status);
          const isToday = isCurrentMonth && today === day;
          return (
            <div key={idx} className="relative group">
              <div
                className={`aspect-square rounded text-[10px] flex items-center justify-center border ${
                  day
                    ? dayCellClasses(info?.status, isToday, false)
                    : "border-transparent"
                } ${hasTooltip ? "cursor-pointer" : "cursor-default"}`}
              >
                {day || ""}
              </div>
              {hasTooltip && <DayTooltip info={info} />}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const MRCalendarView = ({ staff, onBack, onDeleted }) => {
  const {
    viewMode,
    setViewMode,
    year,
    month,
    calendar,
    loading,
    selectedDay,
    setSelectedDay,
    goToPrevMonth,
    goToNextMonth,
    goToPrevYear,
    goToNextYear,
    fetchCalendar,
  } = useMRCalendar(staff.staffId);

  const [openRecord, setOpenRecord] = useState(null);
  const [openRecordLoading, setOpenRecordLoading] = useState(true);
  const [signOutBusy, setSignOutBusy] = useState(false);

  const loadOpenRecord = useCallback(async () => {
    if (!calendar?.attendanceUserId) {
      setOpenRecord(null);
      setOpenRecordLoading(false);
      return;
    }
    setOpenRecordLoading(true);
    try {
      const res = await attendanceService.getOpenAttendanceToday();
      const records = res.data?.records || [];
      const mine = records.find(
        (r) => String(r.userId) === String(calendar.attendanceUserId),
      );
      setOpenRecord(mine || null);
    } catch (err) {
      // Silent — this is a supplementary widget, not the main calendar data.
    } finally {
      setOpenRecordLoading(false);
    }
  }, [calendar?.attendanceUserId]);

  useEffect(() => {
    loadOpenRecord();
    const id = setInterval(loadOpenRecord, 60000);
    return () => clearInterval(id);
  }, [loadOpenRecord]);

  const toggleEarlySignOut = async (allow) => {
    if (!openRecord) return;
    setSignOutBusy(true);
    try {
      const res = await attendanceService.setEarlySignOutPermission(
        openRecord.userId,
        allow,
      );
      showToast("success", res.data?.message || "Updated");
      await loadOpenRecord();
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to update permission",
      );
    } finally {
      setSignOutBusy(false);
    }
  };

  const cells = useMemo(() => {
    if (!calendar?.days) return [];
    const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = Object.keys(calendar.days).length;
    return [
      ...Array(firstDow).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
  }, [calendar, year, month]);

  const handleDayClick = (day) => {
    if (!day) return;
    const info = calendar.days[day];
    if (!info || !["present", "half"].includes(info.status)) return;
    setSelectedDay(selectedDay === day ? null : day);
  };

  const handleDeleteAttendance = async () => {
    if (!selectedDay) {
      showToast(
        "error",
        "Click a Present/Half Day date on the calendar first, then delete it.",
      );
      return;
    }
    if (!calendar?.attendanceUserId) {
      showToast(
        "error",
        "This Staff has no linked login account, so attendance can't be recorded or deleted.",
      );
      return;
    }
    const info = calendar.days[selectedDay];
    await onDeleted(calendar.attendanceUserId, info.date);
    setSelectedDay(null);
    fetchCalendar();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={onBack}>
            <ChevronLeft size={16} className="mr-1" /> Back to Staff List
          </Button>
          <Button variant="danger" size="sm" onClick={handleDeleteAttendance}>
            <Trash2 size={16} className="mr-1" /> Delete Attendance
          </Button>
        </div>
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
          <button
            onClick={() => setViewMode("monthly")}
            className={`px-4 py-1.5 text-sm font-medium cursor-pointer ${
              viewMode === "monthly"
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setViewMode("annual")}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-300 cursor-pointer ${
              viewMode === "annual"
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Annual
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-bold text-gray-800">
            {staff.staffName} - Calendar View{" "}
            <span className="text-indigo-600 font-medium text-base">
              (Unpaid: {calendar?.unpaidCount ?? 0}, Swap:{" "}
              {calendar?.swapCount ?? 0})
            </span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={viewMode === "annual" ? goToPrevYear : goToPrevMonth}
              className="p-2 rounded-full hover:bg-gray-100"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="font-semibold text-gray-700 w-28 text-center">
              {viewMode === "annual" ? year : `${MONTHS[month]} ${year}`}
            </span>
            <button
              onClick={viewMode === "annual" ? goToNextYear : goToNextMonth}
              className="p-2 rounded-full hover:bg-gray-100"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {loading ? (
          <Spinner />
        ) : viewMode === "annual" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {calendar?.months?.map((m) => (
              <MiniMonth
                key={m.month}
                year={year}
                month={m.month}
                days={m.days}
                isCurrentMonth={m.isCurrentMonth}
                today={m.today}
              />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-2 text-center text-sm font-medium text-gray-500 mb-2">
              {SHORT_DAYS.map((d) => (
                <div key={d} className={d === "Sun" ? "text-red-500" : ""}>
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {cells.map((day, idx) => {
                const info = day ? calendar.days[day] : null;
                const isToday =
                  calendar?.isCurrentMonth && calendar?.today === day;
                const hasTooltip =
                  info && TOOLTIP_STATUSES.includes(info.status);
                return (
                  <div key={idx} className="relative group">
                    <button
                      onClick={() => handleDayClick(day)}
                      disabled={!day}
                      className={`w-full min-h-[52px] rounded-lg border font-medium text-sm transition-colors ${
                        day
                          ? dayCellClasses(
                              info?.status,
                              isToday,
                              selectedDay === day,
                            )
                          : "border-transparent"
                      } ${hasTooltip ? "cursor-pointer" : "cursor-default"}`}
                    >
                      {day || ""}
                    </button>
                    {hasTooltip && <DayTooltip info={info} />}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 mt-6 pt-4 border-t border-gray-100">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-600">
            {LEGEND.map((l) => (
              <div key={l.label} className="flex items-center gap-1.5">
                <span className={`w-3.5 h-3.5 rounded ${l.className}`} />
                {l.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MRCalendarView;
