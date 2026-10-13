// src/components/payroll/PayrollList.jsx
import React from "react";
import { Eye } from "lucide-react";
import Table from "../common/Table";
import Pagination from "../common/Pagination";
import Button from "../common/Button";
import { formatCurrency } from "../../utils/numberUtils";
import { getShortMonthName } from "../../utils/dateUtils";

const splitPeriod = (period) => {
  if (!period) return { month: "—", year: "—" };
  const [y, m] = period.split("-").map(Number);
  return { month: getShortMonthName((m || 1) - 1), year: y };
};

const statusStyles = {
  paid: "bg-green-100 text-green-700",
  partial: "bg-amber-100 text-amber-700",
  pending: "bg-gray-100 text-gray-600",
  cancelled: "bg-red-100 text-red-600",
};

const PayrollList = ({
  payroll,
  onViewSalary,
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
      key: "contactNo",
      header: "Contact",
      render: (row) => row.contactNo || "—",
    },
    
   
    {
      key: "latestPeriod",
      header: "Latest Period",
      render: (row) => {
        const { month, year } = splitPeriod(row.latestPeriod);
        return `${month} ${year}`;
      },
    },
    {
      key: "latestStatus",
      header: "Latest Status",
      render: (row) => (
        <span
          className={`px-2 py-1 rounded-full text-xs capitalize ${
            statusStyles[row.latestStatus] || "bg-gray-100 text-gray-600"
          }`}
        >
          {row.latestStatus}
        </span>
      ),
    },
    {
      key: "totalPending",
      header: "Pending",
      render: (row) => (
        <span
          className={
            row.totalPending > 0
              ? "text-red-600 font-semibold"
              : "text-gray-400"
          }
        >
          {formatCurrency(row.totalPending)}
        </span>
      ),
    },
    {
      key: "totalNet",
      header: "Total Net",
      render: (row) => (
        <span className="text-green-600 font-semibold">
          {formatCurrency(row.totalNet)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onViewSalary(row)}
          className="flex items-center gap-1.5"
        >
          <Eye size={14} /> View Salary
        </Button>
      ),
    },
  ];

  return (
    <>
      <Table
        columns={columns}
        data={payroll}
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
