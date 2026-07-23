// src/components/staff-basic-payroll/StaffBasicPayrollList.jsx
import React from "react";
import { Pencil, Trash2, History, Loader } from "lucide-react";
import Table from "../common/Table";
import Pagination from "../common/Pagination";
import { formatCurrency } from "../../utils/numberUtils";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";

const StaffBasicPayrollList = ({
  records,
  selected,
  toggleSelect,
  toggleSelectAll,
  onEdit,
  onDelete,
  onViewHistory,
  currentPage,
  totalPages,
  onPageChange,
  loading = false,
}) => {
  const columns = [
    { key: "staffId", header: "Staff ID", align: "text-center" },
    {
      key: "staffName",
      header: "Name",
      align: "text-left",
      render: (row) => (
        <span className="font-medium text-gray-800">{row.staffName}</span>
      ),
    },
    {
      key: "currentBasicSalary",
      header: "Basic Salary",
      align: "text-right",
      render: (row) => (
        <span className="font-semibold text-green-600">
          {formatCurrency(row.currentBasicSalary)}
        </span>
      ),
    },
    {
      key: "currentEffectiveFrom",
      header: "Effective From",
      align: "text-center",
      render: (row) =>
        row.currentEffectiveFrom
          ? formatDateToDDMMMYYYY(row.currentEffectiveFrom)
          : "—",
    },
    {
      key: "remarks",
      header: "Remarks",
      align: "text-left",
      render: (row) => row.remarks || "—",
    },
    {
      key: "actions",
      header: "Actions",
      align: "text-center",
      render: (row) => (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => onViewHistory(row)}
            className="text-blue-600 hover:text-blue-800 transition-colors"
            title="Salary History"
          >
            <History size={18} />
          </button>
          <button
            onClick={() => onEdit(row)}
            className="text-indigo-600 hover:text-indigo-800 transition-colors"
            title="Add Revision"
          >
            <Pencil size={18} />
          </button>
          <button
            onClick={() => onDelete(row)}
            className="text-red-600 hover:text-red-800 transition-colors"
            title="Delete"
          >
            <Trash2 size={18} />
          </button>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader className="animate-spin text-blue-600" size={40} />
      </div>
    );
  }

  return (
    <>
      <Table
        columns={columns}
        data={records}
        selectable
        selected={selected}
        onSelectAll={toggleSelectAll}
        onSelectRow={toggleSelect}
        emptyMessage="No staff basic payroll records found"
      />
      {records.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      )}
    </>
  );
};

export default StaffBasicPayrollList;
