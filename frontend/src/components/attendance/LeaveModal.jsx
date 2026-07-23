// src/components/attendance/LeaveModal.jsx
import React, { useEffect, useMemo } from "react";
import { CalendarOff } from "lucide-react";
import { useForm } from "../../hooks/useForm";
import DatePicker from "../common/DatePicker";
import TextArea from "../common/TextArea";
import Dropdown from "../common/Dropdown";
import Button from "../common/Button";
import Modal from "../common/Modal";
import { LEAVE_TYPES } from "../../utils/constants";
import { validateRequired } from "../../utils/validation";
import { getTodayDate, getBlockedDayReason } from "../../utils/dateUtils";

const typeOptions = [
  { value: LEAVE_TYPES.PAID, label: "Paid Leave" },
  { value: LEAVE_TYPES.UNPAID, label: "Unpaid Leave" },
  { value: LEAVE_TYPES.SWAP, label: "Swap Leave" },
];

const LeaveModal = ({ isOpen, onClose, onSubmit, staffOptions = [], holidays = [] }) => {
  const validate = (form) => {
    const errors = {};
    if (!validateRequired(form.userId)) errors.userId = "Please select an Staff";
    if (!validateRequired(form.leaveDate)) errors.leaveDate = "Leave date is required";
    if (!validateRequired(form.reason)) errors.reason = "Reason is required";
    const blockedReason = getBlockedDayReason(form.leaveDate, holidays);
    if (blockedReason) errors.leaveDate = `${blockedReason} — leave can't be applied on this day`;
    return errors;
  };

  const { form, errors, isSubmitting, setIsSubmitting, handleChange, setField, reset, validate: runValidate } =
    useForm(
      { userId: "", leaveDate: getTodayDate(), reason: "", leaveType: LEAVE_TYPES.UNPAID },
      validate
    );

  useEffect(() => {
    if (isOpen) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // A holiday (or Sunday) is already a non-working day, so applying paid/
  // unpaid/swap leave on it doesn't make sense — block it the same way
  // attendance is blocked, instead of letting the request reach the server.
  const blockedReason = useMemo(() => getBlockedDayReason(form.leaveDate, holidays), [form.leaveDate, holidays]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!runValidate()) return;
    try {
      setIsSubmitting(true);
      const success = await onSubmit(form);
      if (success) onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Apply Leave" size="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
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
          label="Leave Date"
          name="leaveDate"
          value={form.leaveDate}
          onChange={handleChange}
          error={errors.leaveDate}
          required
        />

        {blockedReason && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <CalendarOff size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              This date is <strong>{blockedReason}</strong>. Leave cannot be applied on a holiday or Sunday.
            </span>
          </div>
        )}

        <Dropdown
          label="Leave Type"
          value={form.leaveType}
          onChange={(val) => setField("leaveType", val)}
          options={typeOptions}
          disabled={!!blockedReason}
        />
        <TextArea
          label="Reason"
          name="reason"
          value={form.reason}
          onChange={handleChange}
          error={errors.reason}
          required
          disabled={!!blockedReason}
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting} disabled={!!blockedReason}>
            Apply Leave
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default LeaveModal;
