// src/components/payroll/hooks/usePayrollForm.js
import { useState, useCallback, useEffect } from "react";
import { useForm } from "../../../hooks/useForm";
import { payrollService } from "../../../services/payrollService";
import { staffBasicPayrollService } from "../../../services/staffBasicPayrollService";
import { showToast } from "../../../utils/toast";
import { validateRequired } from "../../../utils/validation";
import { getCurrentMonth } from "../../../utils/dateUtils";

const validate = (form) => {
  const errors = {};
  if (!validateRequired(form.staffId)) errors.staffId = "Select a staff member";
  if (!validateRequired(form.period)) errors.period = "Pay period is required";
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
      allowances: [],
      deductions: 0,
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

  // Payroll calculation requires a Staff Basic Payroll record to exist, so
  // only offer staff who already have one — otherwise "Calculate" fails
  // with "Basic payroll not found".
  useEffect(() => {
    staffBasicPayrollService
      .getAll()
      .then((res) => {
        const records = res.data?.data || res.data || [];
        const options = records.map((r) => ({
          _id: r.employeeId,
          staffId: r.staffId,
          staffName: r.staffName,
        }));
        setStaffOptions(options);
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
        allowances: initialData.allowances || [],
        deductions: initialData.deductions ?? 0,
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
        // Default the amount paid to the full amount owed — the user can
        // lower it to make a partial payment; the rest carries to next month.
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
  const basicComponent = summary?.finalSalary ?? 0;
  const previousPendingAmount = summary?.previousPendingAmount ?? 0;
  const totalPayable = Math.max(
    0,
    basicComponent +
      totalAllowance -
      (Number(form.deductions) || 0) +
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

  const submit = useCallback(
    async (isEdit, id) => {
      if (!runValidate()) return false;
      if (!summary) {
        showToast("error", "Click Calculate before saving the payroll");
        return false;
      }
      try {
        setIsSubmitting(true);
        const payload = {
          employeeId: form.staffId,
          employeeName: form.staffName,
          period: form.period,
          allowances: form.allowances,
          deductions: Number(form.deductions) || 0,
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
    [form, paidAmount, summary, runValidate, setIsSubmitting],
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
    totalPayable,
    paidAmount,
    pendingAmount,
    submit,
  };
};
