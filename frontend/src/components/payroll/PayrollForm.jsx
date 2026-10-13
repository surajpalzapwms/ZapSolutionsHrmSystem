// src/components/payroll/PayrollForm.jsx
import React from "react";
import {
  usePayrollForm,
  formatPeriod,
  todayLocal,
} from "./hooks/usePayrollForm";
import AllowanceManager from "./AllowanceManager";
import DeductionManager from "./DeductionManager";
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

// Every part already paid for the selected month.
const PaymentHistory = ({ payments }) => {
  if (!payments?.length) {
    return (
      <p className="text-xs text-gray-500">Nothing has been paid yet.</p>
    );
  }
  const total = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
      <table className="w-full text-xs text-gray-700">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">#</th>
            <th className="px-3 py-1.5 text-left font-medium">Paid on</th>
            <th className="px-3 py-1.5 text-right font-medium">Amount</th>
            <th className="px-3 py-1.5 text-left font-medium">Method</th>
            <th className="px-3 py-1.5 text-left font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p, i) => (
            <tr key={p._id || i} className="border-t border-gray-100">
              <td className="px-3 py-1.5">{i + 1}</td>
              <td className="px-3 py-1.5">
                {p.date
                  ? new Date(p.date).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"}
              </td>
              <td className="px-3 py-1.5 text-right font-semibold text-green-700">
                {formatMoney(p.amount)}
              </td>
              <td className="px-3 py-1.5 capitalize">{p.method || "—"}</td>
              <td className="px-3 py-1.5">{p.note || "—"}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
            <td className="px-3 py-1.5" colSpan={2}>
              Paid so far
            </td>
            <td className="px-3 py-1.5 text-right text-green-700">
              {formatMoney(total)}
            </td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  );
};

// Date-wise payment entry: one row per payment with the date it was
// ACTUALLY paid, e.g. 12 Aug ₹2,000 · 18 Aug ₹3,500 · 20 Aug ₹4,199.42 —
// even when all of them are entered on the same day.
const PaymentRowsEditor = ({
  rows,
  rowErrors,
  error,
  amountDue,
  paidNow,
  payFullByDefault,
  maxDate,
  onChange,
  onAdd,
  onRemove,
  onFillRemaining,
  isEdit,
}) => (
  <div className="rounded-lg border border-gray-200 p-3 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-sm font-semibold text-gray-800">
        Amount Paid Now{" "}
        <span className="font-normal text-gray-500">
          (add one row for each date money was paid)
        </span>
      </h4>
      <span className="text-xs text-gray-600">
        Due:{" "}
        <span className="font-semibold text-gray-800">
          {formatMoney(amountDue)}
        </span>
      </span>
    </div>

    <div className="hidden sm:grid grid-cols-[2rem_1fr_1fr_2rem] gap-2 text-xs font-medium text-gray-500 px-1">
      <span>#</span>
      <span>Paid On</span>
      <span>Amount</span>
      <span />
    </div>

    {rows.map((row, i) => (
      <div
        key={i}
        className="grid grid-cols-[2rem_1fr_1fr_2rem] gap-2 items-start"
      >
        <span className="pt-2 text-sm text-gray-500">{i + 1}</span>
        <InputField
          name={`payments.${i}.date`}
          type="date"
          value={row.date}
          max={maxDate}
          onChange={(e) => onChange(i, "date", e.target.value)}
          error={rowErrors[i]?.date}
          aria-label={`Payment ${i + 1} paid on`}
        />
        <InputField
          name={`payments.${i}.amount`}
          type="text"
          inputMode="decimal"
          value={row.amount}
          onChange={(e) => onChange(i, "amount", e.target.value)}
          placeholder={
            i === 0 && payFullByDefault ? amountDue.toFixed(2) : "0.00"
          }
          error={rowErrors[i]?.amount}
          aria-label={`Payment ${i + 1} amount`}
        />
        <button
          type="button"
          onClick={() => onRemove(i)}
          disabled={rows.length === 1}
          className="mt-1.5 h-8 w-8 rounded-md border border-gray-300 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent"
          title="Remove this payment"
          aria-label={`Remove payment ${i + 1}`}
        >
          ×
        </button>
      </div>
    ))}

    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAdd}
          className="px-2.5 py-1 text-xs rounded-md border border-indigo-300 text-indigo-700 bg-white hover:bg-indigo-50"
        >
          + Add Payment
        </button>
        {amountDue > 0 && (
          <button
            type="button"
            onClick={onFillRemaining}
            className="px-2.5 py-1 text-xs rounded-md border border-gray-300 bg-white hover:bg-gray-50"
          >
            Fill remaining
          </button>
        )}
      </div>
      <span className="text-sm text-gray-700">
        Total paid now:{" "}
        <span className="font-semibold text-green-700">
          {formatMoney(paidNow)}
        </span>
      </span>
    </div>

    {error && <p className="text-xs text-red-600">{error}</p>}
    <p className="text-xs text-gray-500">
      {isEdit
        ? "Add rows only for new payments — payments already saved are listed above."
        : `Leave every amount empty to pay the full ${formatMoney(amountDue)} on the first row's date.`}
    </p>
  </div>
);

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
    maxPeriod,
    calculating,
    summary,
    setAllowances,
    totalAllowance,
    setDeductions,
    totalDeduction,
    totalPayable,
    pendingAmount,
    outstandingAdvance,
    maxAdvanceDeduction,
    advanceDeduction,
    advanceBalanceAfter,
    advanceError,
    canEditAdvance,
    setAdvanceDeduction,
    submit,
    periodOptions,
    periodMode,
    existingRecord,
    paymentHistory,
    existingTotal,
    existingPaid,
    existingRemaining,
    payNow,
    payNowError,
    remainingAfterPayment,
    paymentRowErrors,
    paymentsError,
    paidNow,
    amountDue,
    payFullByDefault,
    addPaymentRow,
    removePaymentRow,
    updatePaymentRow,
    fillRemaining,
  } = usePayrollForm(initialData);

  const paymentRowsProps = {
    rows: form.payments || [],
    rowErrors: paymentRowErrors,
    error: paymentsError,
    amountDue,
    paidNow,
    payFullByDefault,
    maxDate: todayLocal(),
    onChange: updatePaymentRow,
    onAdd: addPaymentRow,
    onRemove: removePaymentRow,
    onFillRemaining: fillRemaining,
    isEdit,
  };

  const isNewPayroll = isEdit || periodMode === "new" || periodMode === "loading";
  const isPaymentMode = !isEdit && periodMode === "partial";
  const isLockedMonth =
    !isEdit && (periodMode === "paid" || periodMode === "carried");

  // Quick-pick amounts for advance recovery (only those that fit this month)
  const advanceQuickPicks = [500, 1000, 2000, 5000].filter(
    (v) => v < maxAdvanceDeduction,
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    const result = await submit(isEdit, initialData?._id);
    if (result) onSubmit(result);
  };

  const staffSelectOptions = staffOptions.map((m) => ({
    value: m._id || m.staffId,
    label: m.staffName || m.name,
  }));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Row 1: Staff Name | Pay Period | Basic Salary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
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
        {isEdit ? (
          <InputField
            label="Pay Period"
            name="period"
            type="month"
            value={form.period}
            onChange={handleChange}
            error={errors.period}
            max={maxPeriod || undefined}
            required
          />
        ) : (
          // Month list for the chosen staff member. Fully paid months (and
          // months whose balance moved to the next month) are disabled;
          // part-paid months show how much has been paid so far.
          <Dropdown
            label="Pay Period"
            value={form.period}
            onChange={(val) => setField("period", val)}
            options={periodOptions}
            placeholder={
              !form.staffId
                ? "Select staff first"
                : periodMode === "loading"
                  ? "Loading months…"
                  : "Select month"
            }
            error={errors.period}
            disabled={!form.staffId}
            required
          />
        )}
        <InputField
          label="Basic Salary"
          name="basicSalary"
          type="text"
          inputMode="decimal"
          value={
            calculating || periodMode === "loading"
              ? "Calculating…"
              : form.basicSalary
          }
          onChange={handleChange}
          error={errors.basicSalary}
          placeholder="Auto-calculated"
          readOnly
          required
        />
      </div>
      {maxPeriod && (
        <p className="text-xs text-amber-600 -mt-2">
          This staff member left the organization — Pay Period can't be set
          later than {maxPeriod}.
        </p>
      )}
      <p className="text-xs text-gray-500 -mt-2">
        Basic Salary is auto-calculated from attendance once Staff Name and
        Pay Period are selected (needs a Staff Basic Payroll record).
      </p>

      {/* ── New payroll for this month (normal Add Payroll) ─────────── */}
      {isNewPayroll && (
        <>
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
            <span className="text-gray-500">Outstanding Advance</span>
            <div className="font-semibold text-gray-800">
              {formatMoney(summary.outstandingAdvance)}
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

      {(outstandingAdvance > 0 || advanceDeduction > 0) && (
        <div className="border border-indigo-200 bg-indigo-50/40 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-800">
              Advance Recovery
            </h4>
            <span className="text-xs text-gray-600">
              Outstanding:{" "}
              <span className="font-semibold text-gray-800">
                {formatMoney(outstandingAdvance)}
              </span>
            </span>
          </div>

          {canEditAdvance ? (
            <>
              <InputField
                label="Deduct from this month's salary"
                name="advanceDeduction"
                type="text"
                inputMode="decimal"
                value={form.advanceDeduction}
                onChange={handleChange}
                placeholder="0 — don't deduct this month"
                error={advanceError}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAdvanceDeduction("")}
                  className="px-2.5 py-1 text-xs rounded-md border border-gray-300 bg-white hover:bg-gray-50"
                >
                  None
                </button>
                {advanceQuickPicks.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAdvanceDeduction(v)}
                    className="px-2.5 py-1 text-xs rounded-md border border-gray-300 bg-white hover:bg-gray-50"
                  >
                    {formatMoney(v)}
                  </button>
                ))}
                {maxAdvanceDeduction > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setAdvanceDeduction(
                        Number(maxAdvanceDeduction.toFixed(2)),
                      )
                    }
                    className="px-2.5 py-1 text-xs rounded-md border border-indigo-300 text-indigo-700 bg-white hover:bg-indigo-50"
                  >
                    {maxAdvanceDeduction < outstandingAdvance
                      ? `Max (${formatMoney(maxAdvanceDeduction)})`
                      : `Full (${formatMoney(maxAdvanceDeduction)})`}
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-700">
              Deducted on this payroll:{" "}
              <span className="font-semibold">
                {formatMoney(advanceDeduction)}
              </span>{" "}
              <span className="text-xs text-gray-500">
                (locked — payment already made)
              </span>
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Deducting now</span>
              <div className="font-semibold text-gray-800">
                {formatMoney(advanceDeduction)}
              </div>
            </div>
            <div>
              <span className="text-gray-500">Balance after this payroll</span>
              <div
                className={`font-semibold ${
                  advanceBalanceAfter > 0 ? "text-amber-700" : "text-green-700"
                }`}
              >
                {formatMoney(advanceBalanceAfter)}
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Leave empty to skip this month. Whatever isn't deducted stays as
            the outstanding advance and shows up again next month until it
            reaches zero.
          </p>
        </div>
      )}

      <AllowanceManager
        allowances={form.allowances}
        onChange={setAllowances}
        total={totalAllowance}
      />

      <DeductionManager
        deductions={form.deductions}
        onChange={setDeductions}
        total={totalDeduction}
      />

      <div className="flex flex-col justify-end">
        <label className="text-sm font-medium text-gray-700 mb-1">
          Total Payable
        </label>
        <div className="border rounded-md px-3 py-2 bg-gray-100 font-semibold text-gray-800">
          {formatMoney(totalPayable)}
        </div>
      </div>

      {/* Payments already saved on the record being edited */}
      {isEdit && paymentHistory.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-gray-800">
            Payments already made
          </h4>
          <PaymentHistory payments={paymentHistory} />
        </div>
      )}

      {/* Date-wise payments: Paid On + Amount, one row per payment */}
      <PaymentRowsEditor {...paymentRowsProps} />

      {/* Pending (carries to next month) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
        <div className="flex flex-col">
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
        You can pay less than the total payable, in as many parts as needed —
        each on its own date. The remaining balance is automatically added to
        next month's salary.
      </p>

        </>
      )}

      {/* ── Month already paid in full / balance moved to next month ── */}
      {isLockedMonth && existingRecord && (
        <div
          className={`rounded-lg border p-4 text-sm ${
            periodMode === "paid"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <p className="font-semibold">
            {periodMode === "paid"
              ? `${formatPeriod(form.period)} is already paid in full (${formatMoney(existingTotal)}).`
              : `${formatPeriod(form.period)}'s remaining ${formatMoney(existingRemaining)} was carried into the next month's payroll — record that payment there.`}
          </p>
          <PaymentHistory payments={paymentHistory} />
        </div>
      )}

      {/* ── Part-paid month: record the next part of the salary ──────── */}
      {isPaymentMode && existingRecord && (
        <>
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-gray-800">
                {formatPeriod(form.period)} — salary already started
              </h4>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold capitalize">
                {existingRecord.status}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-gray-500">Total for this month</span>
                <div className="font-semibold text-gray-800">
                  {formatMoney(existingTotal)}
                </div>
              </div>
              <div>
                <span className="text-gray-500">Paid so far</span>
                <div className="font-semibold text-green-700">
                  {formatMoney(existingPaid)}
                </div>
              </div>
              <div>
                <span className="text-gray-500">Still to pay</span>
                <div className="font-semibold text-red-600">
                  {formatMoney(existingRemaining)}
                </div>
              </div>
            </div>
            <PaymentHistory payments={paymentHistory} />
          </div>

          {/* Date-wise payments: Paid On + Amount, one row per payment */}
          <PaymentRowsEditor {...paymentRowsProps} />

          {/* Pending after this payment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            <div className="flex flex-col">
              <label className="text-sm font-medium text-gray-700 mb-1">
                Pending (after this payment)
              </label>
              <div
                className={`border rounded-md px-3 py-2 font-semibold ${
                  remainingAfterPayment > 0
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-green-50 text-green-700 border-green-200"
                }`}
              >
                {formatMoney(remainingAfterPayment)}
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 -mt-2">
            After these payments:{" "}
            {formatMoney(existingPaid + (payNowError ? 0 : payNow))} of{" "}
            {formatMoney(existingTotal)} paid.
          </p>
        </>
      )}

      {!isLockedMonth && (
      <>
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
        label={isPaymentMode ? "Note for these payments (optional)" : "Remarks"}
        name="remarks"
        value={form.remarks}
        onChange={handleChange}
      />
      </>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={isSubmitting}
          disabled={isLockedMonth || periodMode === "loading"}
        >
          {isEdit
            ? "Update Payroll"
            : isPaymentMode
              ? "Record Payment"
              : "Add Payroll"}
        </Button>
      </div>
    </form>
  );
};

export default PayrollForm;