// src/components/attendance/LeaveModal.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarOff, Check } from "lucide-react";
import { useForm } from "../../hooks/useForm";
import DatePicker from "../common/DatePicker";
import TextArea from "../common/TextArea";
import Dropdown from "../common/Dropdown";
import Button from "../common/Button";
import Modal from "../common/Modal";
import { LEAVE_TYPES } from "../../utils/constants";
import { validateRequired } from "../../utils/validation";
import { getTodayDate, getBlockedDayReason } from "../../utils/dateUtils";
import { leavePolicyService } from "../../services/leavePolicyService";

// Balance-tracked types first, in the priority this modal auto-suggests for
// (every leave applied here is for a past-or-today date — the backend
// rejects future dates on this endpoint — so Sick/Casual are always used up
// before Paid). Unpaid and Swap are never balance-checked, so they're
// always available to pick directly — Unpaid is not gated behind the
// other three.
const typeOptions = [
  { value: LEAVE_TYPES.SICK, label: "Sick Leave", trackedKey: "sick" },
  { value: LEAVE_TYPES.CASUAL, label: "Casual Leave", trackedKey: "casual" },
  { value: LEAVE_TYPES.PAID, label: "Paid Leave", trackedKey: "paid" },
  { value: LEAVE_TYPES.UNPAID, label: "Unpaid Leave", trackedKey: null },
  { value: LEAVE_TYPES.SWAP, label: "Swap Leave", trackedKey: null },
];

const PRIORITY_ORDER = ["sick", "casual", "paid", "unpaid"];

const durationOptions = [
  { value: "single", label: "Single Day" },
  { value: "range", label: "Date Range" },
];

// Same checkbox-pill picker used on the staff self-service leave form —
// one type can be checked at a time, each shows its own remaining balance,
// and depleted balance-tracked types are greyed out.
const LeaveTypeCheckboxGroup = ({ value, onChange, remainingByType, disabled }) => {
  return (
  <div className="flex flex-wrap gap-2">
    {typeOptions.map((opt) => {
      const remaining = opt.trackedKey ? remainingByType?.[opt.trackedKey] : null;
      // Only grey a tracked type out once its own balance is fully used up
      // (0 or less) — a staff member with exactly 0.5 remaining still has a
      // valid half day to take via the Half Day toggle below, so requiring
      // a full 1.0 remaining here would block them from using their last
      // half day. Unpaid and Swap are never balance-tracked, so they're
      // always selectable.
      const isDepleted = opt.trackedKey && remaining != null && remaining <= 0;
      const isChecked = value === opt.value;
      const isDisabled = disabled || isDepleted;
      return (
        <label
          key={opt.value}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
            isChecked
              ? "border-blue-500 bg-blue-50 text-blue-700"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          } ${isDisabled ? "opacity-50 cursor-not-allowed hover:bg-white" : "cursor-pointer"}`}
        >
          <span
            className={`flex items-center justify-center w-4 h-4 rounded border ${
              isChecked ? "bg-blue-600 border-blue-600" : "bg-white border-gray-400"
            }`}
          >
            {isChecked && <Check size={12} className="text-white" />}
          </span>
          <input
            type="checkbox"
            className="sr-only"
            checked={isChecked}
            disabled={isDisabled}
            onChange={() => {
              if (isDisabled) return;
              onChange(opt.value);
            }}
          />
          <span>{opt.label}</span>
          {opt.trackedKey && (
            <span className={`text-xs ${isDepleted ? "text-red-500" : "text-gray-400"}`}>
              ({remaining != null ? remaining : "—"} left)
            </span>
          )}
        </label>
      );
    })}
  </div>
  );
};

const LeaveModal = ({
  isOpen,
  onClose,
  onSubmit,
  staffOptions = [],
  holidays = [],
}) => {
  const validate = (form) => {
    const errors = {};
    const isRange = form.duration === "range";
    if (!validateRequired(form.userId))
      errors.userId = "Please select an Staff";
    if (!validateRequired(form.leaveDate))
      errors.leaveDate = "Leave date is required";
    if (!validateRequired(form.reason)) errors.reason = "Reason is required";

    if (isRange) {
      if (!validateRequired(form.endDate))
        errors.endDate = "End date is required";
      else if (form.endDate < form.leaveDate)
        errors.endDate = "End date must be on or after start date";
      // A range covers every day in between (Sundays/holidays included), so
      // it's only the single-day mode that needs the holiday/Sunday block.
    } else {
      const blockedReason = getBlockedDayReason(form.leaveDate, holidays);
      if (blockedReason)
        errors.leaveDate = `${blockedReason} — leave can't be applied on this day`;
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
    reset,
    validate: runValidate,
  } = useForm(
    {
      userId: "",
      duration: "single",
      leaveDate: getTodayDate(),
      endDate: "",
      reason: "",
      leaveType: LEAVE_TYPES.UNPAID,
      isHalfDay: false,
    },
    validate,
  );

  useEffect(() => {
    if (isOpen) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Every staff member's balances, fetched once whenever the modal opens —
  // cheap enough for a staff-sized list and avoids a round trip per staff
  // selection in the dropdown above.
  const [allBalances, setAllBalances] = useState([]);
  const [typeTouched, setTypeTouched] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setTypeTouched(false);
    leavePolicyService
      .getAllBalances()
      .then((res) => setAllBalances(res.data?.data || []))
      .catch(() => setAllBalances([]));
  }, [isOpen]);

  const remainingByType = useMemo(() => {
    const row = allBalances.find((b) => String(b.staffId) === String(form.userId));
    if (!row) return {};
    return {
      paid: row.paid?.remaining,
      sick: row.sick?.remaining,
      casual: row.casual?.remaining,
    };
  }, [allBalances, form.userId]);

  // Sick/Casual reset every year and never carry forward, so they should
  // always be used up before Paid (which does carry forward) — this picks
  // the first type in that order that still has a balance.
  const suggestLeaveType = useCallback(
    () =>
      PRIORITY_ORDER.find(
        (t) => t === "unpaid" || (remainingByType[t] ?? 0) >= 1,
      ) || "unpaid",
    [remainingByType],
  );

  // Re-suggest whenever the selected staff member changes (their balances
  // differ), as long as the admin hasn't manually picked a type themselves.
  useEffect(() => {
    if (typeTouched || !form.userId) return;
    setField("leaveType", suggestLeaveType());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.userId, remainingByType, typeTouched]);

  const handleTypeChange = (leaveType) => {
    setTypeTouched(true);
    setField("leaveType", leaveType);
  };

  const isRange = form.duration === "range";

  // A holiday (or Sunday) is already a non-working day, so applying paid/
  // unpaid/swap leave on it doesn't make sense — block it the same way
  // attendance is blocked, instead of letting the request reach the server.
  // Only applies in single-day mode; a date range intentionally covers every
  // day including Sundays/holidays.
  const blockedReason = useMemo(
    () => (isRange ? null : getBlockedDayReason(form.leaveDate, holidays)),
    [isRange, form.leaveDate, holidays],
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!runValidate()) return;
    try {
      setIsSubmitting(true);
      const payload = {
        userId: form.userId,
        leaveDate: form.leaveDate,
        reason: form.reason,
        leaveType: form.leaveType,
        ...(isRange
          ? { endDate: form.endDate }
          : { isHalfDay: !!form.isHalfDay }),
      };
      const success = await onSubmit(payload);
      if (success) onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Apply Leave"
      size="max-w-lg"
    >
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
        <Dropdown
          label="Duration"
          value={form.duration}
          onChange={(val) => setField("duration", val)}
          options={durationOptions}
        />
        <div className={isRange ? "grid grid-cols-2 gap-3" : ""}>
          <DatePicker
            label={isRange ? "From" : "Leave Date"}
            name="leaveDate"
            value={form.leaveDate}
            onChange={handleChange}
            error={errors.leaveDate}
            required
          />
          {isRange && (
            <DatePicker
              label="To"
              name="endDate"
              value={form.endDate}
              onChange={handleChange}
              error={errors.endDate}
              required
            />
          )}
        </div>

        {blockedReason && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <CalendarOff size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              This date is <strong>{blockedReason}</strong>. Leave cannot be
              applied on a holiday or Sunday.
            </span>
          </div>
        )}

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">
            Leave Type
          </label>
          <LeaveTypeCheckboxGroup
            value={form.leaveType}
            onChange={handleTypeChange}
            remainingByType={remainingByType}
            disabled={!!blockedReason}
          />
          <p className="text-xs text-gray-400 mt-1.5">
            Sick and Casual leave are suggested first (they reset every
            year); Paid leave carries forward, so it's suggested last.
            Pick a different box to override — Unpaid leave can be
            selected directly at any time.
          </p>
        </div>
        {!isRange && (
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={!!form.isHalfDay}
              onChange={(e) => setField("isHalfDay", e.target.checked)}
              disabled={!!blockedReason}
              className="w-4 h-4 rounded border-gray-400"
            />
            Half Day (counts as 0.5 day instead of a full day)
          </label>
        )}
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
          <Button
            type="submit"
            variant="primary"
            loading={isSubmitting}
            disabled={!!blockedReason}
          >
            Apply Leave
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default LeaveModal;
