// src/components/attendance/AttendanceList.jsx
import React from "react";
import { Trash2 } from "lucide-react";
import Table from "../common/Table";
import Pagination from "../common/Pagination";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";

const typeColors = {
  full: "bg-green-100 text-green-700",
  half: "bg-yellow-100 text-yellow-700",
  short: "bg-orange-100 text-orange-700",
};

const AttendanceList = ({
  attendance,
  selected,
  toggleSelect,
  toggleSelectAll,
  onDelete,
  currentPage,
  totalPages,
  onPageChange,
}) => {
  const columns = [
    { key: "userId", header: "Staff ID", align: "text-left" },
    {
      key: "date",
      header: "Date",
      render: (row) => formatDateToDDMMMYYYY(row.date || row.createdAt),
    },
    { key: "loginTime", header: "Login", render: (row) => row.loginTime || "—" },
    { key: "logoutTime", header: "Logout", render: (row) => row.logoutTime || "—" },
    { key: "totalTime", header: "Total Time", render: (row) => row.totalTime || "—" },
    {
      key: "attendanceType",
      header: "Type",
      render: (row) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${typeColors[row.attendanceType] || "bg-gray-100 text-gray-700"}`}>
          {row.attendanceType}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <button onClick={() => onDelete(row)} className="text-red-600" title="Delete">
          <Trash2 size={16} />
        </button>
      ),
    },
  ];

  return (
    <>
      <Table
        columns={columns}
        data={attendance}
        selectable
        selected={selected}
        onSelectAll={toggleSelectAll}
        onSelectRow={toggleSelect}
        emptyMessage="No attendance records found"
      />
      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={onPageChange} />
    </>
  );
};

export default AttendanceList;
