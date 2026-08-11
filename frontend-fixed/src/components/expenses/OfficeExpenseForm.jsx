// src/components/expenses/OfficeExpenseForm.jsx
import React, { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { useForm } from "../../hooks/useForm";
import { officeExpenseService } from "../../services/officeExpenseService";
import { expenseCategoryService } from "../../services/expenseCategoryService";
import InputField from "../common/InputField";
import TextArea from "../common/TextArea";
import DatePicker from "../common/DatePicker";
import Dropdown from "../common/Dropdown";
import Button from "../common/Button";
import { showToast } from "../../utils/toast";
import { validateRequired, validatePositiveNumber } from "../../utils/validation";
import { getTodayDate } from "../../utils/dateUtils";

const validate = (form) => {
  const errors = {};
  if (!validateRequired(form.category)) errors.category = "Select a category";
  if (!validatePositiveNumber(form.amount)) errors.amount = "Enter a valid amount";
  if (!validateRequired(form.date)) errors.date = "Date is required";
  return errors;
};

const OfficeExpenseForm = ({
  initialData = null,
  onSubmit,
  onCancel,
  isEdit = false,
  onManageCategories,
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
      category: "",
      amount: "",
      date: getTodayDate(),
      note: "",
      remarks: "",
    },
    validate
  );

  const [categoryOptions, setCategoryOptions] = useState([]);

  const loadCategories = () => {
    expenseCategoryService
      .getAll()
      .then((res) => {
        const records = res.data?.data || res.data || [];
        setCategoryOptions(records.map((c) => ({ value: c._id, label: c.name })));
      })
      .catch(() => setCategoryOptions([]));
  };

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    if (initialData) {
      setFields({
        category: initialData.category?._id || initialData.category || "",
        amount: initialData.amount ?? "",
        date: initialData.date ? initialData.date.slice(0, 10) : getTodayDate(),
        note: initialData.note || "",
        remarks: initialData.remarks || "",
      });
    }
  }, [initialData, setFields]);

  const handleManageCategories = () => {
    onManageCategories?.(loadCategories);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!runValidate()) return;

    try {
      setIsSubmitting(true);
      const payload = {
        category: form.category,
        amount: Number(form.amount),
        date: form.date,
        note: form.note,
        remarks: form.remarks,
      };
      if (isEdit && initialData?._id) {
        await officeExpenseService.update(initialData._id, payload);
      } else {
        await officeExpenseService.create(payload);
      }
      onSubmit();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to save expense");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-gray-700">
              Category<span className="text-red-500 ml-1">*</span>
            </span>
            <button
              type="button"
              onClick={handleManageCategories}
              className="text-xs text-indigo-600 flex items-center gap-1 hover:underline"
            >
              <Settings size={12} />
              Manage
            </button>
          </div>
          <Dropdown
            value={form.category}
            onChange={(value) => setField("category", value)}
            options={categoryOptions}
            placeholder="Select category"
            error={errors.category}
          />
        </div>
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
        label="Note"
        name="note"
        value={form.note}
        onChange={handleChange}
        placeholder="e.g. July tea supplies"
      />
      <TextArea label="Remarks" name="remarks" value={form.remarks} onChange={handleChange} />
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={isSubmitting}>
          {isEdit ? "Update Expense" : "Add Expense"}
        </Button>
      </div>
    </form>
  );
};

export default OfficeExpenseForm;
