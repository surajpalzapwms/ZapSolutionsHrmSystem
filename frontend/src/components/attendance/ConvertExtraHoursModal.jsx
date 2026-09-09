// src/components/attendance/ConvertExtraHoursModal.jsx
import React, { useEffect } from "react";
import { RefreshCcw } from "lucide-react";
import { useForm } from "../../hooks/useForm";
import Dropdown from "../common/Dropdown";
import DatePicker from "../common/DatePicker";
import InputField from "../common/InputField";
import Button from "../common/Button";
import Modal from "../common/Modal";
import { validateRequired } from "../../utils/validation";
import { getTodayDate } from "../../utils/dateUtils";

const validate = (form) => {
  const errors = {};
  if (!validateRequired(form.userId)) errors.userId = "Please select an MR";
  if (!validateRequired(form.date)) errors.date = "Date is required";
  if (!form.leaveDays || Number(form.leaveDays) < 0.5)
    errors.leaveDays = "Enter at least 0.5 day";
  else if (Math.round(Number(form.leaveDays) * 2) !== Number(form.leaveDays) * 2)
    errors.leaveDays = "Enter in steps of 0.5 (e.g. 0.5, 1, 1.5, 2)";
  return errors;
};

// staffOptions here must be keyed by the linked login (attendance) user id,
// since the backend deducts extra hours from Attendance records tied to it.
const ConvertExtraHoursModal = ({ isOpen, onClose, onSubmit, staffOptions = [] }) => {
  const { form, errors, isSubmitting, setIsSubmitting, setField, reset, validate: runValidate } =
    useForm({ userId: "", date: getTodayDate(), leaveDays: 1 }, validate);

  useEffect(() => {
    if (isOpen) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!runValidate()) return;
    try {
      setIsSubmitting(true);
      const success = await onSubmit({
        userId: form.userId,
        date: form.date,
        leaveDays: Number(form.leaveDays),
      });
      if (success) onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Convert Extra Hours" size="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-500">
          Every 8 hours of accumulated extra time converts into 1 day of swap leave.
          You can enter a half-day amount too (e.g. 1.5).
        </p>
        <Dropdown
          label="Staff"
          required
          value={form.userId}
          onChange={(val) => setField("userId", val)}
          options={staffOptions}
          error={errors.userId}
          placeholder="Select an Staff"
        />
        <DatePicker
          label="Swap Leave Date"
          name="date"
          value={form.date}
          onChange={(e) => setField("date", e.target.value)}
          error={errors.date}
          required
        />
        <InputField
          label="Number of Days"
          name="leaveDays"
          type="number"
          min={0.5}
          step={0.5}
          value={form.leaveDays}
          onChange={(e) => setField("leaveDays", e.target.value)}
          error={errors.leaveDays}
          required
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            <RefreshCcw size={16} className="mr-1" /> Convert
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default ConvertExtraHoursModal;
