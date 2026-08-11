// src/components/advance/AdvanceForm.jsx
import React, { useEffect, useState } from "react";
import { useForm } from "../../hooks/useForm";
import { advanceService } from "../../services/advanceService";
import { staffBasicPayrollService } from "../../services/staffBasicPayrollService";
import InputField from "../common/InputField";
import TextArea from "../common/TextArea";
import DatePicker from "../common/DatePicker";
import Dropdown from "../common/Dropdown";
import Button from "../common/Button";
import { showToast } from "../../utils/toast";
import {
  validateRequired,
  validatePositiveNumber,
} from "../../utils/validation";
import { getTodayDate } from "../../utils/dateUtils";

const validate = (form) => {
  const errors = {};
  if (!validateRequired(form.staffId)) errors.staffId = "Select an Staff";
  if (!validatePositiveNumber(form.amount))
    errors.amount = "Enter a valid amount";
  if (!validateRequired(form.date)) errors.date = "Date is required";
  return errors;
};

const AdvanceForm = ({
  initialData = null,
  onSubmit,
  onCancel,
  isEdit = false,
}) => {
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
      amount: "",
      date: getTodayDate(),
      reason: "",
      remarks: "",
    },
    validate,
  );

  const [staffOptions, setStaffOptions] = useState([]);

  // Only staff who already have a Staff Basic Payroll record can receive an
  // advance — payroll calculation looks up that record, so an advance for
  // staff without one would never be settleable.
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
        staffId:
          initialData.employeeId?._id ||
          initialData.employeeId ||
          initialData.staffId ||
          "",
        staffName:
          initialData.employeeId?.staffName ||
          initialData.employeeName ||
          initialData.staffName ||
          "",
        amount: initialData.amount ?? "",
        date: initialData.date ? initialData.date.slice(0, 10) : getTodayDate(),
        reason: initialData.reason || "",
        remarks: initialData.remarks || "",
      });
    }
  }, [initialData, setFields]);

  const staffSelectOptions = staffOptions.map((m) => ({
    value: m._id,
    label: m.staffName
      ? `${m.staffName}${m.staffId ? ` (${m.staffId})` : ""}`
      : m.staffId,
  }));

  const handleStaffChange = (value) => {
    const member = staffOptions.find((m) => m._id === value);
    setField("staffId", value);
    setField("staffName", member?.staffName || "");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!runValidate()) return;

    try {
      setIsSubmitting(true);
      // Backend expects employeeId/employeeName, not staffId/staffName.
      const payload = {
        employeeId: form.staffId,
        employeeName: form.staffName,
        amount: Number(form.amount),
        date: form.date,
        reason: form.reason,
        remarks: form.remarks,
      };
      if (isEdit && initialData?._id) {
        await advanceService.update(initialData._id, payload);
      } else {
        await advanceService.create(payload);
      }
      onSubmit();
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to save advance",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Dropdown
          label="Staff Name"
          value={form.staffId}
          onChange={handleStaffChange}
          options={staffSelectOptions}
          placeholder="Select Staff"
          error={errors.staffId}
          required
          disabled={isEdit}
        />
        <DatePicker
          label="Date"
          name="date"
          value={form.date}
          onChange={handleChange}
          error={errors.date}
          required
        />
      </div>
      <InputField
        label="Amount"
        name="amount"
        type="text"
        inputMode="decimal"
        value={form.amount}
        onChange={handleChange}
        error={errors.amount}
        required
      />
      <InputField
        label="Reason"
        name="reason"
        value={form.reason}
        onChange={handleChange}
        placeholder="e.g. Medical emergency"
      />
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
          {isEdit ? "Update Advance" : "Record Advance"}
        </Button>
      </div>
    </form>
  );
};

export default AdvanceForm;
