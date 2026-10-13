// src/components/payroll/EditSalaryRecordModal.jsx
// Opened from the pencil icon in the Salary History table ("Edit" column).
// Edits one month's payroll record through PUT /api/hrm/payroll/:id — only
// the fields the backend allows changing:
//   • status, payment method, bank account, remarks, pending date
//   • advance deduction (only while the month is pending and nothing is paid)
//   • record a further payment against the pending amount
import React, { useEffect, useState } from "react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import { payrollService } from "../../services/payrollService";
import { showToast } from "../../utils/toast";
import { formatCurrency } from "../../utils/numberUtils";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

const METHOD_OPTIONS = [
  { value: "bank", label: "Bank Transfer" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
];

const toDateInput = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};

const inputCls =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100 disabled:text-gray-400";
const labelCls = "block text-xs font-medium text-gray-600 mb-1";

const EditSalaryRecordModal = ({ isOpen, onClose, record, staffName, onSaved }) => {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !record) return;
    setForm({
      status: record.status || "pending",
      paymentMethod: record.paymentMethod || "bank",
      bankAccount: record.bankAccount || "",
      remarks: record.remarks || "",
      pendingDate: toDateInput(record.pendingDate),
      advanceDeduction: String(record.advanceDeduction ?? 0),
      paymentAmount: "",
      paymentDate: toDateInput(new Date()),
      paymentNote: "",
    });
  }, [isOpen, record]);

  if (!record) return null;

  const pending = Number(record.pendingAmount) || 0;
  const canEditAdvance =
    record.status === "pending" && !(Number(record.paidAmount) > 0);
  const canAddPayment = pending > 0 && record.status !== "cancelled";
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    const payload = {
      paymentMethod: form.paymentMethod,
      bankAccount: form.bankAccount,
      remarks: form.remarks,
      pendingDate: form.pendingDate || null,
    };

    const pay = form.paymentAmount === "" ? 0 : Number(form.paymentAmount);
    if (Number.isNaN(pay) || pay < 0) {
      showToast("error", "Payment amount must be a positive number");
      return;
    }
    if (pay > pending + 0.01) {
      showToast("error", `Payment can't be more than the pending ${formatCurrency(pending)}`);
      return;
    }

    if (canEditAdvance) {
      const adv = Number(form.advanceDeduction);
      if (Number.isNaN(adv) || adv < 0) {
        showToast("error", "Advance deduction must be 0 or a positive number");
        return;
      }
      payload.advanceDeduction = adv;
    }

    if (pay > 0) {
      // A payment sets the status itself (partial / paid).
      payload.additionalPayment = pay;
      payload.paymentDate = form.paymentDate || undefined;
      payload.paymentNote = form.paymentNote || undefined;
    } else if (form.status !== record.status) {
      payload.status = form.status;
    }

    try {
      setSaving(true);
      await payrollService.update(record._id, payload);
      showToast("success", "Salary record updated");
      onSaved?.();
      onClose();
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to update salary record",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Salary — ${staffName ? `${staffName}, ` : ""}${record.period}`}
      size="max-w-lg"
    >
      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-xs text-center">
          <div className="rounded-lg bg-gray-50 border px-2 py-2">
            <div className="text-gray-500">Net</div>
            <div className="font-semibold text-gray-800">{formatCurrency(record.netSalary)}</div>
          </div>
          <div className="rounded-lg bg-gray-50 border px-2 py-2">
            <div className="text-gray-500">Paid</div>
            <div className="font-semibold text-green-600">{formatCurrency(record.paidAmount)}</div>
          </div>
          <div className="rounded-lg bg-gray-50 border px-2 py-2">
            <div className="text-gray-500">Pending</div>
            <div className="font-semibold text-red-600">{formatCurrency(pending)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Status</label>
            <select
              className={inputCls}
              value={form.status || "pending"}
              onChange={set("status")}
              disabled={Number(form.paymentAmount) > 0}
              title={
                Number(form.paymentAmount) > 0
                  ? "Status is set automatically from the payment"
                  : undefined
              }
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Payment Method</label>
            <select className={inputCls} value={form.paymentMethod || "bank"} onChange={set("paymentMethod")}>
              {METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Bank Account</label>
            <input className={inputCls} value={form.bankAccount || ""} onChange={set("bankAccount")} />
          </div>
          <div>
            <label className={labelCls}>Advance Deduction</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputCls}
              value={form.advanceDeduction ?? ""}
              onChange={set("advanceDeduction")}
              disabled={!canEditAdvance}
              title={
                canEditAdvance
                  ? undefined
                  : "Can only be changed while the month is pending and nothing is paid"
              }
            />
          </div>
          {pending > 0 && (
            <div className="sm:col-span-2">
              <label className={labelCls}>Pending Date</label>
              <input type="date" className={inputCls} value={form.pendingDate || ""} onChange={set("pendingDate")} />
            </div>
          )}
        </div>

        {canAddPayment && (
          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 space-y-3">
            <p className="text-xs font-semibold text-blue-700">Record a payment (optional)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Amount (max {formatCurrency(pending)})</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputCls}
                  value={form.paymentAmount}
                  onChange={set("paymentAmount")}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className={labelCls}>Paid On</label>
                <input type="date" className={inputCls} value={form.paymentDate || ""} onChange={set("paymentDate")} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Note</label>
                <input className={inputCls} value={form.paymentNote || ""} onChange={set("paymentNote")} placeholder="e.g. 2nd part" />
              </div>
            </div>
          </div>
        )}

        <div>
          <label className={labelCls}>Remarks</label>
          <textarea rows={2} className={inputCls} value={form.remarks || ""} onChange={set("remarks")} />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default EditSalaryRecordModal;
