// src/components/holidays/HolidayForm.jsx
import React, { useEffect } from "react";
import { useForm } from "../../hooks/useForm";
import { holidayService } from "../../services/holidayService";
import InputField from "../common/InputField";
import TextArea from "../common/TextArea";
import DatePicker from "../common/DatePicker";
import Select from "../common/Select";
import Button from "../common/Button";
import { showToast } from "../../utils/toast";
import { validateRequired, validateDateRange } from "../../utils/validation";
import { getTodayDate } from "../../utils/dateUtils";

// "Emergency" is for same-day, unplanned closures (heavy rain, flooding,
// a strike, etc.) that an admin declares on the spot - as opposed to the
// other types, which are usually planned ahead of time.
const HOLIDAY_TYPE_OPTIONS = [
  { value: "General", label: "General" },
  { value: "Public", label: "Public" },
  { value: "Company", label: "Company" },
  { value: "Optional", label: "Optional" },
  { value: "Emergency", label: "Emergency (e.g. heavy rain)" },
];

const validate = (form) => {
  const errors = {};
  if (!validateRequired(form.name)) errors.name = "Name is required";
  if (!validateRequired(form.startDate)) errors.startDate = "Start date is required";
  if (form.endDate && !validateDateRange(form.startDate, form.endDate)) {
    errors.endDate = "End date must be after start date";
  }
  return errors;
};

const HolidayForm = ({ initialData = null, onSubmit, onCancel, isEdit = false }) => {
  const { form, errors, isSubmitting, setIsSubmitting, handleChange, setFields, validate: runValidate } =
    useForm(
      { name: "", startDate: "", endDate: "", description: "", type: "General" },
      validate
    );

  useEffect(() => {
    if (initialData) {
      setFields({
        name: initialData.name || "",
        startDate: initialData.startDate ? initialData.startDate.slice(0, 10) : "",
        endDate: initialData.endDate ? initialData.endDate.slice(0, 10) : "",
        description: initialData.description || "",
        type: initialData.type || "General",
      });
    }
  }, [initialData, setFields]);

  // Picking "Emergency" defaults both dates to today, since these are
  // almost always declared same-day - the admin can still change them.
  const handleTypeChange = (e) => {
    handleChange(e);
    if (e.target.value === "Emergency" && !isEdit && !form.startDate) {
      const today = getTodayDate();
      setFields({ ...form, type: "Emergency", startDate: today, endDate: today });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!runValidate()) return;

    try {
      setIsSubmitting(true);
      if (isEdit && initialData?._id) {
        await holidayService.update(initialData._id, form);
      } else {
        await holidayService.create(form);
      }
      onSubmit();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to save holiday");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <InputField
        label="Holiday Name"
        name="name"
        value={form.name}
        onChange={handleChange}
        error={errors.name}
        required
        placeholder="e.g. Independence Day"
      />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
        <Select
          name="type"
          value={form.type}
          onChange={handleTypeChange}
          options={HOLIDAY_TYPE_OPTIONS}
          placeholder="Select type"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <DatePicker
          label="Start Date"
          name="startDate"
          value={form.startDate}
          onChange={handleChange}
          error={errors.startDate}
          required
        />
        <DatePicker
          label="End Date"
          name="endDate"
          value={form.endDate}
          onChange={handleChange}
          error={errors.endDate}
        />
      </div>
      <TextArea
        label="Description"
        name="description"
        value={form.description}
        onChange={handleChange}
        placeholder="Optional description"
      />
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={isSubmitting}>
          {isEdit ? "Update Holiday" : "Add Holiday"}
        </Button>
      </div>
    </form>
  );
};

export default HolidayForm;
