// src/components/attendance/index.jsx
import React, { useState, useMemo, lazy, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bell, Clock, Upload } from "lucide-react";
import { useAttendance } from "./hooks/useAttendance";
import { useStaffSummary } from "./hooks/useStaffSummary";
import StaffList from "./StaffList";
import StaffCalendarView from "./StaffCalendarView";
import EarlySignOutPanel from "./EarlySignOutPanel";
import LivePresencePanel from "../presence/LivePresencePanel";
import AttendanceModal from "./AttendanceModal";
// Excel importers pull in xlsx + exceljs (~1.4 MB). Load them only when the
// admin actually opens an import dialog instead of on every page visit.
const AttendanceExcelImport = lazy(() => import("./AttendanceExcelImport"));
const LeaveExcelImport = lazy(() => import("./LeaveExcelImport"));
import Spinner from "../common/Spinner";
import CurrentStaffToggle from "../common/CurrentStaffToggle";
import { useCurrentStaffOnly } from "../../hooks/useCurrentStaffFilter";
import { isCurrentStaff } from "../../utils/staffStatus";

const Attendance = () => {
  const [isMobileView, setIsMobileView] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [attendanceImportOpen, setAttendanceImportOpen] = useState(false);
  // Office Wi-Fi presence is not shown with the attendance any more: only a
  // 🔔 with today's count; clicking it opens the full details.
  const [showPresence, setShowPresence] = useState(false);
  const [presenceCount, setPresenceCount] = useState(0);
  const [leaveImportOpen, setLeaveImportOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const {
    staffList,
    loading: staffLoading,
    fetchStaffSummary,
  } = useStaffSummary();

  const { recordAttendance, deleteByDate, holidays, attendanceModal } =
    useAttendance();

  // "Current staff only" toggle for the Staff List table. The Record
  // Attendance / import dropdowns keep everyone, since attendance can still
  // be recorded for the days a leaver actually worked.
  const [currentOnly, setCurrentOnly] = useCurrentStaffOnly();
  const tableStaffList = useMemo(
    () => (currentOnly ? staffList.filter(isCurrentStaff) : staffList),
    [staffList, currentOnly],
  );

  // Deep-link support: /hrmlayout/leaveattendance?staffId=... jumps straight
  // to that staff's calendar (used by the "View Attendance" action on the
  // dashboard's Present tab).
  React.useEffect(() => {
    const staffId = searchParams.get("staffId");
    if (!staffId || staffLoading || !staffList.length || selectedStaff) return;
    const match = staffList.find((s) => String(s.staffId) === String(staffId));
    if (match) {
      setSelectedStaff(match);
    }
  }, [searchParams, staffList, staffLoading, selectedStaff]);

  React.useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const attendanceStaffOptions = useMemo(
    () =>
      staffList.map((mr) => {
        const hasLogin = !!mr.attendanceUserId;
        // A staff member who has left can still have attendance
        // marked/imported for the dates they actually worked (the backend
        // enforces the real joining-date → relieving-date window) — so
        // this label is informational only, it no longer disables the
        // option. Only a genuinely missing login account (nothing to
        // attach an Attendance record to) blocks selection.
        const hasLeft = mr.canMarkAttendance === false;
        let label = mr.staffName;
        if (hasLeft) label = `${mr.staffName} (left organization)`;
        else if (!hasLogin) label = `${mr.staffName} (no login linked)`;
        return {
          value: mr.attendanceUserId || "",
          label,
          disabled: !hasLogin,
        };
      }),
    [staffList],
  );

  // Leave.userId points directly at Staff (unlike Attendance, which points
  // at the linked login User) — a separate options list keyed by staffId.
  const leaveStaffOptions = useMemo(
    () => staffList.map((mr) => ({ value: mr.staffId, label: mr.staffName })),
    [staffList],
  );

  // PERFORMANCE: the calendar refresh no longer waits for the (slower)
  // Staff List summary to finish first — both reload in parallel.
  const refreshAll = async () => {
    setCalendarRefreshKey((k) => k + 1);
    await fetchStaffSummary();
  };

  const handleRecordAttendance = async (data) => {
    const ok = await recordAttendance(data);
    if (ok) await refreshAll();
    return ok;
  };

  const handleDeleteDay = async (userId, date) => {
    await deleteByDate(userId, date);
    await refreshAll();
  };

  return (
    <div className={`${isMobileView ? "px-3" : "p-6"} relative`}>
      <div className="flex justify-between items-center mb-4 gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <Clock className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">
            Attendance
          </h1>
        </div>

        {selectedStaff && (
          <div className="flex-1 flex justify-center min-w-0">
            <span className="text-xl font-bold text-gray-800 truncate">
              {selectedStaff.staffName}
            </span>
          </div>
        )}

        {/* Import buttons + "Current staff only" toggle in one row, toggle at
            the right end (same layout as the Payroll tab). The toggle only
            applies to the Staff List, so it's hidden while a calendar is open. */}
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          {!selectedStaff && (
            <button
              type="button"
              onClick={() => setShowPresence((v) => !v)}
              className={`relative inline-flex items-center justify-center w-10 h-10 rounded-lg border transition-colors ${
                showPresence
                  ? "border-blue-300 bg-blue-50"
                  : "border-gray-300 bg-white hover:bg-gray-50"
              }`}
              aria-label="Attendance notifications"
              title="Attendance notifications (office Wi-Fi)"
            >
              <Bell size={18} className="text-gray-600" />
              {presenceCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
                  {presenceCount > 99 ? "99+" : presenceCount}
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => setAttendanceImportOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700"
          >
            <Upload size={16} />
            Import Attendance
          </button>
          <button
            onClick={() => setLeaveImportOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700"
          >
            <Upload size={16} />
            Import Leaves
          </button>

          {!selectedStaff && (
            <CurrentStaffToggle
              className="ml-1"
              checked={currentOnly}
              onChange={setCurrentOnly}
              shownCount={tableStaffList.length}
              totalCount={staffList.length}
            />
          )}
        </div>
      </div>

      {/* Kept mounted (only hidden) so it keeps loading and the bell shows
          the right number before it is opened. */}
      {!selectedStaff && (
        <div className={showPresence ? "" : "hidden"}>
          <LivePresencePanel onCountChange={setPresenceCount} />
        </div>
      )}

      {staffLoading && !staffList.length ? (
        <Spinner />
      ) : selectedStaff ? (
        <StaffCalendarView
          key={selectedStaff.staffId}
          refreshKey={calendarRefreshKey}
          staff={selectedStaff}
          holidays={holidays}
          onBack={() => {
            // If we got here via a deep link (e.g. the "View Attendance"
            // action on the HRM Dashboard's Present tab), go back to
            // wherever that link came from instead of dropping onto this
            // page's own internal Staff List.
            if (searchParams.get("staffId")) {
              navigate(-1);
              return;
            }
            setSelectedStaff(null);
          }}
          onDeleted={handleDeleteDay}
        />
      ) : (
        <StaffList
          staffList={tableStaffList}
          onRecordAttendance={attendanceModal.open}
          onView={(row) => setSelectedStaff(row)}
        />
      )}

      <AttendanceModal
        isOpen={attendanceModal.isOpen}
        onClose={attendanceModal.close}
        onSubmit={handleRecordAttendance}
        staffOptions={attendanceStaffOptions}
        holidays={holidays}
      />

      <Suspense fallback={null}>
        {attendanceImportOpen && (
          <AttendanceExcelImport
            isOpen
            onClose={() => setAttendanceImportOpen(false)}
            staffOptions={attendanceStaffOptions}
            onSuccess={refreshAll}
          />
        )}
        {leaveImportOpen && (
          <LeaveExcelImport
            isOpen
            onClose={() => setLeaveImportOpen(false)}
            staffOptions={leaveStaffOptions}
            onSuccess={refreshAll}
          />
        )}
      </Suspense>
    </div>
  );
};

export default Attendance;