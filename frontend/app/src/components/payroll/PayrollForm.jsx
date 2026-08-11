// src/components/payroll/PayrollForm.jsx
import React from "react";
import { Calculator } from "lucide-react";
import { usePayrollForm } from "./hooks/usePayrollForm";
import AllowanceManager from "./AllowanceManager";
import InputField from "../common/InputField";
import TextArea from "../common/TextArea";
import Dropdown from "../common/Dropdown";
import Button from "../common/Button";

const paymentMethodOptions = [
  { value: "bank", label: "Bank Transfer" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
];

const formatMoney = (value) =>
  (Number(value) || 0).toLocaleString(undefined, {
    style: "currency",
    currency: "INR",
  });

const PayrollForm = ({
  initialData = null,
  onSubmit,
  onCancel,
  isEdit = false,
}) => {
  const {
    form,
    errors,
    isSubmitting,
    handleChange,
    setField,
    staffOptions,
    setStaff,
    calculate,
    calculating,
    summary,
    setAllowances,
    totalAllowance,
    totalPayable,
    paidAmount,
    pendingAmount,
    submit,
  } = usePayrollForm(initialData);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const ok = await submit(isEdit, initialData?._id);
    if (ok) onSubmit();
  };

  const staffSelectOptions = staffOptions.map((m) => ({
    value: m._id || m.staffId,
    label: m.staffName || m.name,
  }));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
        <Dropdown
          label="Staff Name"
          value={form.staffId}
          onChange={setStaff}
          options={staffSelectOptions}
          placeholder="Select Staff"
          error={errors.staffId}
          required
          disabled={isEdit}
        />
        <InputField
          label="Pay Period"
          name="period"
          type="month"
          value={form.period}
          onChange={handleChange}
          error={errors.period}
          required
        />
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={calculate}
        loading={calculating}
        disabled={!form.staffId || !form.period}
      >
        <Calculator size={16} className="mr-1" /> Calculate
      </Button>

      {summary && (
        <div className="border border-gray-200 rounded-lg p-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-gray-500">Full Monthly Basic Salary</span>
            <div className="font-semibold text-gray-800">
              {formatMoney(summary.basicSalary)}
            </div>
          </div>
          <div>
            <span className="text-gray-500">Leave Deduction</span>
            <div className="font-semibold text-gray-800">
              {formatMoney(summary.leaveDeduction)}
            </div>
          </div>
          <div>
            <span className="text-gray-500">Advance Deduction</span>
            <div className="font-semibold text-gray-800">
              {formatMoney(summary.advanceDeduction)}
            </div>
          </div>
          <div>
            <span className="text-gray-500">Previous Pending Balance</span>
            <div className="font-semibold text-gray-800">
              {formatMoney(summary.previousPendingAmount)}
            </div>
          </div>
        </div>
      )}

      <AllowanceManager
        allowances={form.allowances}
        onChange={setAllowances}
        total={totalAllowance}
      />

      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="Deductions"
          name="deductions"
          type="text"
          inputMode="decimal"
          value={form.deductions}
          onChange={handleChange}
        />
        <div className="flex flex-col justify-end">
          <label className="text-sm font-medium text-gray-700 mb-1">
            Total Payable
          </label>
          <div className="border rounded-md px-3 py-2 bg-gray-100 font-semibold text-gray-800">
            {formatMoney(totalPayable)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="Amount Paid Now"
          name="paidAmount"
          type="text"
          inputMode="decimal"
          value={form.paidAmount}
          onChange={handleChange}
          placeholder={totalPayable.toFixed(2)}
        />
        <div className="flex flex-col justify-end">
          <label className="text-sm font-medium text-gray-700 mb-1">
            Pending (carries to next month)
          </label>
          <div
            className={`border rounded-md px-3 py-2 font-semibold ${
              pendingAmount > 0
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-green-50 text-green-700 border-green-200"
            }`}
          >
            {formatMoney(pendingAmount)}
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-500 -mt-2">
        You can pay less than the total payable — the remaining balance is
        automatically added to next month's salary.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <Dropdown
          label="Payment Method"
          value={form.paymentMethod}
          onChange={(val) => setField("paymentMethod", val)}
          options={paymentMethodOptions}
        />
        <InputField
          label="Bank Account (optional)"
          name="bankAccount"
          value={form.bankAccount}
          onChange={handleChange}
        />
      </div>

      <TextArea
        label="Remarks"
        name="remarks"
        value={form.remarks}
        onChange={handleChange}
      />

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={isSubmitting}>
          {isEdit ? "Update Payroll" : "Add Payroll"}
        </Button>
      </div>
    </form>
  );
};

export default PayrollForm;
