// src/components/expenses/OfficeExpenseList.jsx
import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import Table from "../common/Table";
import Pagination from "../common/Pagination";
import { formatCurrency } from "../../utils/numberUtils";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";

const OfficeExpenseList = ({
  expenses,
  selected,
  toggleSelect,
  toggleSelectAll,
  onEdit,
  onDelete,
  currentPage,
  totalPages,
  onPageChange,
}) => {
  const columns = [
    {
      key: "categoryName",
      header: "Category",
      align: "text-left",
      render: (row) => (
        <span className="font-medium text-gray-800">{row.categoryName}</span>
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
      key: "note",
      header: "Note",
      align: "text-left",
      render: (row) => row.note || "—",
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
      render: (row) => (
        <div className="flex justify-center gap-3">
          <button onClick={() => onEdit(row)} className="text-indigo-600" title="Edit">
            <Pencil size={16} />
          </button>
          <button onClick={() => onDelete(row)} className="text-red-600" title="Delete">
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
        data={expenses}
        selectable
        selected={selected}
        onSelectAll={toggleSelectAll}
        onSelectRow={toggleSelect}
        emptyMessage="No expenses found"
      />
      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={onPageChange} />
    </>
  );
};

export default OfficeExpenseList;
