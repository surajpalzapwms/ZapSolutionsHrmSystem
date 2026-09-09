
// src/components/payroll/PayrollList.jsx
import React from "react";
import { Eye, Trash2 } from "lucide-react";
import Table from "../common/Table";
import Pagination from "../common/Pagination";
import { formatCurrency } from "../../utils/numberUtils";
import { getShortMonthName } from "../../utils/dateUtils";

const splitPeriod = (period) => {
  if (!period) return { month: "—", year: "—" };
  const [y, m] = period.split("-").map(Number);
  return { month: getShortMonthName((m || 1) - 1), year: y };
};

const PayrollList = ({
  payroll,
  selected,
  toggleSelect,
  toggleSelectAll,
  onView,
  onDelete,
  currentPage,
  totalPages,
  onPageChange,
}) => {
  const columns = [
    {
      key: "staffName",
      header: "Employee",
      align: "text-left",
      render: (row) => (
        <span className="font-medium text-gray-800">{row.staffName}</span>
      ),
    },
    {
      key: "month",
      header: "Month",
      render: (row) => splitPeriod(row.period).month,
    },
    {
      key: "year",
      header: "Year",
      render: (row) => splitPeriod(row.period).year,
    },
   
    {
      key: "contactNo",
      header: "Contact",
      render: (row) => row.contactNo || "—",
    },
    {
      key: "basicSalary",
      header: "Basic",
      render: (row) =>
        formatCurrency(row.adjustedBasicSalary ?? row.basicSalary),
    },
    {
      key: "totalAllowance",
      header: "Allow.",
      render: (row) => (
        <div className="flex items-center justify-center gap-1.5">
          <span>{formatCurrency(row.totalAllowance)}</span>
          <button
            onClick={() => onView(row)}
            className="text-gray-400 hover:text-blue-600"
            title="View allowances"
          >
            <Eye size={14} />
          </button>
        </div>
      ),
    },
    {
      key: "totalDeduction",
      header: "Ded.",
      render: (row) => (
        <span
          className={
            row.totalDeduction > 0
              ? "text-red-500 font-medium"
              : "text-gray-400"
          }
        >
          {formatCurrency(row.totalDeduction)}
        </span>
      ),
    },
    {
      key: "advanceDeduction",
      header: "Advance",
      render: (row) => (
        <span
          className={
            row.advanceDeduction > 0
              ? "text-red-600 font-semibold"
              : "text-gray-400"
          }
        >
          {formatCurrency(row.advanceDeduction)}
        </span>
      ),
    },
    {
      key: "pendingAmount",
      header: "Pending",
      render: (row) => (
        <span
          className={
            row.pendingAmount > 0
              ? "text-red-600 font-semibold"
              : "text-gray-400"
          }
        >
          {formatCurrency(row.pendingAmount)}
        </span>
      ),
    },
    {
      key: "netSalary",
      header: "Net",
      render: (row) => (
        <span className="text-green-600 font-semibold">
          {formatCurrency(row.netSalary)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex justify-center gap-3">
          <button
            onClick={() => onView(row)}
            className="text-blue-600 hover:text-blue-800"
            title="View"
          >
            <Eye size={16} />
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
        data={payroll}
        selectable
        selected={selected}
        onSelectAll={toggleSelectAll}
        onSelectRow={toggleSelect}
        emptyMessage="No payroll records found"
      />
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </>
  );
};

export default PayrollList;