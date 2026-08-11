// src/components/attendance/MRList.jsx
import React from "react";
import { Clock, RefreshCcw, Eye } from "lucide-react";
import Table from "../common/Table";
import Button from "../common/Button";

const Badge = ({ children, className = "" }) => (
  <span
    className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${className}`}
  >
    {children}
  </span>
);

const formatExtraRemaining = (minutes = 0) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
};

const StaffList = ({
  staffList,
  onRecordAttendance,
  onConvertExtraHours,
  onView,
  onViewExtraHours,
}) => {
  const columns = [
    {
      key: "srNo",
      header: "Sr No",
      render: (row) => row._idx + 1,
    },
    {
      key: "staffName",
      header: "Name",
      render: (row) => (
        <span className="font-medium text-gray-800">{row.staffName}</span>
      ),
    },
    {
      key: "email",
      header: "Email",
      render: (row) => (
        <span className="text-indigo-600">{row.email || "—"}</span>
      ),
    },
    {
      key: "contactNo",
      header: "Contact",
      render: (row) => row.contactNo || "—",
    },
    {
      key: "paidLeaveAllotted",
      header: "Paid Leave",
      render: (row) => (
        <Badge className="bg-green-100 text-green-700">
          {row.paidLeaveAllotted}
        </Badge>
      ),
    },
    {
      key: "leaveTaken",
      header: "Leave Taken",
      render: (row) => (
        <Badge className="bg-red-100 text-red-600">{row.leaveTaken}</Badge>
      ),
    },
    {
      key: "remainingPaid",
      header: "Remaining Paid",
      render: (row) => (
        <Badge className="bg-yellow-100 text-yellow-700">
          {row.remainingPaid.toFixed(2)}
        </Badge>
      ),
    },
    {
      key: "extraHours",
      header: "Extra Hours",
      render: (row) => (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() =>
              row.attendanceUserId && onViewExtraHours?.(row.attendanceUserId)
            }
            disabled={!row.attendanceUserId}
            className={`flex flex-col items-center justify-center gap-1 ${
              row.attendanceUserId
                ? "cursor-pointer"
                : "cursor-default opacity-70"
            }`}
            title={
              row.attendanceUserId
                ? "View Extra Working Hours"
                : "No login account linked"
            }
          >
            <Badge className="bg-blue-100 text-blue-700 min-w-[60px] text-center">
              {row.extraHoursDays}d
            </Badge>

            <Badge className="bg-yellow-100 text-yellow-700 min-w-[80px] text-center">
              {formatExtraRemaining(row.extraHoursRemainingMinutes)}
            </Badge>
          </button>
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <Button variant="primary" size="sm" onClick={() => onView(row)}>
          <Eye size={14} className="mr-1" /> View
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <Button variant="success" size="sm" onClick={onRecordAttendance}>
          <Clock size={16} className="mr-1" /> Record Attendance
        </Button>
        <Button
          size="sm"
          className="!bg-purple-600 hover:!bg-purple-700 text-white"
          onClick={onConvertExtraHours}
        >
          <RefreshCcw size={16} className="mr-1" /> Convert Extra Hours
        </Button>
      </div>

      <Table
        columns={columns}
        data={staffList.map((row, idx) => ({
          ...row,
          _id: row.staffId,
          _idx: idx,
        }))}
        emptyMessage="No Staff records found"
      />
    </div>
  );
};

export default StaffList;
