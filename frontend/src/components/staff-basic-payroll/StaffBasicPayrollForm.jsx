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
import { getTodayDate, toDateInputValue } from "../../utils/dateUtils";

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

// initialData: the parent record (for staff name / _id).
// editingEntry: null            -> add a brand new revision
//               a salaryHistory -> edit that existing revision in place
//               entry object
const StaffBasicPayrollForm = ({
  initialData = null,
  editingEntry = null,
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
    if (editingEntry) {
      // Editing a specific existing revision — prefill with its own values.
      setFields({
        staffId: initialData?.staffId || "",
        staffName: initialData?.staffName || "",
        currentBasicSalary: String(editingEntry.basicSalary ?? ""),
        currentEffectiveFrom: editingEntry.effectiveFrom
          ? toDateInputValue(editingEntry.effectiveFrom)
          : getTodayDate(),
        remarks: editingEntry.remarks || "",
      });
    } else if (initialData) {
      // Adding a brand new revision on top of an existing record.
      setFields({
        staffId: initialData.staffId || "",
        staffName: initialData.staffName || "",
        currentBasicSalary: "",
        currentEffectiveFrom: getTodayDate(),
        remarks: "",
      });
    }
  }, [initialData, editingEntry, setFields]);

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
  console.log("1️⃣ handleSubmit() started");

  e.preventDefault();
  console.log("2️⃣ e.preventDefault() executed");

  console.log("3️⃣ Running validation...");
  const isValid = runValidate();
  console.log("4️⃣ Validation result:", isValid);

  if (!isValid) {
    console.log("5️⃣ Validation failed → returning from handleSubmit()");
    return;
  }

  console.log("6️⃣ Validation passed → continuing");

  try {
    console.log("7️⃣ Entered try block");

    setIsSubmitting(true);
    console.log("8️⃣ setIsSubmitting(true) executed");

    console.log("9️⃣ Checking edit conditions...");
    console.log("   isEdit:", isEdit);
    console.log("   editingEntry:", editingEntry);
    console.log("   editingEntry?._id:", editingEntry?._id);
    console.log("   initialData:", initialData);
    console.log("   initialData?._id:", initialData?._id);

    if (isEdit && editingEntry?._id && initialData?._id) {
      console.log("🔵 CONDITION 1: Updating existing salary");

      console.log("10️⃣ Preparing updateSalary data");

      const salaryData = {
        basicSalary: Number(form.currentBasicSalary),
        effectiveFrom: form.currentEffectiveFrom,
        remarks: form.remarks,
      };

      console.log("11️⃣ salaryData:", salaryData);
      console.log("12️⃣ initialData._id:", initialData._id);
      console.log("13️⃣ editingEntry._id:", editingEntry._id);

      console.log("14️⃣ Calling staffBasicPayrollService.updateSalary()...");

      const response = await staffBasicPayrollService.updateSalary(
        initialData._id,
        editingEntry._id,
        salaryData,
      );

      console.log("15️⃣ updateSalary() completed");
      console.log("16️⃣ updateSalary response:", response);

    } else if (isEdit && initialData?._id) {
      console.log("🟡 CONDITION 2: Adding new salary to existing staff");

      console.log("17️⃣ Preparing addSalary data");

      const salaryData = {
        basicSalary: Number(form.currentBasicSalary),
        effectiveFrom: form.currentEffectiveFrom,
        remarks: form.remarks,
      };

      console.log("18️⃣ salaryData:", salaryData);
      console.log("19️⃣ initialData._id:", initialData._id);

      console.log("20️⃣ Calling staffBasicPayrollService.addSalary()...");

      const response = await staffBasicPayrollService.addSalary(
        initialData._id,
        salaryData,
      );

      console.log("21️⃣ addSalary() completed");
      console.log("22️⃣ addSalary response:", response);

    } else {
      console.log("🟢 CONDITION 3: Creating completely new payroll record");

      console.log("23️⃣ Preparing create data");

      const createData = {
        staffId: form.staffId,
        staffName: form.staffName,
        currentBasicSalary: Number(form.currentBasicSalary),
        currentEffectiveFrom: form.currentEffectiveFrom,
        remarks: form.remarks,
      };

      console.log("24️⃣ createData:", createData);

      console.log("25️⃣ Calling staffBasicPayrollService.create()...");

      const response = await staffBasicPayrollService.create(createData);

      console.log("26️⃣ create() completed");
      console.log("27️⃣ create response:", response);
    }

    console.log("28️⃣ API operation completed successfully");

    console.log("29️⃣ Calling onSubmit()...");
    onSubmit();
    console.log("30️⃣ onSubmit() completed");

  } catch (err) {
    console.error("❌ 31️⃣ ERROR occurred in handleSubmit()");
    console.error("32️⃣ Complete error object:", err);

    console.error("33️⃣ err.message:", err.message);
    console.error("34️⃣ err.response:", err.response);
    console.error("35️⃣ err.response?.data:", err.response?.data);
    console.error(
      "36️⃣ err.response?.data?.message:",
      err.response?.data?.message,
    );

    const errorMessage =
      err.response?.data?.message || "Failed to save record";

    console.error("37️⃣ Error message to show:", errorMessage);

    showToast("error", errorMessage);

    console.log("38️⃣ showToast() executed");

  } finally {
    console.log("39️⃣ Entered finally block");

    setIsSubmitting(false);
    console.log("40️⃣ setIsSubmitting(false) executed");

    console.log("41️⃣ handleSubmit() finished");
  }
};

  const submitLabel = editingEntry
    ? "Save Changes"
    : isEdit
      ? "Add Revision"
      : "Add Record";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {editingEntry && (
        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-3 py-2">
          Editing the selected revision — change the values below and click{" "}
          <strong>Save Changes</strong>.
        </div>
      )}
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
          {editingEntry ? "Cancel Edit" : "Cancel"}
        </Button>
        <Button type="submit" variant="primary" loading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
};

export default StaffBasicPayrollForm;