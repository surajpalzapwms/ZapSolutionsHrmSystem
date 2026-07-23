// src/components/staff-basic-payroll/StaffBasicPayrollForm.jsx
import React, { useEffect } from "react";
import { useForm } from "../../hooks/useForm";
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

const validate = (form, isEdit) => {
  const errors = {};
  if (!isEdit && !validateRequired(form.staffId))
    errors.staffId = "Select an staff";
  if (!validatePositiveNumber(form.currentBasicSalary))
    errors.currentBasicSalary = "Enter a valid amount";
  if (!validateRequired(form.currentEffectiveFrom))
    errors.currentEffectiveFrom = "Effective date is required";
  return errors;
};

const StaffBasicPayrollForm = ({
  initialData = null,
  availableStaff = [],
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
      currentBasicSalary: "",
      currentEffectiveFrom: getTodayDate(),
      remarks: "",
    },
    (f) => validate(f, isEdit),
  );

  useEffect(() => {
    if (initialData) {
      setFields({
        staffId: initialData.staffId || "",
        staffName: initialData.staffName || "",
        currentBasicSalary: "",
        currentEffectiveFrom: getTodayDate(),
        remarks: "",
      });
    }
  }, [initialData, setFields]);

  const staffOptions = availableStaff.map((member) => ({
    value: member._id || member.staffId,
    label: member.staffName || member.name,
  }));

  const handleStaffChange = (value) => {
    const member = availableStaff.find((m) => (m._id || m.staffId) === value);
    setField("staffId", value);
    if (member) setField("staffName", member.staffName || member.name);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!runValidate()) return;

    try {
      setIsSubmitting(true);
      if (isEdit && initialData?._id) {
        await staffBasicPayrollService.addSalary(initialData._id, {
          basicSalary: Number(form.currentBasicSalary),
          effectiveFrom: form.currentEffectiveFrom,
          remarks: form.remarks,
        });
      } else {
        await staffBasicPayrollService.create({
          staffId: form.staffId,
          staffName: form.staffName,
          currentBasicSalary: Number(form.currentBasicSalary),
          currentEffectiveFrom: form.currentEffectiveFrom,
          remarks: form.remarks,
        });
      }
      onSubmit();
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to save record",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {isEdit ? (
        <InputField
          label="Staff"
          name="staffName"
          value={form.staffName}
          readOnly
        />
      ) : (
        <Dropdown
          label="Staff"
          value={form.staffId}
          onChange={handleStaffChange}
          options={staffOptions}
          placeholder="Select an staff"
          error={errors.staffId}
          required
        />
      )}
      <div className="grid grid-cols-2 gap-4">
        <InputField
          label={isEdit ? "New Basic Salary" : "Basic Salary"}
          name="currentBasicSalary"
          type="text"
          inputMode="decimal"
          value={form.currentBasicSalary}
          onChange={handleChange}
          error={errors.currentBasicSalary}
          required
        />
        <DatePicker
          label="Effective From"
          name="currentEffectiveFrom"
          value={form.currentEffectiveFrom}
          onChange={handleChange}
          error={errors.currentEffectiveFrom}
          required
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
          {isEdit ? "Add Revision" : "Add Record"}
        </Button>
      </div>
    </form>
  );
};

export default StaffBasicPayrollForm;
