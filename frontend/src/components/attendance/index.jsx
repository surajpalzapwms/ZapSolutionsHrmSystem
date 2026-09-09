// src/components/attendance/index.jsx
import React, { useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Clock, Menu, Upload } from "lucide-react";
import { useAttendance } from "./hooks/useAttendance";
import { useStaffSummary } from "./hooks/useStaffSummary";
import StaffList from "./StaffList";
import StaffCalendarView from "./StaffCalendarView";
import AttendanceHolidayList from "./AttendanceHolidayList";
import EarlySignOutPanel from "./EarlySignOutPanel";
import AttendanceModal from "./AttendanceModal";
import ConvertExtraHoursModal from "./ConvertExtraHoursModal";
import ExtraHoursModal from "./ExtraHoursModal";
import AttendanceExcelImport from "./AttendanceExcelImport";
import LeaveExcelImport from "./LeaveExcelImport";
import Sidebar from "../common/Sidebar";
import Spinner from "../common/Spinner";

const Attendance = () => {
  const [isMobileView, setIsMobileView] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [activeUserId, setActiveUserId] = useState(null);
  const [convertModalOpen, setConvertModalOpen] = useState(false);
  const [attendanceImportOpen, setAttendanceImportOpen] = useState(false);
  const [leaveImportOpen, setLeaveImportOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const {
    staffList,
    loading: staffLoading,
    fetchStaffSummary,
  } = useStaffSummary();

  const {
    recordAttendance,
    deleteByDate,
    convertToLeave,
    holidays,
    attendanceModal,
    extraHoursModal,
  } = useAttendance();

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

  const refreshAll = async () => {
    await fetchStaffSummary();
    setCalendarRefreshKey((k) => k + 1);
  };

  const handleRecordAttendance = async (data) => {
    const ok = await recordAttendance(data);
    if (ok) await refreshAll();
    return ok;
  };

  const handleConvertExtraHours = async (data) => {
    await convertToLeave(data);
    await refreshAll();
    return true;
  };

  const handleDeleteDay = async (userId, date) => {
    await deleteByDate(userId, date);
    await refreshAll();
  };

  const handleViewExtraHours = (userId) => {
    setActiveUserId(userId);
    extraHoursModal.open();
  };

  return (
    <div className={`${isMobileView ? "px-3" : "p-6"} relative`}>
      {isMobileView && (
        <Sidebar
          isOpen={sidebarOpen}
          toggleSidebar={() => setSidebarOpen(false)}
          isMobile={true}
        />
      )}

      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          {isMobileView && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-full bg-gray-100"
            >
              <Menu size={20} className="text-gray-700" />
            </button>
          )}
          <Clock className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">
            Attendance & Leaves
          </h1>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* Same holidays as the Holiday tab, filtered down to this month
          (passed + upcoming) so they're visible right here on Attendance. */}
      <AttendanceHolidayList holidays={holidays} />

      {staffLoading && !staffList.length ? (
        <Spinner />
      ) : selectedStaff ? (
        <StaffCalendarView
          key={`${selectedStaff.staffId}-${calendarRefreshKey}`}
          staff={selectedStaff}
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
          staffList={staffList}
          onRecordAttendance={attendanceModal.open}
          onConvertExtraHours={() => setConvertModalOpen(true)}
          onView={(row) => setSelectedStaff(row)}
          onViewExtraHours={handleViewExtraHours}
        />
      )}

      <AttendanceModal
        isOpen={attendanceModal.isOpen}
        onClose={attendanceModal.close}
        onSubmit={handleRecordAttendance}
        staffOptions={attendanceStaffOptions}
        holidays={holidays}
      />

      <ConvertExtraHoursModal
        isOpen={convertModalOpen}
        onClose={() => setConvertModalOpen(false)}
        onSubmit={handleConvertExtraHours}
        staffOptions={attendanceStaffOptions}
      />

      <ExtraHoursModal
        isOpen={extraHoursModal.isOpen}
        onClose={extraHoursModal.close}
        userId={activeUserId}
      />

      <AttendanceExcelImport
        isOpen={attendanceImportOpen}
        onClose={() => setAttendanceImportOpen(false)}
        staffOptions={attendanceStaffOptions}
        onSuccess={refreshAll}
      />

      <LeaveExcelImport
        isOpen={leaveImportOpen}
        onClose={() => setLeaveImportOpen(false)}
        staffOptions={leaveStaffOptions}
        onSuccess={refreshAll}
      />
    </div>
  );
};

export default Attendance;