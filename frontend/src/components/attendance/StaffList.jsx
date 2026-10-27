// src/components/attendance/MRList.jsx
import React, { useMemo } from "react";
import { Clock, Eye } from "lucide-react";
import Table from "../common/Table";
import Button from "../common/Button";
import StaffAvatar from "../common/StaffAvatar";

const Badge = ({ children, className = "" }) => (
  <span
    className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${className}`}
  >
    {children}
  </span>
);

const StaffList = ({ staffList, onRecordAttendance, onView }) => {
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
        <div className="flex items-center gap-2.5">
          <StaffAvatar name={row.staffName} photoUrl={row.photoUrl} size={30} />
          <span className="font-medium text-gray-800">{row.staffName}</span>
        </div>
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
      key: "actions",
      header: "Actions",
      render: (row) => (
        <Button variant="primary" size="sm" onClick={() => onView(row)}>
          <Eye size={14} className="mr-1" /> View
        </Button>
      ),
    },
  ];

  // Only rebuild the table rows when the list itself changes.
  const rows = useMemo(
    () =>
      staffList.map((row, idx) => ({
        ...row,
        _id: row.staffId,
        _idx: idx,
      })),
    [staffList],
  );

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <Button variant="success" size="sm" onClick={onRecordAttendance}>
          <Clock size={16} className="mr-1" /> Record Attendance
        </Button>
      </div>

      <Table
        columns={columns}
        data={rows}
        emptyMessage="No Staff records found"
      />
    </div>
  );
};

export default StaffList;
