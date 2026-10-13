// src/components/staff/StaffList.jsx
import React from "react";
import { Pencil, Trash2, Power, History, FileText } from "lucide-react";
import Table from "../common/Table";
import Pagination from "../common/Pagination";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";
import { getDisplayStatus } from "../../utils/staffStatus";

const StaffList = ({
  staff,
  selected,
  toggleSelect,
  toggleSelectAll,
  onEdit,
  onDelete,
  onToggleStatus,
  onView,
  onLetters,
  currentPage,
  totalPages,
  onPageChange,
}) => {
  const columns = [
    { key: "staffId", header: "Staff ID" },
    {
      key: "staffName",
      header: "Name",
      align: "text-left",
      render: (row) => (
        <span className="font-medium text-gray-800">{row.staffName}</span>
      ),
    },
    { key: "contactNo", header: "Contact" },
    
    {
      key: "date",
      header: "Joined",
      render: (row) => (row.date ? formatDateToDDMMMYYYY(row.date) : "—"),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const statusColors = {
          Internship: "bg-purple-100 text-purple-700",
          Probation: "bg-blue-100 text-blue-700",
          Confirmation: "bg-green-100 text-green-700",
          Relieved: "bg-orange-100 text-orange-700",
        };
        const shownStatus = getDisplayStatus(row);
        return (
          <span
            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
              statusColors[shownStatus] || "bg-gray-100 text-gray-700"
            }`}
          >
            {shownStatus}
          </span>
        );
      },
    },
    {
      key: "enabled",
      header: "Active",
      render: (row) => (
        <button
          onClick={() => onToggleStatus(row._id, row.enabled)}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            row.enabled
              ? "bg-green-100 text-green-700"
              : "bg-gray-200 text-gray-600"
          }`}
        >
          <Power size={12} />
          {row.enabled ? "Active" : "Inactive"}
        </button>
      ),
    },
    {
      key: "history",
      header: "History",
      render: (row) => (
        <button
          onClick={() => onView(row)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100"
          title="View internship / probation / confirmation / leaving details"
        >
          <History size={12} />
          View
        </button>
      ),
    },
    {
      key: "letters",
      header: "Letters",
      render: (row) => (
        <button
          onClick={() => onLetters?.(row)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          title="Generate offer / joining / other letters"
        >
          <FileText size={12} />
          Letters
        </button>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => onEdit(row)}
            className="text-indigo-600 hover:text-indigo-800"
            title="Edit"
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={() => onDelete(row)}
            className="text-red-600 hover:text-red-800"
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Table
        columns={columns}
        data={staff}
        selectable
        selected={selected}
        onSelectAll={toggleSelectAll}
        onSelectRow={toggleSelect}
        emptyMessage="No staff members found"
      />
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </>
  );
};

export default StaffList;