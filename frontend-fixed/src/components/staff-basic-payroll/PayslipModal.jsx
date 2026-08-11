// src/components/staff-basic-payroll/PayslipModal.jsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Download, FileText, Loader } from "lucide-react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import { payrollService } from "../../services/payrollService";
import { formatCurrency } from "../../utils/numberUtils";
import { showToast } from "../../utils/toast";
import {
  buildPayslipData,
  generatePayslipPDF,
  formatPeriodLabel,
} from "../../utils/payslipGenerator";

const STATUS_STYLES = {
  paid: "bg-green-100 text-green-700",
  partial: "bg-amber-100 text-amber-700",
  pending: "bg-gray-100 text-gray-600",
  cancelled: "bg-red-100 text-red-600",
};

const PayslipModal = ({ isOpen, onClose, record }) => {
  const [payrolls, setPayrolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checkedPeriods, setCheckedPeriods] = useState([]);
  const [downloadingPeriod, setDownloadingPeriod] = useState(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);

  const fetchPayrolls = useCallback(async () => {
    if (!record?.employeeId) return;
    try {
      setLoading(true);
      const res = await payrollService.getAll({
        employeeId: record.employeeId,
      });
      const rows = res.data?.data || res.data || [];
      // Newest month first
      rows.sort((a, b) => (a.period < b.period ? 1 : -1));
      setPayrolls(rows);
      setCheckedPeriods([]);
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to load payroll history",
      );
    } finally {
      setLoading(false);
    }
  }, [record]);

  useEffect(() => {
    if (isOpen) fetchPayrolls();
  }, [isOpen, fetchPayrolls]);

  const allChecked = useMemo(
    () => payrolls.length > 0 && checkedPeriods.length === payrolls.length,
    [payrolls, checkedPeriods],
  );

  const toggleMonth = (period) => {
    setCheckedPeriods((prev) =>
      prev.includes(period)
        ? prev.filter((p) => p !== period)
        : [...prev, period],
    );
  };

  const toggleAll = () => {
    setCheckedPeriods(allChecked ? [] : payrolls.map((p) => p.period));
  };

  const downloadOne = async (payroll) => {
    const data = buildPayslipData(payroll, record);
    await generatePayslipPDF(data);
  };

  const handleDownloadSingle = async (payroll) => {
    setDownloadingPeriod(payroll.period);
    try {
      await downloadOne(payroll);
    } finally {
      setDownloadingPeriod(null);
    }
  };

  // Downloads each checked month's payslip as its own PDF file, one after
  // another (browsers block simultaneous multi-download triggers, so we
  // wait for each render+save to finish before starting the next).
  const handleDownloadSelected = async () => {
    if (checkedPeriods.length === 0) {
      showToast("error", "Select at least one month to download");
      return;
    }
    setBulkDownloading(true);
    try {
      const selectedPayrolls = payrolls.filter((p) =>
        checkedPeriods.includes(p.period),
      );
      for (let i = 0; i < selectedPayrolls.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await downloadOne(selectedPayrolls[i]);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      showToast("success", `${selectedPayrolls.length} payslip(s) downloaded`);
    } finally {
      setBulkDownloading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={record ? `Payslips — ${record.staffName}` : "Payslips"}
      size="max-w-lg"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={handleDownloadSelected}
            loading={bulkDownloading}
            disabled={checkedPeriods.length === 0}
          >
            <Download size={16} />
            Download Selected ({checkedPeriods.length})
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex justify-center items-center h-40">
          <Loader className="animate-spin text-blue-600" size={32} />
        </div>
      ) : payrolls.length === 0 ? (
        <div className="text-center text-gray-500 py-10">
          <FileText className="mx-auto mb-2 text-gray-300" size={36} />
          <p>No payroll records found for this staff member yet.</p>
          <p className="text-xs mt-1">
            Generate payroll for a month first from the Payroll page.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 pb-2 mb-1 border-b border-gray-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              className="w-4 h-4 accent-blue-600"
            />
            <span className="text-sm font-medium text-gray-700">
              Select all months
            </span>
          </label>

          {payrolls.map((p) => (
            <div
              key={p._id}
              className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50"
            >
              <label className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={checkedPeriods.includes(p.period)}
                  onChange={() => toggleMonth(p.period)}
                  className="w-4 h-4 accent-blue-600 shrink-0"
                />
                <div className="min-w-0">
                  <p className="font-medium text-gray-800">
                    {formatPeriodLabel(p.period)}
                  </p>
                  <p className="text-xs text-gray-500">
                    Net {formatCurrency(p.netSalary)}
                    <span
                      className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-medium capitalize ${
                        STATUS_STYLES[p.status] || STATUS_STYLES.pending
                      }`}
                    >
                      {p.status}
                    </span>
                  </p>
                </div>
              </label>
              <button
                onClick={() => handleDownloadSingle(p)}
                disabled={downloadingPeriod === p.period}
                className="text-blue-600 hover:text-blue-800 transition-colors p-1.5 shrink-0"
                title={`Download ${formatPeriodLabel(p.period)} payslip`}
              >
                {downloadingPeriod === p.period ? (
                  <Loader className="animate-spin" size={18} />
                ) : (
                  <Download size={18} />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};

export default PayslipModal;
