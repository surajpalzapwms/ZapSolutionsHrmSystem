// src/components/advance/AdvanceList.jsx
import React, { useMemo, useState } from "react";
import { Pencil, Trash2, Eye, X } from "lucide-react";
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

// Balance for a single advance record
const getBalance = (row) =>
  row.status === "rejected"
    ? 0
    : Math.max(0, (Number(row.amount) || 0) - (Number(row.repaidAmount) || 0));

// Key used to group advances of the same person
const getEmployeeKey = (row) =>
  row.employeeId?._id ||
  row.employeeId ||
  row.employee?._id ||
  row.employee ||
  row.employeeName ||
  "unknown";

const AdvanceList = ({
  advances = [],
  selected = [],
  toggleSelect,
  toggleSelectAll,
  onEdit,
  onDelete,
  currentPage,
  totalPages,
  onPageChange,
}) => {
  const [viewKey, setViewKey] = useState(null);

  // One row per employee, with totals across all their advances
  const grouped = useMemo(() => {
    const map = new Map();
    advances.forEach((adv) => {
      const key = String(getEmployeeKey(adv));
      if (!map.has(key)) {
        map.set(key, {
          _id: key,
          employeeName: adv.employeeName,
          records: [],
          count: 0,
          amount: 0,
          repaidAmount: 0,
          balance: 0,
          lastDate: null,
        });
      }
      const g = map.get(key);
      g.records.push(adv);
      g.count += 1;
      if (adv.status !== "rejected") {
        g.amount += Number(adv.amount) || 0;
        g.repaidAmount += Number(adv.repaidAmount) || 0;
      }
      g.balance += getBalance(adv);
      if (!g.lastDate || new Date(adv.date) > new Date(g.lastDate)) {
        g.lastDate = adv.date;
      }
    });
    map.forEach((g) =>
      g.records.sort((a, b) => new Date(b.date) - new Date(a.date))
    );
    return Array.from(map.values());
  }, [advances]);

  const viewGroup = grouped.find((g) => g._id === viewKey) || null;

  // --- Selection: a group is selected when all its records are selected ---
  const isGroupSelected = (g) =>
    g.records.length > 0 && g.records.every((r) => selected.includes(r._id));

  const selectedGroupKeys = grouped
    .filter(isGroupSelected)
    .map((g) => g._id);

  const handleSelectGroup = (arg) => {
    const key = typeof arg === "object" && arg !== null ? arg._id : arg;
    const g = grouped.find((x) => x._id === key);
    if (!g) return;
    const allSelected = isGroupSelected(g);
    g.records.forEach((r) => {
      const isSel = selected.includes(r._id);
      // select all if not fully selected, otherwise unselect all
      if (allSelected ? isSel : !isSel) toggleSelect(r._id);
    });
  };

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
      key: "count",
      header: "Advances",
      render: (row) => (
        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs font-medium text-gray-700">
          {row.count}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Total Amount",
      render: (row) => formatCurrency(row.amount),
    },
    {
      key: "repaidAmount",
      header: "Recovered",
      render: (row) => formatCurrency(row.repaidAmount),
    },
    {
      key: "balance",
      header: "Balance",
      render: (row) => (
        <span
          className={`font-semibold ${row.balance > 0 ? "text-amber-700" : "text-green-700"}`}
        >
          {formatCurrency(row.balance)}
        </span>
      ),
    },
    {
      key: "lastDate",
      header: "Last Advance",
      render: (row) => (row.lastDate ? formatDateToDDMMMYYYY(row.lastDate) : "—"),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex justify-center">
          <button
            onClick={() => setViewKey(row._id)}
            className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-sm"
            title="View all advances"
          >
            <Eye size={16} /> View
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Table
        columns={columns}
        data={grouped}
        selectable
        selected={selectedGroupKeys}
        onSelectAll={toggleSelectAll}
        onSelectRow={handleSelectGroup}
        emptyMessage="No advances found"
      />
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />

      {/* ---- View modal: all advances of one staff member ---- */}
      {viewGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setViewKey(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">
                  {viewGroup.employeeName}
                </h3>
                <p className="text-sm text-gray-500">
                  {viewGroup.count} advance{viewGroup.count > 1 ? "s" : ""} · Total{" "}
                  {formatCurrency(viewGroup.amount)} · Balance{" "}
                  <span className="font-medium text-amber-700">
                    {formatCurrency(viewGroup.balance)}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setViewKey(null)}
                className="text-gray-400 hover:text-gray-600"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="overflow-auto p-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b">
                    <th className="py-2 text-left">Date</th>
                    <th className="py-2 text-right">Amount</th>
                    <th className="py-2 text-right">Recovered</th>
                    <th className="py-2 text-right">Balance</th>
                    <th className="py-2 text-left pl-4">Reason</th>
                    <th className="py-2 text-center">Status</th>
                    <th className="py-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {viewGroup.records.map((r) => {
                    const bal = getBalance(r);
                    return (
                      <tr key={r._id} className="border-b last:border-0">
                        <td className="py-2">{formatDateToDDMMMYYYY(r.date)}</td>
                        <td className="py-2 text-right">{formatCurrency(r.amount)}</td>
                        <td className="py-2 text-right">
                          {formatCurrency(r.repaidAmount || 0)}
                        </td>
                        <td
                          className={`py-2 text-right font-semibold ${bal > 0 ? "text-amber-700" : "text-green-700"}`}
                        >
                          {formatCurrency(bal)}
                        </td>
                        <td className="py-2 pl-4">{r.reason || "—"}</td>
                        <td className="py-2 text-center">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${statusColors[r.status] || "bg-gray-100 text-gray-700"}`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="py-2">
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={() => {
                                setViewKey(null);
                                onEdit(r);
                              }}
                              className="text-indigo-600"
                              title="Edit"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              onClick={() => onDelete(r)}
                              className="text-red-600"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AdvanceList;