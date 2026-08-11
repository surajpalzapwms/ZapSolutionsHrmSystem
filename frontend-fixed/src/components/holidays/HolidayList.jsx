// src/components/holidays/HolidayList.jsx
import React from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";
import Table from "../common/Table";
import Pagination from "../common/Pagination";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";

const HolidayList = ({
  holidays,
  selected,
  toggleSelect,
  toggleSelectAll,
  onView,
  onEdit,
  onDelete,
  currentPage,
  totalPages,
  onPageChange,
  admin = true,
}) => {
  const columns = [
    { key: "name", header: "Name", align: "text-left", render: (row) => (
      <span className="font-medium text-gray-800 capitalize">{row.name}</span>
    ) },
    { key: "startDate", header: "Start Date", render: (row) => formatDateToDDMMMYYYY(row.startDate) },
    { key: "endDate", header: "End Date", render: (row) => (row.endDate ? formatDateToDDMMMYYYY(row.endDate) : "—") },
    { key: "description", header: "Description", align: "text-left", render: (row) => (
      <span className="text-gray-500 line-clamp-1">{row.description || "—"}</span>
    ) },
    ...(admin
      ? [
          {
            key: "actions",
            header: "Actions",
            render: (row) => (
              <div className="flex justify-center gap-2">
                <button onClick={() => onView(row)} className="text-blue-600" title="View">
                  <Eye size={16} />
                </button>
                <button onClick={() => onEdit(row)} className="text-indigo-600" title="Edit">
                  <Pencil size={16} />
                </button>
                <button onClick={() => onDelete(row)} className="text-red-600" title="Delete">
                  <Trash2 size={16} />
                </button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <Table
        columns={columns}
        data={holidays}
        selectable={admin}
        selected={selected}
        onSelectAll={toggleSelectAll}
        onSelectRow={toggleSelect}
        emptyMessage="No holidays found"
      />
      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={onPageChange} />
    </>
  );
};

export default HolidayList;
