// src/components/payroll/hooks/usePayrollForm.js
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useForm } from "../../../hooks/useForm";
import { payrollService } from "../../../services/payrollService";
import { staffService } from "../../../services/staffService";
import { advanceService } from "../../../services/advanceService";
import { showToast } from "../../../utils/toast";
import {
  validateRequired,
  validatePositiveNumber,
} from "../../../utils/validation";
import { getCurrentMonth } from "../../../utils/dateUtils";

import { formatMoney } from "../../../utils/brand";
// ── Month helpers ("YYYY-MM") ─────────────────────────────────────────
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const formatPeriod = (period) => {
  if (!/^\d{4}-\d{2}$/.test(period || "")) return period || "";
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${y}`;
};
const shiftPeriod = (period, delta) => {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const periodOfDate = (value) => {
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const money = (n) => formatMoney(n);
const recordEmployeeId = (r) => String(r?.employeeId?._id ?? r?.employeeId ?? "");

// Today as "YYYY-MM-DD" in the user's LOCAL time (toISOString() is UTC, so
// in India it would still show yesterday before 5:30 am).
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// One "Paid On + Amount" row of the payment entry table.
const newPaymentRow = (date = todayLocal()) => ({ date, amount: "" });
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Staff, Pay Period, and Basic Salary are the only mandatory fields —
// everything else (allowances, deductions, payment info, remarks) is
// optional and can be filled in later.
const validate = (form) => {
  const errors = {};
  if (!validateRequired(form.staffId)) errors.staffId = "Select a staff member";
  if (!validateRequired(form.period)) errors.period = "Pay period is required";
  if (!validatePositiveNumber(form.basicSalary))
    errors.basicSalary = "Enter a valid Basic Salary";
  return errors;
};

export const usePayrollForm = (initialData) => {
  const {
    form,
    errors,
    isSubmitting,
    setIsSubmitting,
    handleChange,
    setField,
    setFields,
    validate: runValidate,
  } = useForm(
    {
      staffId: "",
      staffName: "",
      period: getCurrentMonth(),
      basicSalary: "",
      allowances: [],
      deductions: [],
      // Payments being entered now — each with the date it was ACTUALLY
      // paid, e.g. 12 Aug ₹2,000 · 18 Aug ₹3,500 · 20 Aug ₹4,199.42.
      // All amounts empty = pay the full amount due, dated on the first row.
      payments: [newPaymentRow()],
      // How much of the staff member's outstanding advance to recover from
      // this month's salary — chosen by the admin (empty = 0, nothing).
      advanceDeduction: "",
      paymentMethod: "bank",
      bankAccount: "",
      remarks: "",
    },
    validate,
  );

  const [staffOptions, setStaffOptions] = useState([]);
  const [calculating, setCalculating] = useState(false);
  // Result of the last "Calculate" call — full basic salary, leave deduction,
  // advance deduction, previous month's pending balance, and total payable.
  const [summary, setSummary] = useState(null);
  // Edit mode only: advance still owed, counting what THIS payroll already
  // recovered as available again (so the admin can raise or lower it).
  const [editOutstanding, setEditOutstanding] = useState(
    Number(initialData?.advanceDeduction) || 0,
  );

  useEffect(() => {
    if (!initialData) return;
    const empId = initialData.employeeId?._id || initialData.employeeId;
    if (!empId) return;
    advanceService
      .getOutstanding(empId)
      .then((res) => {
        const total = Number(res.data?.data?.totalOutstanding) || 0;
        setEditOutstanding(total + (Number(initialData.advanceDeduction) || 0));
      })
      .catch(() => {});
  }, [initialData]);

  useEffect(() => {
    staffService
      .getAll()
      .then((res) => {
        const records = res.data?.data || res.data || [];
        setStaffOptions(records);
      })
      .catch(() => setStaffOptions([]));
  }, []);

  useEffect(() => {
    if (initialData) {
      setFields({
        staffId: initialData.employeeId?._id || initialData.employeeId || "",
        staffName:
          initialData.employeeId?.staffName ||
          initialData.staffName ||
          initialData.employeeName ||
          "",
        period: initialData.period || getCurrentMonth(),
        basicSalary: initialData.basicSalary ?? "",
        allowances: initialData.allowances || [],
        // Guard against legacy records that stored a plain deduction total
        // instead of itemized rows.
        deductions: Array.isArray(initialData.deductions)
          ? initialData.deductions
          : [],
        // Already-saved payments are shown in the history; these rows are
        // only for NEW payments added while editing.
        payments: [newPaymentRow()],
        advanceDeduction: initialData.advanceDeduction
          ? String(initialData.advanceDeduction)
          : "",
        paymentMethod: initialData.paymentMethod || "bank",
        bankAccount: initialData.bankAccount || "",
        remarks: initialData.remarks || "",
      });
    }
  }, [initialData, setFields]);

  // "YYYY-MM" of a relieved staff member's last working month, or null for
  // anyone still active. Used to cap the Pay Period picker so a staff
  // member who left in July can't have payroll raised for August/September
  // — there's nothing to pay them for a month they were never employed in.
  const relievedMaxPeriod = useCallback((member) => {
    if (!member || member.status !== "Relieved" || !member.relievingDate) {
      return null;
    }
    const d = new Date(member.relievingDate);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const setStaff = useCallback(
    (value) => {
      const member = staffOptions.find((m) => (m._id || m.staffId) === value);
      setField("staffId", value);
      setField("staffName", member?.staffName || member?.name || "");
      setField("basicSalary", "");
      setSummary(null);

      // Switching to a relieved staff member whose last working month is
      // earlier than the currently-picked period would otherwise leave an
      // invalid (post-relieving) period silently selected — pull it back
      // to their last working month instead.
      const maxPeriod = relievedMaxPeriod(member);
      if (maxPeriod && form.period > maxPeriod) {
        setField("period", maxPeriod);
      }
    },
    [staffOptions, setField, relievedMaxPeriod, form.period],
  );

  const selectedStaff = staffOptions.find(
    (m) => (m._id || m.staffId) === form.staffId,
  );
  const maxPeriod = relievedMaxPeriod(selectedStaff);

  // ── This staff member's existing payroll months ──────────────────────
  // A month can be paid in several parts (e.g. 2,000 + 5,000 + 5,000):
  //   - no payroll yet for the month      -> "new": normal Add Payroll
  //   - payroll exists, balance still due -> "partial": record the next
  //     part against it, showing what was already paid
  //   - fully paid                         -> "paid": month is disabled
  //   - balance already carried into next month's payroll -> "carried":
  //     disabled here (pay it in that next month instead)
  const [staffRecords, setStaffRecords] = useState([]);
  const [recordsLoaded, setRecordsLoaded] = useState(false);

  useEffect(() => {
    if (initialData) return; // editing one known record — not needed
    if (!form.staffId) {
      setStaffRecords([]);
      setRecordsLoaded(false);
      return;
    }
    let cancelled = false;
    setRecordsLoaded(false);
    payrollService
      .getAll({ employeeId: form.staffId })
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.data || res.data || [];
        setStaffRecords(
          (Array.isArray(list) ? list : []).filter(
            (r) => recordEmployeeId(r) === String(form.staffId),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setStaffRecords([]);
      })
      .finally(() => {
        if (!cancelled) setRecordsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [form.staffId, initialData]);

  const recordByPeriod = useMemo(() => {
    const map = new Map();
    staffRecords.forEach((r) => {
      if (r.enabled === false || r.status === "cancelled") return;
      map.set(r.period, r);
    });
    return map;
  }, [staffRecords]);

  const periodStatusOf = useCallback(
    (period) => {
      const record = recordByPeriod.get(period);
      if (!record) return "new";
      const pending = Number(record.pendingAmount) || 0;
      if (record.status === "paid" || pending <= 0) return "paid";
      const next = recordByPeriod.get(shiftPeriod(period, 1));
      if (next && Number(next.previousPendingAmount) > 0) return "carried";
      return "partial";
    },
    [recordByPeriod],
  );

  // Month list for the Pay Period dropdown: joining month (or 2 years back)
  // up to this month — or the relieving month for someone who has left.
  const periodOptions = useMemo(() => {
    if (!form.staffId) return [];
    const endPeriod =
      maxPeriod && maxPeriod < getCurrentMonth() ? maxPeriod : getCurrentMonth();
    const joinPeriod = selectedStaff?.date ? periodOfDate(selectedStaff.date) : null;
    let startPeriod = joinPeriod || shiftPeriod(endPeriod, -24);
    const floor = shiftPeriod(endPeriod, -60);
    if (startPeriod < floor) startPeriod = floor;
    if (startPeriod > endPeriod) startPeriod = endPeriod;

    const periods = new Set();
    for (let p = startPeriod; p <= endPeriod; p = shiftPeriod(p, 1)) periods.add(p);
    recordByPeriod.forEach((_, p) => periods.add(p)); // older months with records

    return [...periods]
      .sort()
      .reverse()
      .map((p) => {
        const status = periodStatusOf(p);
        const r = recordByPeriod.get(p);
        let label = formatPeriod(p);
        if (status === "paid") label += " — Paid in full ✓";
        else if (status === "carried")
          label += ` — Balance carried to ${formatPeriod(shiftPeriod(p, 1))}`;
        else if (status === "partial")
          label += ` — Part paid (${money(r.paidAmount)} of ${money(r.totalPayable)})`;
        return {
          value: p,
          label,
          disabled: status === "paid" || status === "carried",
        };
      });
  }, [form.staffId, maxPeriod, selectedStaff, recordByPeriod, periodStatusOf]);

  // After the staff member's months load, don't leave a fully-paid month
  // selected — move to the latest month that can still be paid.
  useEffect(() => {
    if (initialData || !recordsLoaded || !periodOptions.length) return;
    const current = periodOptions.find((o) => o.value === form.period);
    if (current && !current.disabled) return;
    const firstOpen = periodOptions.find((o) => !o.disabled);
    if (firstOpen) setField("period", firstOpen.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordsLoaded, periodOptions]);

  const periodMode = initialData
    ? "edit"
    : !form.staffId || !form.period
      ? "new"
      : !recordsLoaded
        ? "loading"
        : periodStatusOf(form.period);
  const existingRecord =
    periodMode === "partial" || periodMode === "paid" || periodMode === "carried"
      ? recordByPeriod.get(form.period)
      : null;
  // Record whose saved payments are listed: the month picked in Add
  // Payroll, or the record being edited.
  const historyRecord = existingRecord || initialData || null;

  // Every part already paid for this month, oldest first. Older records only
  // have a total paidAmount — shown as one "Earlier payment".
  const paymentHistory = useMemo(() => {
    if (!historyRecord) return [];
    const list = Array.isArray(historyRecord.payments)
      ? historyRecord.payments.filter((p) => Number(p.amount) > 0)
      : [];
    const listed = list.reduce((sum, p) => sum + Number(p.amount), 0);
    const missing = (Number(historyRecord.paidAmount) || 0) - listed;
    const legacy =
      missing > 0.009
        ? [
            {
              amount: Math.round(missing * 100) / 100,
              date: historyRecord.paymentDate || historyRecord.createdAt,
              method: historyRecord.paymentMethod,
              note: "Earlier payment",
            },
          ]
        : [];
    return [...legacy, ...list].sort(
      (a, b) => new Date(a.date || 0) - new Date(b.date || 0),
    );
  }, [historyRecord]);

  // "Record Payment" figures for a part-paid month.
  const existingTotal = Number(existingRecord?.totalPayable) || 0;
  const existingPaid = Number(existingRecord?.paidAmount) || 0;
  const existingRemaining = Number(existingRecord?.pendingAmount) || 0;

  const calculate = useCallback(async () => {
    if (!form.staffId || !form.period) return;
    try {
      setCalculating(true);
      const res = await payrollService.calculate(form.staffId, form.period);
      const data = res.data?.data || res.data;
      if (data) {
        setSummary(data);
        // Basic Salary is fully driven by this calculation now — the field
        // is read-only in the UI, so this is the only place it's set.
        setField("basicSalary", data.basicSalary);
        // Empty amounts = "pay the full total", so the payment keeps
        // following the total when the admin changes the advance or allowances.
        setField("payments", [newPaymentRow()]);
        setField("advanceDeduction", "");
      }
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to calculate payroll",
      );
      setSummary(null);
      setField("basicSalary", "");
    } finally {
      setCalculating(false);
    }
  }, [form.staffId, form.period, setField]);

  // Basic Salary is no longer typed in manually — as soon as both Staff and
  // Pay Period are picked, automatically run the same calculation that used
  // to sit behind the "Calculate" button, and the field is shown read-only.
  // Only for new payroll (Add Payroll): an existing record being edited
  // keeps its already-saved basicSalary instead of silently recalculating
  // over it the moment the modal opens.
  // For a month that already has a payroll record, nothing is recalculated:
  // its saved figures are shown and only the next payment is entered.
  const isEditRef = useRef(!!initialData);
  useEffect(() => {
    if (isEditRef.current) return;
    if (!form.staffId || !form.period) {
      setSummary(null);
      setField("basicSalary", "");
      return;
    }
    if (periodMode === "loading") return; // wait until the months are known
    if (periodMode !== "new") {
      setSummary(null);
      setField("basicSalary", existingRecord?.basicSalary ?? "");
      setField("payments", [newPaymentRow()]); // default: pay the whole remaining balance
      return;
    }
    calculate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.staffId, form.period, periodMode]);

  const totalAllowance = (form.allowances || []).reduce(
    (sum, a) => sum + (Number(a.amount) || 0),
    0,
  );
  const totalDeduction = (form.deductions || []).reduce(
    (sum, d) => sum + (Number(d.amount) || 0),
    0,
  );
  // ── Advance recovery (admin decides the amount each month) ──────────
  const isEditMode = !!initialData;
  // Only a payroll with no money paid on it yet can have its advance changed.
  const canEditAdvance =
    !isEditMode ||
    (initialData.status === "pending" && !(Number(initialData.paidAmount) > 0));
  // Salary after leave deduction but BEFORE any advance is taken off.
  const salaryBeforeAdvance = summary
    ? Number(summary.netSalary) || 0
    : isEditMode
      ? (Number(initialData.adjustedBasicSalary) || 0) +
        (Number(initialData.advanceDeduction) || 0)
      : Number(form.basicSalary) || 0;
  const outstandingAdvance = summary
    ? Number(summary.outstandingAdvance) || 0
    : isEditMode
      ? editOutstanding
      : 0;
  const maxAdvanceDeduction = Math.max(
    0,
    Math.min(outstandingAdvance, salaryBeforeAdvance),
  );
  const typedAdvance = Number(form.advanceDeduction) || 0;
  const advanceDeduction = Math.min(
    Math.max(0, typedAdvance),
    maxAdvanceDeduction,
  );
  const advanceError =
    typedAdvance < 0
      ? "Can't be negative"
      : typedAdvance > maxAdvanceDeduction + 0.001
        ? `Max ${maxAdvanceDeduction.toFixed(2)} this month`
        : "";
  const advanceBalanceAfter = Math.max(0, outstandingAdvance - advanceDeduction);
  const setAdvanceDeduction = useCallback(
    (value) => setField("advanceDeduction", value === "" ? "" : String(value)),
    [setField],
  );

  // The server always recalculates the authoritative figures on save.
  const basicComponent = Math.max(0, salaryBeforeAdvance - advanceDeduction);
  const previousPendingAmount =
    summary?.previousPendingAmount ??
    (isEditMode ? Number(initialData.previousPendingAmount) || 0 : 0);
  const totalPayable = Math.max(
    0,
    basicComponent +
      totalAllowance -
      totalDeduction +
      previousPendingAmount,
  );
  // ── Date-wise payments being entered now ─────────────────────────────
  // Each row = the date money was actually handed over + how much, e.g.
  //   12 Aug 2026  ₹2,000 · 18 Aug 2026  ₹3,500 · 20 Aug 2026  ₹4,199.42
  // even if all three are typed in on 20 Aug.
  const paymentRows = useMemo(
    () => (Array.isArray(form.payments) ? form.payments : []),
    [form.payments],
  );
  // Already paid before these rows, and the most these rows can add up to.
  const alreadyPaid =
    periodMode === "partial"
      ? existingPaid
      : isEditMode
        ? Number(initialData.paidAmount) || 0
        : 0;
  const amountDue = round2(
    periodMode === "partial"
      ? existingRemaining
      : Math.max(0, totalPayable - alreadyPaid),
  );
  const allAmountsBlank = paymentRows.every(
    (r) => String(r.amount ?? "").trim() === "",
  );
  // All blank = pay the full amount due on the first row's date (not while
  // editing — there blank simply means "no new payment").
  const payFullByDefault = allAmountsBlank && !isEditMode;
  const today = todayLocal();

  const paymentRowErrors = paymentRows.map((r) => {
    const e = {};
    const raw = String(r.amount ?? "").trim();
    const needsDate = raw !== "" || (payFullByDefault && r === paymentRows[0]);
    if (raw !== "" && (isNaN(raw) || Number(raw) < 0)) {
      e.amount = "Enter a valid amount";
    }
    if (needsDate && !r.date) e.date = "Pick the date it was paid";
    else if (needsDate && r.date > today) e.date = "Can't be a future date";
    return e;
  });

  // What will be sent to the server: [{ date, amount }], oldest first.
  const paymentsToSend = useMemo(() => {
    if (payFullByDefault) {
      return amountDue > 0
        ? [{ date: paymentRows[0]?.date || today, amount: amountDue }]
        : [];
    }
    return paymentRows
      .filter((r) => Number(r.amount) > 0)
      .map((r) => ({ date: r.date, amount: round2(r.amount) }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [payFullByDefault, amountDue, paymentRows, today]);

  const paidNow = round2(paymentsToSend.reduce((s, p) => s + p.amount, 0));
  const paymentsError = paymentRowErrors.some((e) => e.amount || e.date)
    ? "Fix the highlighted payment rows"
    : paidNow > amountDue + 0.009
      ? `Payments add up to ${money(paidNow)} but only ${money(amountDue)} is due`
      : periodMode === "partial" && paidNow <= 0
        ? "Enter the amount paid"
        : "";

  const addPaymentRow = useCallback(() => {
    setField("payments", [...paymentRows, newPaymentRow()]);
  }, [paymentRows, setField]);
  const removePaymentRow = useCallback(
    (index) => {
      const next = paymentRows.filter((_, i) => i !== index);
      setField("payments", next.length ? next : [newPaymentRow()]);
    },
    [paymentRows, setField],
  );
  const updatePaymentRow = useCallback(
    (index, key, value) => {
      setField(
        "payments",
        paymentRows.map((r, i) => (i === index ? { ...r, [key]: value } : r)),
      );
    },
    [paymentRows, setField],
  );
  // Puts whatever is still due into the last row (or a new row if the last
  // one already has an amount).
  const fillRemaining = useCallback(() => {
    const enteredSum = paymentRows.reduce(
      (s, r) => s + (Number(r.amount) > 0 ? Number(r.amount) : 0),
      0,
    );
    const left = round2(amountDue - enteredSum);
    if (left <= 0) return;
    const last = paymentRows[paymentRows.length - 1];
    if (last && String(last.amount ?? "").trim() === "") {
      setField(
        "payments",
        paymentRows.map((r, i) =>
          i === paymentRows.length - 1 ? { ...r, amount: String(left) } : r,
        ),
      );
    } else {
      setField("payments", [...paymentRows, { date: today, amount: String(left) }]);
    }
  }, [paymentRows, amountDue, setField, today]);

  // New payroll: paid on this record = these rows. Edit: saved + new rows.
  const paidAmount = round2(alreadyPaid + paidNow);
  const pendingAmount = Math.max(0, round2(totalPayable - paidAmount));
  // Part-paid month ("Record Payment") figures.
  const payNow = paidNow;
  const payNowError = periodMode === "partial" ? paymentsError : "";
  const remainingAfterPayment = Math.max(0, round2(existingRemaining - paidNow));

  const setAllowances = useCallback(
    (allowances) => setField("allowances", allowances),
    [setField],
  );

  const setDeductions = useCallback(
    (deductions) => setField("deductions", deductions),
    [setField],
  );

  // Adds one more part-payment to an existing, part-paid month.
  const submitPayment = useCallback(async () => {
    if (!existingRecord) return false;
    if (payNowError) {
      showToast("error", payNowError);
      return false;
    }
    try {
      setIsSubmitting(true);
      await payrollService.update(existingRecord._id, {
        // Each payment with the date it was actually paid.
        additionalPayments: paymentsToSend,
        paymentMethod: form.paymentMethod,
        paymentNote: form.remarks?.trim() || undefined,
      });
      return {
        message:
          remainingAfterPayment > 0
            ? `Payment of ${money(payNow)} recorded — ${money(remainingAfterPayment)} still due for ${formatPeriod(form.period)}`
            : `Payment of ${money(payNow)} recorded — ${formatPeriod(form.period)} is now paid in full`,
      };
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to record payment",
      );
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [
    existingRecord,
    payNow,
    payNowError,
    paymentsToSend,
    remainingAfterPayment,
    form.paymentMethod,
    form.remarks,
    form.period,
    setIsSubmitting,
  ]);

  const submit = useCallback(
    async (isEdit, id) => {
      if (!isEdit) {
        if (periodMode === "partial") return submitPayment();
        if (periodMode === "paid" || periodMode === "carried") {
          showToast(
            "error",
            periodMode === "paid"
              ? `${formatPeriod(form.period)} is already paid in full for this staff member.`
              : `${formatPeriod(form.period)}'s balance was carried into the next month — pay it there.`,
          );
          return false;
        }
        if (periodMode === "loading") return false;
      }
      if (!runValidate()) return false;
      // Belt-and-braces: the month picker's `max` stops this in the UI, but
      // guard here too in case the period was set before the staff member
      // was picked, or typed in directly.
      if (maxPeriod && form.period > maxPeriod) {
        showToast(
          "error",
          `This staff member left the organization — Pay Period can't be set later than ${maxPeriod}.`,
        );
        return false;
      }
      if (advanceError) {
        showToast("error", `Advance deduction: ${advanceError}`);
        return false;
      }
      if (paymentsError) {
        showToast("error", paymentsError);
        return false;
      }
      try {
        setIsSubmitting(true);
        const payload = {
          employeeId: form.staffId,
          employeeName: form.staffName,
          period: form.period,
          // Basic Salary is always sent explicitly — whether it was typed in
          // directly or auto-filled via "Calculate" — so it doesn't depend
          // on a Staff Basic Payroll record existing on the server.
          basicSalary: Number(form.basicSalary),
          allowances: form.allowances,
          deductions: form.deductions,
          // Date-wise payments: [{ date: "2026-08-12", amount: 2000 }, ...]
          ...(isEdit
            ? paymentsToSend.length && { additionalPayments: paymentsToSend }
            : { payments: paymentsToSend }),
          ...(canEditAdvance && { advanceDeduction }),
          paymentMethod: form.paymentMethod,
          bankAccount: form.bankAccount,
          remarks: form.remarks,
        };
        if (isEdit && id) {
          await payrollService.update(id, payload);
          return { message: "Payroll updated" };
        }
        await payrollService.create(payload);
        return {
          message:
            pendingAmount > 0
              ? `Payroll added — ${money(pendingAmount)} still due for ${formatPeriod(form.period)}`
              : "Payroll added and paid in full",
        };
      } catch (err) {
        showToast(
          "error",
          err.response?.data?.message || "Failed to save payroll",
        );
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      form,
      paymentsToSend,
      paymentsError,
      pendingAmount,
      periodMode,
      submitPayment,
      runValidate,
      setIsSubmitting,
      maxPeriod,
      advanceError,
      canEditAdvance,
      advanceDeduction,
    ],
  );

  return {
    form,
    errors,
    isSubmitting,
    handleChange,
    setField,
    staffOptions,
    setStaff,
    maxPeriod,
    calculate,
    calculating,
    summary,
    setAllowances,
    totalAllowance,
    setDeductions,
    totalDeduction,
    totalPayable,
    paidAmount,
    pendingAmount,
    // advance recovery
    outstandingAdvance,
    maxAdvanceDeduction,
    advanceDeduction,
    advanceBalanceAfter,
    advanceError,
    canEditAdvance,
    setAdvanceDeduction,
    submit,
    // month status / part payments
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
    // date-wise payment rows
    paymentRowErrors,
    paymentsError,
    paidNow,
    amountDue,
    alreadyPaid,
    payFullByDefault,
    addPaymentRow,
    removePaymentRow,
    updatePaymentRow,
    fillRemaining,
  };
};