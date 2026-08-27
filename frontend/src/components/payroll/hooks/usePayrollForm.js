// src/components/payroll/hooks/usePayrollForm.js
import { useState, useCallback, useEffect } from "react";
import { useForm } from "../../../hooks/useForm";
import { payrollService } from "../../../services/payrollService";
import { staffService } from "../../../services/staffService";
import { showToast } from "../../../utils/toast";
import {
  validateRequired,
  validatePositiveNumber,
} from "../../../utils/validation";
import { getCurrentMonth } from "../../../utils/dateUtils";

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
      paidAmount: "",
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

  // Basic Salary can now be typed in directly, so any staff member can be
  // picked here — a Staff Basic Payroll record is only needed if the admin
  // chooses to use "Calculate" for attendance-based auto-fill.
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
        paidAmount: initialData.paidAmount ?? "",
        paymentMethod: initialData.paymentMethod || "bank",
        bankAccount: initialData.bankAccount || "",
        remarks: initialData.remarks || "",
      });
    }
  }, [initialData, setFields]);

  const setStaff = useCallback(
    (value) => {
      const member = staffOptions.find((m) => (m._id || m.staffId) === value);
      setField("staffId", value);
      setField("staffName", member?.staffName || member?.name || "");
      setField("basicSalary", "");
      setSummary(null);
    },
    [staffOptions, setField],
  );

  const calculate = useCallback(async () => {
    if (!form.staffId || !form.period) return;
    try {
      setCalculating(true);
      const res = await payrollService.calculate(form.staffId, form.period);
      const data = res.data?.data || res.data;
      if (data) {
        setSummary(data);
        // Auto-fill Basic Salary and the amount paid from the attendance-based
        // calculation — both remain editable so the admin can override them.
        setField("basicSalary", data.basicSalary);
        setField("paidAmount", data.totalPayable);
      }
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to calculate payroll",
      );
      setSummary(null);
    } finally {
      setCalculating(false);
    }
  }, [form.staffId, form.period, setField]);

  const totalAllowance = (form.allowances || []).reduce(
    (sum, a) => sum + (Number(a.amount) || 0),
    0,
  );
  const totalDeduction = (form.deductions || []).reduce(
    (sum, d) => sum + (Number(d.amount) || 0),
    0,
  );
  // Once "Calculate" has run, finalSalary already accounts for leave and
  // advance deductions. Before that (or if Basic Salary was edited after
  // calculating), fall back to the typed Basic Salary as an estimate — the
  // server always recalculates the authoritative figures on save.
  const basicComponent =
    summary?.finalSalary ?? (Number(form.basicSalary) || 0);
  const previousPendingAmount = summary?.previousPendingAmount ?? 0;
  const totalPayable = Math.max(
    0,
    basicComponent +
      totalAllowance -
      totalDeduction +
      previousPendingAmount,
  );
  const paidAmount =
    form.paidAmount === ""
      ? totalPayable
      : Math.min(Number(form.paidAmount) || 0, totalPayable);
  const pendingAmount = Math.max(0, totalPayable - paidAmount);

  const setAllowances = useCallback(
    (allowances) => setField("allowances", allowances),
    [setField],
  );

  const setDeductions = useCallback(
    (deductions) => setField("deductions", deductions),
    [setField],
  );

  const submit = useCallback(
    async (isEdit, id) => {
      if (!runValidate()) return false;
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
          paidAmount,
          paymentMethod: form.paymentMethod,
          bankAccount: form.bankAccount,
          remarks: form.remarks,
        };
        if (isEdit && id) {
          await payrollService.update(id, payload);
        } else {
          await payrollService.create(payload);
        }
        return true;
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
    [form, paidAmount, runValidate, setIsSubmitting],
  );

  return {
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
    setDeductions,
    totalDeduction,
    totalPayable,
    paidAmount,
    pendingAmount,
    submit,
  };
};