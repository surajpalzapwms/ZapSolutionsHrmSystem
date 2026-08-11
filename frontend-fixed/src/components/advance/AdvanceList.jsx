// src/components/advance/AdvanceList.jsx
import React from "react";
import { Pencil, Trash2, Check, X, RotateCcw } from "lucide-react";
import Table from "../common/Table";
import Pagination from "../common/Pagination";
import { formatCurrency } from "../../utils/numberUtils";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";

const statusColors = {
  pending: "bg-yellow-100 text-yellow-700",
  approved: "bg-blue-100 text-blue-700",
  rejected: "bg-red-100 text-red-700",
  repaid: "bg-green-100 text-green-700",
};

const AdvanceList = ({
  advances,
  selected,
  toggleSelect,
  toggleSelectAll,
  onEdit,
  onDelete,
  onUpdateStatus,
  currentPage,
  totalPages,
  onPageChange,
}) => {
  const columns = [
    {
      key: "employeeName",
      header: "Staff",
      align: "text-left",
      render: (row) => (
        <span className="font-medium text-gray-800">{row.employeeName}</span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (row) => formatCurrency(row.amount),
    },
    {
      key: "date",
      header: "Date",
      render: (row) => formatDateToDDMMMYYYY(row.date),
    },
    {
      key: "reason",
      header: "Reason",
      align: "text-left",
      render: (row) => row.reason || "—",
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span
          className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${statusColors[row.status] || "bg-gray-100 text-gray-700"}`}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex justify-center gap-2">
          {row.status === "pending" && (
            <>
              <button
                onClick={() => onUpdateStatus(row._id, "approved")}
                className="text-gray-500 hover:text-green-600"
                title="Approve"
              >
                <Check size={16} />
              </button>
              <button
                onClick={() => onUpdateStatus(row._id, "rejected")}
                className="text-gray-500 hover:text-red-600"
                title="Reject"
              >
                <X size={16} />
              </button>
            </>
          )}
          {row.status === "approved" && (
            <button
              onClick={() => onUpdateStatus(row._id, "repaid")}
              className="text-gray-500 hover:text-blue-600"
              title="Mark Repaid"
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button
            onClick={() => onEdit(row)}
            className="text-indigo-600"
            title="Edit"
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={() => onDelete(row)}
            className="text-red-600"
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
        data={advances}
        selectable
        selected={selected}
        onSelectAll={toggleSelectAll}
        onSelectRow={toggleSelect}
        emptyMessage="No advances found"
      />
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </>
  );
};

export default AdvanceList;
