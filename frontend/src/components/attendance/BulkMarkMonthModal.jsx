
import React, { useEffect, useMemo } from "react";
import { CalendarRange, Info } from "lucide-react";
import { useForm } from "../../hooks/useForm";
import InputField from "../common/InputField";
import DatePicker from "../common/DatePicker";
import TextArea from "../common/TextArea";
import Dropdown from "../common/Dropdown";
import Button from "../common/Button";
import Modal from "../common/Modal";
import { validateRequired } from "../../utils/validation";
import { getMonthName, getTodayDate, formatDateISO } from "../../utils/dateUtils";

// Same status list EditDayModal uses — `kind` decides which extra fields
// render below, and which endpoint the parent ends up calling.
const STATUS_OPTIONS = [
  { value: "present", label: "Present (Full Day)", kind: "attendance" },
  { value: "half", label: "Half Day", kind: "attendance" },
  { value: "paid", label: "Paid Leave", kind: "leave", leaveType: "paid" },
  { value: "sick", label: "Sick Leave", kind: "leave", leaveType: "sick" },
  { value: "casual", label: "Casual Leave", kind: "leave", leaveType: "casual" },
  { value: "unpaid", label: "Unpaid Leave", kind: "leave", leaveType: "unpaid" },
  { value: "swap", label: "Swap Leave", kind: "leave", leaveType: "swapleave" },
];
const findOption = (value) => STATUS_OPTIONS.find((o) => o.value === value);

// Standard office shift — same constant the backend falls back to
// (DEFAULT_SHIFT_START / DEFAULT_SHIFT_END) when a time is left blank.
const DEFAULT_START_TIME = "10:00";
const DEFAULT_END_TIME = "18:30";

const emptyForm = {
  startDate: "",
  endDate: "",
  status: "present",
  reason: "",
  loginTime: DEFAULT_START_TIME,
  logoutTime: DEFAULT_END_TIME,
};

/**
 * `month` — 0-indexed month this modal was opened for; `year` — its year.
 * `minDateOverall` / `maxDateOverall` — optional JS Date bounds (staff join
 * date / relieving date) narrowing the pickable range beyond just the
 * calendar month itself.
 * `canMarkAttendance` — false when this staff member has no linked login
 * account, so Present/Half Day aren't valid targets — only leave types.
 */
const BulkMarkMonthModal = ({
  isOpen,
  onClose,
  onSubmit,
  month,
  year,
  canMarkAttendance = true,
  minDateOverall = null,
  maxDateOverall = null,
}) => {
  const monthLabel = month != null && year != null ? `${getMonthName(month)} ${year}` : "";

  const validate = (form) => {
    const errors = {};
    if (!validateRequired(form.startDate)) errors.startDate = "Start date is required";
    if (!validateRequired(form.endDate)) errors.endDate = "End date is required";
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      errors.endDate = "End date must be on or after start date";
    }
    if (!validateRequired(form.status)) errors.status = "Please choose a status";
    const opt = findOption(form.status);
    if (opt?.kind === "leave" && !validateRequired(form.reason)) {
      errors.reason = "Reason is required";
    }
    return errors;
  };

  const {
    form,
    errors,
    isSubmitting,
    setIsSubmitting,
    handleChange,
    setField,
    setFields,
    reset,
    validate: runValidate,
  } = useForm(emptyForm, validate);

  // The pickable window: the calendar month itself, clamped so it never
  // falls outside the staff member's actual employment window (if known).
  // A leave type (paid/sick/casual/unpaid/swap) is allowed to reach into
  // future months — a staff member with balance left should be able to
  // book November or April leave ahead of time, same as any real leave
  // system — the backend enforces the actual balance check and asks for
  // an explicit confirmation before committing a future-dated day (see
  // handleBulkSubmit/handleEditSubmit in StaffCalendarView). Attendance
  // (Present/Half Day) still can't be recorded ahead of when it happens,
  // so that stays capped at today.
  const bounds = useMemo(() => {
    if (month == null || year == null) return null;
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const today = new Date(`${getTodayDate()}T00:00:00`);
    const opt = findOption(form.status);
    const isAttendance = opt ? opt.kind === "attendance" : true;
    let lo = monthStart;
    let hi = isAttendance && monthEnd > today ? today : monthEnd;
    if (minDateOverall && minDateOverall > lo) lo = minDateOverall;
    if (maxDateOverall && maxDateOverall < hi) hi = maxDateOverall;
    return { lo, hi };
  }, [month, year, minDateOverall, maxDateOverall, form.status]);

  // Pre-fill start/end to the full pickable window, and reset the rest to
  // defaults, every time the modal is opened for a (possibly different)
  // month.
  useEffect(() => {
    if (!isOpen || !bounds) return;
    setFields({
      startDate: formatDateISO(bounds.lo),
      endDate: formatDateISO(bounds.hi),
      status: canMarkAttendance ? "present" : "paid",
      reason: "",
      loginTime: DEFAULT_START_TIME,
      logoutTime: DEFAULT_END_TIME,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, month, year]);

  useEffect(() => {
    if (!isOpen) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const statusOptions = useMemo(
    () =>
      STATUS_OPTIONS.filter((o) => o.kind !== "attendance" || canMarkAttendance).map(
        (o) => ({ value: o.value, label: o.label }),
      ),
    [canMarkAttendance],
  );

  const selectedOption = findOption(form.status);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!runValidate()) return;
    try {
      setIsSubmitting(true);
      const opt = findOption(form.status);
      const success = await onSubmit({
        kind: opt?.kind,
        status: form.status,
        leaveType: opt?.leaveType,
        startDate: form.startDate,
        endDate: form.endDate,
        loginTime: form.loginTime || DEFAULT_START_TIME,
        logoutTime: form.logoutTime || DEFAULT_END_TIME,
        reason: form.reason,
      });
      if (success) onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Bulk Mark${monthLabel ? ` — ${monthLabel}` : ""}`} size="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          <CalendarRange size={16} className="mt-0.5 flex-shrink-0" />
          <span>
            This fills in every day that has <strong>no attendance marked yet</strong> between
            the dates below. Sundays, holidays, and days that already have attendance or leave
            recorded are left untouched.
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <DatePicker
            label="Start Date"
            name="startDate"
            value={form.startDate}
            onChange={handleChange}
            error={errors.startDate}
            minDate={bounds?.lo}
            maxDate={bounds?.hi}
            required
          />
          <DatePicker
            label="End Date"
            name="endDate"
            value={form.endDate}
            onChange={handleChange}
            error={errors.endDate}
            minDate={bounds?.lo}
            maxDate={bounds?.hi}
            required
          />
        </div>

        <Dropdown
          label="Mark As"
          required
          value={form.status}
          onChange={(val) => setField("status", val)}
          options={statusOptions}
          error={errors.status}
          placeholder="Select a status"
        />

        {!canMarkAttendance && (
          <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
            <Info size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              This staff member has no linked login account, so Present/Half Day aren't
              available — only leave types can be set.
            </span>
          </div>
        )}

        {selectedOption?.kind === "attendance" && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Login Time"
                name="loginTime"
                type="time"
                value={form.loginTime}
                onChange={handleChange}
              />
              <InputField
                label="Logout Time"
                name="logoutTime"
                type="time"
                value={form.logoutTime}
                onChange={handleChange}
              />
            </div>
            <p className="text-xs text-gray-500 -mt-2">
              Used for every unmarked day in the range. Defaults to the standard shift
              (10:00 AM–6:30 PM).
            </p>
          </>
        )}

        {selectedOption?.kind === "leave" && (
          <TextArea
            label="Reason"
            name="reason"
            value={form.reason}
            onChange={handleChange}
            error={errors.reason}
            placeholder="Why is this range being marked as leave?"
            required
          />
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            {selectedOption?.kind === "leave" ? "Apply Leave" : "Mark Attendance"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default BulkMarkMonthModal;