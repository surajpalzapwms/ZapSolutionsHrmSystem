// src/components/attendance/AttendanceModal.jsx
import React, { useEffect, useMemo } from "react";
import { CalendarOff } from "lucide-react";
import { useForm } from "../../hooks/useForm";
import InputField from "../common/InputField";
import DatePicker from "../common/DatePicker";
import Dropdown from "../common/Dropdown";
import Button from "../common/Button";
import Modal from "../common/Modal";
import { ATTENDANCE_TYPES } from "../../utils/constants";
import { validateRequired } from "../../utils/validation";
import { getTodayDate, getBlockedDayReason } from "../../utils/dateUtils";

const typeOptions = Object.values(ATTENDANCE_TYPES)
  .filter((t) => t !== ATTENDANCE_TYPES.SHORT)
  .map((t) => ({
    value: t,
    label: t.charAt(0).toUpperCase() + t.slice(1) + " Day",
  }));

// AttendanceModal collects a date + separate HH:MM login/logout times, but the
// backend expects full ISO datetimes for both — combine them before submit.
const combineDateTime = (date, time) => (date && time ? `${date}T${time}:00` : "");

const AttendanceModal = ({ isOpen, onClose, onSubmit, staffOptions = [], holidays = [] }) => {
  const validate = (form) => {
    const errors = {};
    if (!validateRequired(form.userId)) errors.userId = "Please select an MR";
    // Login/logout time are optional — left blank, they default to the
    // office's standard shift (10:00 AM–6:30 PM) on save.
    const blockedReason = getBlockedDayReason(form.date, holidays);
    if (blockedReason) errors.date = `${blockedReason} — attendance can't be marked on this day`;
    return errors;
  };

  const { form, errors, isSubmitting, setIsSubmitting, handleChange, setField, reset, validate: runValidate } =
    useForm(
      { userId: "", date: getTodayDate(), loginTime: "", logoutTime: "", attendanceType: ATTENDANCE_TYPES.FULL },
      validate
    );

  useEffect(() => {
    if (isOpen) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Re-derived on every render from the currently selected date so the
  // banner updates the moment the user picks a different day.
  const blockedReason = useMemo(() => getBlockedDayReason(form.date, holidays), [form.date, holidays]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!runValidate()) return;
    try {
      setIsSubmitting(true);
      const payload = {
        userId: form.userId,
        // Always send the raw date too — if login/logout are left blank,
        // the backend uses it to default them to the standard shift
        // (10:00 AM–6:30 PM) instead of rejecting the record.
        date: form.date,
        loginTime: combineDateTime(form.date, form.loginTime),
        logoutTime: combineDateTime(form.date, form.logoutTime),
        workingHoursPerDay: form.attendanceType === ATTENDANCE_TYPES.HALF ? 4 : 8,
      };
      const success = await onSubmit(payload);
      if (success) onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Record Attendance" size="max-w-lg">
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
        <DatePicker label="Date" name="date" value={form.date} onChange={handleChange} required error={errors.date} />

        {blockedReason && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <CalendarOff size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              This date is <strong>{blockedReason}</strong>. Attendance cannot be marked on a holiday or Sunday.
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Login Time"
            name="loginTime"
            type="time"
            value={form.loginTime}
            onChange={handleChange}
            error={errors.loginTime}
            disabled={!!blockedReason}
          />
          <InputField
            label="Logout Time"
            name="logoutTime"
            type="time"
            value={form.logoutTime}
            onChange={handleChange}
            disabled={!!blockedReason}
          />
        </div>
        <p className="text-xs text-gray-500 -mt-2">
          Leave a time blank to default it to the standard shift (10:00 AM–6:30 PM).
        </p>
        <Dropdown
          label="Attendance Type"
          value={form.attendanceType}
          onChange={(val) => setField("attendanceType", val)}
          options={typeOptions}
          disabled={!!blockedReason}
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting} disabled={!!blockedReason}>
            Save Attendance
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default AttendanceModal;