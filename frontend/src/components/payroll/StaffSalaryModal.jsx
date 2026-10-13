// src/components/payroll/StaffSalaryModal.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Eye, EyeOff, RefreshCw, Pencil } from "lucide-react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import Spinner from "../common/Spinner";
import EditSalaryRecordModal from "./EditSalaryRecordModal";
import { payrollService } from "../../services/payrollService";
import { showToast } from "../../utils/toast";
import { confirmDialog } from "../../utils/confirmationDialog";
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

// Shows every month-wise payroll record for one staff member — deductions,
// allowances and advance all itemized per month — instead of the old
// one-row-per-staff-per-month flat table.
const StaffSalaryModal = ({ isOpen, onClose, staffId, staffName, onChanged }) => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  // The month record open in the Edit modal (pencil icon in the Edit column)
  const [editingRecord, setEditingRecord] = useState(null);
  // "all" or a year string like "2026"
  const [selectedYear, setSelectedYear] = useState("all");
  // Pick the newest year only once per opening, so choosing "All years"
  // isn't undone when the list reloads (e.g. after a delete)
  const defaultYearApplied = useRef(false);

  const fetchHistory = useCallback(async () => {
    if (!staffId) return;
    try {
      setLoading(true);
      const res = await payrollService.getAll({
        employeeId: staffId,
        limit: 1000,
      });
      const data = res.data?.data || res.data || [];
      setRecords(
        [...data].sort((a, b) => (b.period || "").localeCompare(a.period || "")),
      );
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to load salary history",
      );
    } finally {
      setLoading(false);
    }
  }, [staffId]);

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
      setExpandedId(null);
      setSelectedYear("all");
      defaultYearApplied.current = false;
    }
  }, [isOpen, fetchHistory]);

  const handleRecalculate = async (row) => {
    const confirm = await confirmDialog({
      text: `Recalculate <b>${staffName}</b>'s ${row.period} payroll from current attendance data? This will overwrite the saved basic salary, payable days and net salary for this pending record.`,
      icon: "warning",
      confirmButtonText: "Yes, recalculate",
    });
    if (!confirm.isConfirmed) return;
    try {
      await payrollService.recalculate(row._id);
      showToast("success", "Payroll recalculated from current attendance data");
      await fetchHistory();
      onChanged?.();
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to recalculate payroll",
      );
    }
  };

  // Years that have at least one record, newest first
  const years = useMemo(() => {
    const set = new Set(
      records
        .map((r) => String(r.period || "").split("-")[0])
        .filter((y) => /^\d{4}$/.test(y)),
    );
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [records]);

  // Once records load, open the newest year's tab by default
  useEffect(() => {
    if (!defaultYearApplied.current && years.length > 0 && !loading) {
      defaultYearApplied.current = true;
      setSelectedYear(years[0]);
      return;
    }
    // If the selected year no longer has records (e.g. after a delete),
    // fall back to the newest year that does
    if (selectedYear !== "all" && years.length > 0 && !years.includes(selectedYear)) {
      setSelectedYear(years[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years, loading]);

  const countForYear = (year) =>
    records.filter((r) => String(r.period || "").startsWith(`${year}-`)).length;

  const visibleRecords = useMemo(
    () =>
      selectedYear === "all"
        ? records
        : records.filter((r) =>
            String(r.period || "").startsWith(`${selectedYear}-`),
          ),
    [records, selectedYear],
  );

  const totals = visibleRecords.reduce(
    (acc, r) => {
      acc.net += r.netSalary || 0;
      acc.pending += r.pendingAmount || 0;
      return acc;
    },
    { net: 0, pending: 0 },
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={staffName ? `${staffName} — Salary History` : "Salary History"}
      size="max-w-5xl"
    >
      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {years.length > 0 && (
            <div
              role="tablist"
              aria-label="Filter salary history by year"
              className="flex gap-1 overflow-x-auto border-b border-gray-200"
            >
              {[...years, "all"].map((year) => {
                const active = selectedYear === year;
                const count =
                  year === "all" ? records.length : countForYear(year);
                return (
                  <button
                    key={year}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setSelectedYear(year);
                      setExpandedId(null);
                    }}
                    className={`-mb-px whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-t ${
                      active
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300"
                    }`}
                  >
                    {year === "all" ? "All years" : year}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                        active
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-4 text-sm">
            <div className="bg-gray-50 border rounded-xl px-4 py-2">
              <span className="text-gray-500">Months on record: </span>
              <span className="font-semibold text-gray-800">
                {visibleRecords.length}
              </span>
            </div>
            <div className="bg-gray-50 border rounded-xl px-4 py-2">
              <span className="text-gray-500">Total Net Paid: </span>
              <span className="font-semibold text-green-600">
                {formatCurrency(totals.net)}
              </span>
            </div>
       
          </div>

          <div className="overflow-x-auto border rounded-2xl shadow">
            <table className="w-full text-sm text-center border-collapse bg-white">
              <thead className="bg-gray-100 text-gray-700 border-b">
                <tr>
                  <th className="p-3 font-medium">Month</th>
                  <th className="p-3 font-medium">Year</th>
                  <th className="p-3 font-medium">Basic</th>
                  <th className="p-3 font-medium">Ded.</th>
                  <th className="p-3 font-medium">Advance</th>
                  <th className="p-3 font-medium">Pending</th>
                  <th className="p-3 font-medium">Net</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Edit</th>
                  <th className="p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRecords.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-8 text-gray-500">
                      {records.length === 0
                        ? "No salary records found for this staff member"
                        : `No salary records for ${selectedYear}`}
                    </td>
                  </tr>
                ) : (
                  visibleRecords.map((row) => {
                    const { month, year } = splitPeriod(row.period);
                    const isExpanded = expandedId === row._id;
                    return (
                      <React.Fragment key={row._id}>
                        <tr className="border-b hover:bg-gray-50">
                          <td className="p-3 font-medium text-gray-800">
                            {month}
                          </td>
                          <td className="p-3">{year}</td>
                          <td className="p-3">
                            {formatCurrency(
                              row.adjustedBasicSalary ?? row.basicSalary,
                            )}
                          </td>
                        
                          <td
                            className={
                              row.totalDeduction > 0
                                ? "p-3 text-red-500 font-medium"
                                : "p-3 text-gray-400"
                            }
                          >
                            {formatCurrency(row.totalDeduction)}
                          </td>
                          <td
                            className={
                              row.advanceDeduction > 0
                                ? "p-3 text-red-600 font-semibold"
                                : "p-3 text-gray-400"
                            }
                          >
                            {formatCurrency(row.advanceDeduction)}
                          </td>
                          <td
                            className={
                              row.pendingAmount > 0
                                ? "p-3 text-red-600 font-semibold"
                                : "p-3 text-gray-400"
                            }
                          >
                            {formatCurrency(row.pendingAmount)}
                          </td>
                          <td className="p-3 text-green-600 font-semibold">
                            {formatCurrency(row.netSalary)}
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-1 rounded-full text-xs capitalize ${
                                statusStyles[row.status] ||
                                "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => setEditingRecord(row)}
                              className="inline-flex items-center justify-center p-1.5 rounded-md text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 transition-colors"
                              title="Edit this month's salary record"
                              aria-label={`Edit ${month} ${year} salary`}
                            >
                              <Pencil size={16} />
                            </button>
                          </td>
                          <td className="p-3">
                            <div className="flex justify-center items-center gap-3">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedId(isExpanded ? null : row._id)
                                }
                                aria-expanded={isExpanded}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                  isExpanded
                                    ? "bg-blue-600 text-white hover:bg-blue-700"
                                    : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                                }`}
                                title={
                                  isExpanded
                                    ? "Hide this month's breakdown"
                                    : "View this month's breakdown"
                                }
                              >
                                {isExpanded ? (
                                  <EyeOff size={14} />
                                ) : (
                                  <Eye size={14} />
                                )}
                                {isExpanded ? "Hide" : "View"}
                              </button>
                              {row.status === "pending" && (
                                <button
                                  onClick={() => handleRecalculate(row)}
                                  className="text-amber-600 hover:text-amber-800"
                                  title="Recalculate from current attendance"
                                >
                                  <RefreshCw size={16} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b bg-gray-50">
                            <td colSpan={11} className="p-4 text-left">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                                <div>
                                  <p className="font-semibold text-gray-700 mb-1">
                                    Allowances
                                  </p>
                                  {row.allowances?.length ? (
                                    <ul className="space-y-1">
                                      {row.allowances.map((a, i) => (
                                        <li
                                          key={i}
                                          className="flex justify-between"
                                        >
                                          <span className="text-gray-600">
                                            {a.type}
                                          </span>
                                          <span>{formatCurrency(a.amount)}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="text-gray-400">None</p>
                                  )}
                                </div>
                                <div>
                                  <p className="font-semibold text-gray-700 mb-1">
                                    Deductions
                                  </p>
                                  {row.deductions?.length ? (
                                    <ul className="space-y-1">
                                      {row.deductions.map((d, i) => (
                                        <li
                                          key={i}
                                          className="flex justify-between"
                                        >
                                          <span className="text-gray-600">
                                            {d.type}
                                          </span>
                                          <span className="text-red-500">
                                            {formatCurrency(d.amount)}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="text-gray-400">None</p>
                                  )}
                                </div>
                                <div>
                                  <p className="font-semibold text-gray-700 mb-1">
                                    Advance / Attendance
                                  </p>
                                  <ul className="space-y-1">
                                    <li className="flex justify-between">
                                      <span className="text-gray-600">
                                        Advance deducted
                                      </span>
                                      <span>
                                        {formatCurrency(row.advanceDeduction)}
                                      </span>
                                    </li>
                                    <li className="flex justify-between">
                                      <span className="text-gray-600">
                                        Previous pending
                                      </span>
                                      <span>
                                        {formatCurrency(
                                          row.previousPendingAmount,
                                        )}
                                      </span>
                                    </li>
                                    <li className="flex justify-between">
                                      <span className="text-gray-600">
                                        Payable days
                                      </span>
                                      <span>
                                        {row.attendanceInfo?.payableDays ??
                                          "—"}{" "}
                                        /{" "}
                                        {row.attendanceInfo?.totalWorkingDays ??
                                          "—"}
                                      </span>
                                    </li>
                                    <li className="flex justify-between">
                                      <span className="text-gray-600">
                                        Unpaid leaves
                                      </span>
                                      <span>
                                        {row.attendanceInfo?.unpaidLeaves ??
                                          "—"}
                                      </span>
                                    </li>
                                  </ul>
                                </div>
                              </div>

                              {/* Every part paid for this month */}
                              {(() => {
                                const listed = (row.payments || []).filter(
                                  (p) => Number(p.amount) > 0,
                                );
                                const listedTotal = listed.reduce(
                                  (sum, p) => sum + Number(p.amount),
                                  0,
                                );
                                const earlier =
                                  (Number(row.paidAmount) || 0) - listedTotal;
                                const parts = [
                                  ...(earlier > 0.009
                                    ? [
                                        {
                                          amount: earlier,
                                          date: row.paymentDate,
                                          method: row.paymentMethod,
                                          note: "Earlier payment",
                                        },
                                      ]
                                    : []),
                                  ...listed,
                                ].sort(
                                  (a, b) =>
                                    new Date(a.date || 0) - new Date(b.date || 0),
                                );
                                if (!parts.length) return null;
                                return (
                                  <div className="mt-3">
                                    <p className="font-semibold text-gray-700 mb-1">
                                      Payments made ({parts.length})
                                    </p>
                                    <ul className="space-y-1">
                                      {parts.map((p, i) => (
                                        <li
                                          key={p._id || i}
                                          className="flex justify-between gap-3"
                                        >
                                          <span className="text-gray-600">
                                            {i + 1}.{" "}
                                            {p.date
                                              ? new Date(
                                                  p.date,
                                                ).toLocaleDateString("en-IN", {
                                                  day: "2-digit",
                                                  month: "short",
                                                  year: "numeric",
                                                })
                                              : "—"}
                                            {p.method ? ` · ${p.method}` : ""}
                                            {p.note ? ` · ${p.note}` : ""}
                                          </span>
                                          <span className="text-green-600 font-medium">
                                            {formatCurrency(p.amount)}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                );
                              })()}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      )}

      <EditSalaryRecordModal
        isOpen={!!editingRecord}
        record={editingRecord}
        staffName={staffName}
        onClose={() => setEditingRecord(null)}
        onSaved={async () => {
          await fetchHistory();
          onChanged?.();
        }}
      />
    </Modal>
  );
};

export default StaffSalaryModal;