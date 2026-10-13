// src/components/attendance/EditDayModal.jsx
// Admin-only "edit a calendar day" form — opened from the pencil icon on a
// StaffCalendarView / MiniMonth day cell (that screen is behind AdminRoute,
// and the server endpoint PUT /api/hrm/leaves/day-status is admin-only).
// Lets an admin change what a day is marked as:
//   Present / Half Day  <->  Unpaid  <->  Paid / Sick / Casual  <->  Holiday
// A Sunday/holiday can be changed to a leave type (not Present/Half Day),
// and any day can be turned into a Holiday for THIS staff member only.
// Paid, Sick and Casual are FIXED counts from the leave policy — a type
// with no full day left is disabled here, and the server refuses it too.
import React, { useEffect, useMemo } from "react";
import { CalendarOff, Info } from "lucide-react";
import { useForm } from "../../hooks/useForm";
import InputField from "../common/InputField";
import TextArea from "../common/TextArea";
import Dropdown from "../common/Dropdown";
import Button from "../common/Button";
import Modal from "../common/Modal";
import { validateRequired } from "../../utils/validation";
import { getBlockedDayReason } from "../../utils/dateUtils";

// New-status options shown in the dropdown. `kind` decides which extra
// fields render below, and which endpoint the parent ends up calling.
const STATUS_OPTIONS = [
  { value: "present", label: "Present (Full Day)", kind: "attendance" },
  { value: "half", label: "Half Day", kind: "attendance" },
  { value: "paid", label: "Paid Leave", kind: "leave", leaveType: "paid" },
  { value: "sick", label: "Sick Leave", kind: "leave", leaveType: "sick" },
  { value: "casual", label: "Casual Leave", kind: "leave", leaveType: "casual" },
  { value: "unpaid", label: "Unpaid Leave", kind: "leave", leaveType: "unpaid" },
  { value: "holiday", label: "Holiday", kind: "holiday" },
];

const BALANCE_TYPES = ["paid", "sick", "casual"];
const fmt = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);

// Days of Paid/Sick/Casual still available for THIS day. `leaveBalance` is
// the calendar header's balance (whole year). Sick and Casual share one
// pool. If the day itself is already one of these types, it gives its day
// back when changed (e.g. Sick -> Casual).
const daysLeftFor = (type, leaveBalance, day) => {
  if (!leaveBalance) return null;
  let left = leaveBalance[type]?.remaining ?? 0;
  if (type !== "paid" && leaveBalance.sickCasualPool) {
    left = Math.min(left, leaveBalance.sickCasualPool.remaining ?? left);
  }
  const current = day?.status;
  const giveBack =
    type === "paid"
      ? current === "paid"
      : current === "sick" || current === "casual";
  if (giveBack) left += day?.isHalfDay ? 0.5 : 1;
  return fmt(left);
};

// A day that's currently a genuine Half Day (staff worked half) only needs
// the MISSING half (0.5) from Paid/Sick/Casual to become a full day — it's
// a top-up, not a full day of leave. Every other day still needs a full 1.
const neededFor = (type, day) =>
  BALANCE_TYPES.includes(type) && day?.status === "half" ? 0.5 : 1;

const findOption = (value) => STATUS_OPTIONS.find((o) => o.value === value);

// India calendar day ("YYYY-MM-DD") of a date value, so a confirmation date
// saved as 19 Aug 18:30 UTC still reads as 20 Aug.
const istDayKey = (value) => {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
};

// Paid / Sick / Casual don't exist before the confirmation date — only
// Unpaid can be used on those days (the server refuses the others too).
const isBeforeConfirmation = (day, leaveBalance) => {
  const confirm = istDayKey(leaveBalance?.confirmationDate);
  return !!(confirm && day?.date && day.date < confirm);
};

const formatDay = (key) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

// AttendanceModal-style combine: date + "HH:MM" -> full ISO datetime.
const combineDateTime = (date, time) => (date && time ? `${date}T${time}:00` : "");

const toTimeInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toTimeString().slice(0, 5);
};

/**
 * `day` shape (as returned per-date by the staff calendar API):
 *   { date, status, leaveType, isHalfDay, loginTime, logoutTime, recordId, leaveId }
 * `canMarkAttendance` — false when this staff member has no linked login
 * account, so Present/Half Day aren't valid targets (nothing to attach the
 * Attendance record to) — only leave types remain selectable.
 */
const EditDayModal = ({
  isOpen,
  onClose,
  onSubmit,
  day,
  holidays = [],
  canMarkAttendance = true,
  leaveBalance = null,
}) => {
  const leftFor = (type) => daysLeftFor(type, leaveBalance, day);
  const preConfirmation = isBeforeConfirmation(day, leaveBalance);
  const confirmationKey = istDayKey(leaveBalance?.confirmationDate);

  const validate = (form) => {
    const errors = {};
    if (!validateRequired(form.status)) errors.status = "Please choose a status";
    const opt = findOption(form.status);
    if (opt?.kind === "leave" && !validateRequired(form.reason)) {
      errors.reason = "Reason is required";
    }
    if (BALANCE_TYPES.includes(form.status) && preConfirmation) {
      errors.status = `Not available before the confirmation date (${formatDay(confirmationKey)}). Choose Unpaid Leave.`;
    } else if (BALANCE_TYPES.includes(form.status)) {
      const left = leftFor(form.status);
      const needed = neededFor(form.status, day);
      if (left !== null && left < needed) {
        errors.status = `No ${opt.label} left — this count is fixed. Choose Unpaid Leave instead.`;
      }
    }
    return errors;
  };

  const { form, errors, isSubmitting, setIsSubmitting, handleChange, setField, setFields, reset, validate: runValidate } =
    useForm(
      { status: "", reason: "", loginTime: "", logoutTime: "" },
      validate
    );

  // Pre-fill with this day's current values every time the modal is opened
  // for a (possibly different) day.
  useEffect(() => {
    if (!isOpen || !day) return;
    setFields({
      status: day.status || "",
      reason: "",
      loginTime: toTimeInput(day.loginTime),
      logoutTime: toTimeInput(day.logoutTime),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, day]);

  useEffect(() => {
    if (!isOpen) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Sunday or a holiday from the Holiday calendar (applies to everyone).
  const naturalHoliday = useMemo(
    () => (day ? getBlockedDayReason(day.date, holidays) : null),
    [day, holidays]
  );

  const statusOptions = useMemo(
    () =>
      STATUS_OPTIONS.filter(
        (o) => o.kind !== "attendance" || (canMarkAttendance && !naturalHoliday)
      ).map(
        (o) => {
          if (!BALANCE_TYPES.includes(o.value)) return { value: o.value, label: o.label };
          if (preConfirmation) {
            return {
              value: o.value,
              label: `${o.label} (not before confirmation)`,
              disabled: day?.status !== o.value,
            };
          }
          const left = daysLeftFor(o.value, leaveBalance, day);
          if (left === null) return { value: o.value, label: o.label };
          const isCurrent = day?.status === o.value;
          const needed = neededFor(o.value, day);
          const label =
            day?.status === "half"
              ? `${o.label} (top up Half Day, ${left} left)`
              : `${o.label} (${left} left)`;
          return {
            value: o.value,
            label,
            // Fixed count: can't pick a type with less than what's needed
            // (a full day normally, just the missing half on a Half Day).
            disabled: !isCurrent && left < needed,
          };
        }
      ),
    [canMarkAttendance, leaveBalance, day, naturalHoliday, preConfirmation]
  );

  // Swap Leave days are tied to banked extra hours — they have to be
  // deleted (which restores the hours) rather than changed here.
  const isSwapDay = day?.status === "swap";

  const selectedOption = findOption(form.status);
  const locked = isSwapDay;
  const unchanged =
    day &&
    form.status === day.status &&
    !(form.status === "present" &&
      (form.loginTime !== toTimeInput(day.loginTime) ||
        form.logoutTime !== toTimeInput(day.logoutTime)));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!runValidate()) return;
    try {
      setIsSubmitting(true);
      const opt = findOption(form.status);
      const success = await onSubmit({
        day,
        newStatus: form.status,
        kind: opt?.kind,
        leaveType: opt?.leaveType,
        isHalfDay: form.status === "half",
        loginTime: combineDateTime(day.date, form.loginTime),
        logoutTime: combineDateTime(day.date, form.logoutTime),
        reason: form.reason,
      });
      if (success) onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Day Status" size="max-w-lg">
      {day && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-600">
            Editing <span className="font-semibold text-gray-800">{day.date}</span>
            {day.status && (
              <>
                {" "}— currently marked{" "}
                <span className="font-semibold text-gray-800">
                  {findOption(day.status)?.label || day.status}
                </span>
              </>
            )}
          </div>

          {preConfirmation && !isSwapDay && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <Info size={16} className="mt-0.5 flex-shrink-0" />
              <span>
                This day is before the confirmation date (
                <strong>{formatDay(confirmationKey)}</strong>). Paid, Sick and Casual
                leave start from that date — a leave day here can only be{" "}
                <strong>Unpaid</strong>.
              </span>
            </div>
          )}

          {naturalHoliday && !isSwapDay && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <CalendarOff size={16} className="mt-0.5 flex-shrink-0" />
              <span>
                This date is <strong>{naturalHoliday}</strong>. You can change it to Paid,
                Sick, Casual or Unpaid Leave for this staff member only — not to Present /
                Half Day.
              </span>
            </div>
          )}

          {form.status === "holiday" && day.status !== "holiday" && (
            <div className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
              <Info size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                This day becomes a Holiday for <strong>this staff member only</strong>. It
                doesn't count as leave or reduce any leave balance.
              </span>
            </div>
          )}

          {isSwapDay && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <Info size={16} className="mt-0.5 flex-shrink-0" />
              <span>
                This is a <strong>Swap Leave</strong> day. Delete it first (this restores the
                extra hours), then mark the day again.
              </span>
            </div>
          )}

          {day.status === "half" && BALANCE_TYPES.includes(form.status) && !locked && (
            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <Info size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                This day already has a worked Half Day recorded. Saving will keep that half
                and top up the other half with <strong>{findOption(form.status)?.label}</strong>{" "}
                — only <strong>0.5 day</strong> will be deducted, not a full day.
              </span>
            </div>
          )}

          {leaveBalance && !locked && !preConfirmation && (
            <div className="rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-600">
              Leave left this year (fixed counts):{" "}
              <span className="font-semibold text-blue-700">Paid {leftFor("paid")}</span>
              {" · "}
              <span className="font-semibold text-teal-700">Sick {leftFor("sick")}</span>
              {" · "}
              <span className="font-semibold text-pink-700">Casual {leftFor("casual")}</span>
              <div className="mt-0.5 text-gray-400">
                A type with less than 1 day left can't be chosen — use Unpaid Leave.
              </div>
            </div>
          )}

          <Dropdown
            label="New Status"
            required
            value={form.status}
            onChange={(val) => setField("status", val)}
            options={statusOptions}
            error={errors.status}
            placeholder="Select a status"
            disabled={locked}
          />

          {!canMarkAttendance && (
            <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
              <Info size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                This staff member has no linked login account, so Present/Half Day
                aren't available — only leave types can be set.
              </span>
            </div>
          )}

          {form.status === "present" && !locked && (
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
                Leave a time blank to default it to the standard shift (10:00 AM–6:30 PM).
              </p>
            </>
          )}

          {selectedOption?.kind === "leave" && !locked && (
            <TextArea
              label="Reason"
              name="reason"
              value={form.reason}
              onChange={handleChange}
              error={errors.reason}
              placeholder="Why is this day being changed?"
              required
            />
          )}

          <p className="text-xs text-gray-400">
            Saving replaces whatever this day is currently marked as with the new status
            above.
          </p>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isSubmitting}
              disabled={locked || unchanged || !form.status}
            >
              Save Changes
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default EditDayModal;
