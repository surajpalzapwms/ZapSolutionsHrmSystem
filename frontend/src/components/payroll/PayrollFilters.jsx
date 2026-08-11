// src/components/payroll/PayrollFilters.jsx
import React, { useState, useEffect, useCallback } from "react";
import { CalendarRange, X, Download } from "lucide-react";
import { getShortMonthName } from "../../utils/dateUtils";
import { staffService } from "../../services/staffService";
import { payrollService } from "../../services/payrollService";
import { formatCurrency } from "../../utils/numberUtils";
import { showToast } from "../../utils/toast";
import Modal from "../common/Modal";
import Dropdown from "../common/Dropdown";
import Button from "../common/Button";
import Spinner from "../common/Spinner";

const pad = (n) => String(n).padStart(2, "0");
const periodOf = (year, monthIndex) => `${year}-${pad(monthIndex + 1)}`;

const formatPeriodLabel = (period) => {
  if (!period) return "";
  const [y, m] = period.split("-").map(Number);
  return `${getShortMonthName(m - 1)} ${y}`;
};

/**
 * Quick month-range filter bar:
 *  - "<Current Month>" — just this month
 *  - "Jan to <Current Month>" — year-to-date
 *  - "Custom Calendar" — pick any from/to month
 */
const PayrollFilters = ({ periodFrom, periodTo, onRangeChange, onClear }) => {
  const now = new Date();
  const thisMonthPeriod = periodOf(now.getFullYear(), now.getMonth());
  const janPeriod = periodOf(now.getFullYear(), 0);

  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(periodFrom || janPeriod);
  const [customTo, setCustomTo] = useState(periodTo || thisMonthPeriod);

  // "Download by Staff" modal — pick a staff member, see every salary
  // record they've ever been paid, and download just theirs as CSV.
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [staffOptions, setStaffOptions] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [staffRecords, setStaffRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!showDownloadModal) return;
    staffService
      .getAll()
      .then((res) => {
        const list = res.data?.data ?? res.data ?? [];
        setStaffOptions(Array.isArray(list) ? list : []);
      })
      .catch(() => setStaffOptions([]));
  }, [showDownloadModal]);

  useEffect(() => {
    if (!selectedStaffId) {
      setStaffRecords([]);
      return;
    }
    setRecordsLoading(true);
    payrollService
      .getAll({ employeeId: selectedStaffId })
      .then((res) => {
        const list = res.data?.data ?? res.data ?? [];
        setStaffRecords(Array.isArray(list) ? list : []);
      })
      .catch(() => setStaffRecords([]))
      .finally(() => setRecordsLoading(false));
  }, [selectedStaffId]);

  const closeDownloadModal = () => {
    setShowDownloadModal(false);
    setSelectedStaffId("");
    setStaffRecords([]);
  };

  const handleDownloadStaffCSV = useCallback(async () => {
    if (!selectedStaffId) return;
    setDownloading(true);
    try {
      const res = await payrollService.export({ employeeId: selectedStaffId });
      const staffName =
        staffOptions.find((s) => s._id === selectedStaffId)?.staffName ||
        "staff";
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `${staffName.replace(/\s+/g, "_")}_salary_history.csv`,
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast("success", "Salary history downloaded");
    } catch (err) {
      showToast("error", "Failed to download salary history");
    } finally {
      setDownloading(false);
    }
  }, [selectedStaffId, staffOptions]);

  const staffSelectOptions = staffOptions.map((s) => ({
    value: s._id,
    label: s.staffName,
  }));

  const isActive = (from, to) =>
    !showCustom && periodFrom === from && periodTo === to;

  const applyThisMonth = () => {
    setShowCustom(false);
    onRangeChange(thisMonthPeriod, thisMonthPeriod);
  };

  const applyJanToNow = () => {
    setShowCustom(false);
    onRangeChange(janPeriod, thisMonthPeriod);
  };

  const applyCustom = () => {
    if (customFrom && customTo) onRangeChange(customFrom, customTo);
  };

  const hasFilter = Boolean(periodFrom && periodTo);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-gray-700">
          Filter by Month Range
        </p>
        <button
          type="button"
          onClick={() => setShowDownloadModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
        >
          <Download size={14} /> Download by Staff
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-gray-100">
        <button
          type="button"
          onClick={applyThisMonth}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            isActive(thisMonthPeriod, thisMonthPeriod)
              ? "bg-indigo-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          {getShortMonthName(now.getMonth())}
        </button>
        <button
          type="button"
          onClick={applyJanToNow}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            isActive(janPeriod, thisMonthPeriod)
              ? "bg-indigo-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Jan to {getShortMonthName(now.getMonth())}
        </button>
        <button
          type="button"
          onClick={() => setShowCustom((s) => !s)}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium border-b-2 transition-colors ${
            showCustom
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-700 hover:bg-gray-100"
          }`}
        >
          <CalendarRange size={14} /> Custom Calendar
        </button>
      </div>

      {showCustom && (
        <div className="flex flex-wrap items-end gap-3 pt-3">
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-500 mb-1">
              From
            </label>
            <input
              type="month"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-500 mb-1">To</label>
            <input
              type="month"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500"
            />
          </div>
          <button
            type="button"
            onClick={applyCustom}
            className="px-4 py-1.5 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Apply
          </button>
        </div>
      )}

      {hasFilter && (
        <div className="flex items-center gap-2 pt-3">
          <span className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 text-sm font-medium px-3 py-1 rounded-full">
            Showing:{" "}
            {periodFrom === periodTo
              ? formatPeriodLabel(periodFrom)
              : `${formatPeriodLabel(periodFrom)} to ${formatPeriodLabel(periodTo)}`}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-red-600"
          >
            <X size={14} /> Clear filter
          </button>
        </div>
      )}

      <Modal
        isOpen={showDownloadModal}
        onClose={closeDownloadModal}
        title="Download Salary by Staff"
        size="max-w-lg"
      >
        <div className="space-y-4">
          <Dropdown
            label="Staff Name"
            value={selectedStaffId}
            onChange={setSelectedStaffId}
            options={staffSelectOptions}
            placeholder="Select a staff member"
          />

          {!selectedStaffId ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              Select a staff member to see all salary given to them.
            </p>
          ) : recordsLoading ? (
            <div className="flex justify-center py-6">
              <Spinner size="sm" />
            </div>
          ) : staffRecords.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              No payroll records found for this staff member.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Period</th>
                    <th className="text-right px-3 py-2 font-medium">Net</th>
                    <th className="text-right px-3 py-2 font-medium">
                      Pending
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {staffRecords.map((r) => (
                    <tr key={r._id} className="border-t border-gray-100">
                      <td className="px-3 py-2">{r.period}</td>
                      <td className="px-3 py-2 text-right text-green-600 font-medium">
                        {formatCurrency(r.netSalary)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={
                            r.pendingAmount > 0
                              ? "text-red-600 font-semibold"
                              : "text-gray-400"
                          }
                        >
                          {formatCurrency(r.pendingAmount)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={closeDownloadModal}
            >
              Close
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleDownloadStaffCSV}
              loading={downloading}
              disabled={!selectedStaffId || staffRecords.length === 0}
            >
              <Download size={16} className="mr-1" /> Download CSV
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PayrollFilters;
