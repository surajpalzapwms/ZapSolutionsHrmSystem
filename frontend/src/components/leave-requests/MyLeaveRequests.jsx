// src/components/leave-requests/MyLeaveRequests.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  CalendarX2,
  Check,
  Minus,
  Plus,
  History,
  Info,
  Send,
  Thermometer,
  Coffee,
  Wallet,
} from "lucide-react";
import Button from "../common/Button";
import DatePicker from "../common/DatePicker";
import TextArea from "../common/TextArea";
import Spinner from "../common/Spinner";
import { attendanceService } from "../../services/attendanceService";
import { leavePolicyService } from "../../services/leavePolicyService";
import { showToast } from "../../utils/toast";
import { getTodayDate } from "../../utils/dateUtils";
import LeaveStatusBadge from "./LeaveStatusBadge";
import LeaveHistoryModal from "./Leavehistorymodal";
import {
  groupRequests,
  sortGroupsNewestFirst,
  groupStatus,
  groupTypeLabel,
  groupDateLabel,
  groupIsHalfDay,
} from "./leaveRequestHelpers";

// How many of the latest requests the page itself lists — everything else
// is behind the "View Leave History" button (opens in a modal).
const RECENT_LIMIT = 10;

// Balance-tracked types (checked against the accrued/carried-forward balance
// from LeavePolicy — see backend services/leaveBalance.js) come first, in
// the priority order past-dated leave should prefer: Sick and Casual before
// Paid. Unpaid and Swap are never balance-checked, so they're always
// available to pick directly — Unpaid is not gated behind the other three.
const LEAVE_TYPE_OPTIONS = [
  { value: "sick", label: "Sick Leave", trackedKey: "sick" },
  { value: "casual", label: "Casual Leave", trackedKey: "casual" },
  { value: "paid", label: "Paid Leave", trackedKey: "paid" },
  { value: "unpaid", label: "Unpaid Leave", trackedKey: null },
  { value: "swapleave", label: "Swap Leave", trackedKey: null },
];

// Priority used to auto-suggest a type for a day that's already in the past
// (or today): use up Sick and Casual leave first, only falling back to Paid
// once those are exhausted. This is only a starting suggestion — Unpaid can
// always be picked directly regardless of remaining balances.
const PAST_DATE_PRIORITY = ["sick", "casual", "paid", "unpaid"];

// Colour per leave type, used on the type tiles and the request list chips.
// (Full class strings so Tailwind picks them up.)
const TYPE_CHIP = {
  sick: "bg-rose-50 text-rose-700",
  casual: "bg-amber-50 text-amber-700",
  paid: "bg-emerald-50 text-emerald-700",
  unpaid: "bg-slate-100 text-slate-600",
  swapleave: "bg-violet-50 text-violet-700",
};

const BALANCE_TILES = [
  { key: "sick", label: "Sick", icon: Thermometer, iconClass: "bg-rose-50 text-rose-600" },
  { key: "casual", label: "Casual", icon: Coffee, iconClass: "bg-amber-50 text-amber-600" },
  { key: "paid", label: "Paid", icon: Wallet, iconClass: "bg-emerald-50 text-emerald-600" },
];

const TRACKED_TYPES = ["sick", "casual", "paid"];
// Order the days of a multi-type range are filled in: the earliest working
// days use the first type, and so on. Sick/Casual first (they reset every
// year), then Paid, then Swap, with Unpaid always last.
const TYPE_ORDER = ["sick", "casual", "paid", "swapleave", "unpaid"];
const sortByTypeOrder = (types) =>
  TYPE_ORDER.filter((t) => types.includes(t));

const emptyForm = {
  duration: "single",
  leaveDate: "",
  endDate: "",
  reason: "",
  // Selected leave types. Single Day → exactly one; Date Range → one or more.
  leaveTypes: ["unpaid"],
  isHalfDay: false,
};

const DURATION_OPTIONS = [
  { value: "single", label: "Single Day" },
  { value: "range", label: "Date Range" },
];

// Working days between two YYYY-MM-DD dates, inclusive, skipping Sundays
// (the backend also skips public holidays and already-requested days).
const countWorkingDays = (from, to) => {
  if (!from || !to || to < from) return 0;
  let n = 0;
  let cur = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  for (let g = 0; cur <= last && g < 366; g++) {
    if (cur.getUTCDay() !== 0) n++;
    cur = new Date(cur.getTime() + 86400000);
  }
  return n;
};

const usableBalance = (type, remainingByType) =>
  TRACKED_TYPES.includes(type)
    ? Math.max(0, Math.floor(remainingByType?.[type] ?? 0))
    : Infinity;

// Split `total` working days across the selected types.
//  - Tracked types (Sick/Casual/Paid) default to as many days as their
//    balance allows, capped by what's left.
//  - Unpaid (if selected) soaks up whatever is left over; Swap defaults to 0
//    when Unpaid is also selected, otherwise it soaks up the rest.
//  - `overrides` are the counts the person typed in themselves.
// Any days still uncovered are returned as `fallbackUnpaid` (the server
// books them as Unpaid).
const buildAllocation = (types, total, remainingByType, overrides) => {
  const ordered = sortByTypeOrder(types);
  const absorber = ordered.includes("unpaid")
    ? "unpaid"
    : ordered.includes("swapleave")
      ? "swapleave"
      : null;
  let left = total;
  const days = {};
  for (const t of ordered) {
    if (t === absorber) continue;
    const cap = Math.min(left, usableBalance(t, remainingByType));
    const auto = TRACKED_TYPES.includes(t) ? cap : 0;
    const want = overrides[t] ?? auto;
    days[t] = Math.max(0, Math.min(want, cap));
    left -= days[t];
  }
  if (absorber) {
    days[absorber] = left;
    left = 0;
  }
  return { ordered, days, absorber, fallbackUnpaid: left };
};

// Suggest which types to tick for a range: draw down Sick → Casual → Paid
// until the days are covered, then Unpaid for anything left.
const suggestRangeTypes = (total, remainingByType) => {
  const out = [];
  let left = total;
  for (const t of TRACKED_TYPES) {
    if (left <= 0) break;
    const bal = usableBalance(t, remainingByType);
    if (bal > 0) {
      out.push(t);
      left -= bal;
    }
  }
  if (left > 0 || out.length === 0) out.push("unpaid");
  return out;
};

// Balance-aware leave type picker rendered as checkbox pills.
// Single Day: picking one replaces the previous (a day is one type).
// Date Range (`multiple`): any number can be ticked at the same time and the
// days are split between them. Tracked types grey out once their balance is
// used up; Unpaid/Swap are always selectable.
const LeaveTypeCheckboxGroup = ({ value, onChange, remainingByType, multiple }) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {LEAVE_TYPE_OPTIONS.map((opt) => {
        const remaining = opt.trackedKey
          ? remainingByType?.[opt.trackedKey]
          : null;
        // Only grey a tracked type out once its own balance is fully used up
        // (0 or less) — someone with exactly 0.5 remaining can still take
        // that as a half day.
        const isDisabled =
          opt.trackedKey && remaining != null && remaining <= 0;
        const isChecked = value.includes(opt.value);
        const toggle = () => {
          if (isDisabled) return;
          if (!multiple) return onChange([opt.value]);
          if (isChecked) {
            // Keep at least one type selected.
            if (value.length > 1) onChange(value.filter((v) => v !== opt.value));
          } else {
            onChange(sortByTypeOrder([...value, opt.value]));
          }
        };
        return (
          <label
            key={opt.value}
            className={`relative flex flex-col gap-0.5 px-3 py-2 rounded-xl border text-sm transition-all select-none ${
              isChecked
                ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100"
                : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
            } ${isDisabled ? "opacity-50 cursor-not-allowed hover:bg-white hover:border-gray-200" : "cursor-pointer"}`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={isChecked}
              disabled={isDisabled}
              onChange={toggle}
            />
            <span
              className={`absolute top-2 right-2 flex items-center justify-center w-4 h-4 border ${
                multiple ? "rounded" : "rounded-full"
              } ${
                isChecked
                  ? "bg-blue-600 border-blue-600"
                  : "bg-white border-gray-300"
              }`}
            >
              {isChecked && <Check size={10} className="text-white" strokeWidth={3} />}
            </span>
            <span
              className={`font-medium pr-5 ${isChecked ? "text-blue-700" : "text-gray-700"}`}
            >
              {opt.label.replace(" Leave", "")}
            </span>
            <span
              className={`text-xs ${
                isDisabled ? "text-red-500" : "text-gray-400"
              }`}
            >
              {opt.trackedKey
                ? `${remaining != null ? remaining : "—"} left`
                : "Anytime"}
            </span>
          </label>
        );
      })}
    </div>
  );
};

// Per-type day split for a Date Range with several types ticked.
const AllocationEditor = ({ allocation, total, remainingByType, onChangeDays }) => {
  const { ordered, days, absorber, fallbackUnpaid } = allocation;
  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-600">
          Split {total} working day{total === 1 ? "" : "s"}
        </p>
        <p className="text-[11px] text-gray-400">Sundays &amp; holidays are skipped</p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {ordered.map((t) => {
          const isAbsorber = t === absorber;
          const cap = usableBalance(t, remainingByType);
          const val = days[t] ?? 0;
          return (
            <li key={t} className="flex items-center gap-3">
              <span
                className={`w-20 px-1.5 py-px rounded text-[11px] font-medium text-center ${
                  TYPE_CHIP[t] || TYPE_CHIP.unpaid
                }`}
              >
                {LEAVE_TYPE_OPTIONS.find((o) => o.value === t)?.label.replace(" Leave", "")}
              </span>
              {isAbsorber ? (
                <span className="text-sm font-semibold text-gray-800 w-[5.5rem] text-center">
                  {val}
                </span>
              ) : (
                <div className="flex items-center rounded-lg border border-gray-200 bg-white">
                  <button
                    type="button"
                    className="p-1.5 text-gray-500 hover:text-gray-800 disabled:opacity-30"
                    disabled={val <= 0}
                    onClick={() => onChangeDays(t, val - 1)}
                    aria-label={`Fewer ${t} days`}
                  >
                    <Minus size={13} />
                  </button>
                  <span className="w-7 text-center text-sm font-semibold text-gray-800">
                    {val}
                  </span>
                  <button
                    type="button"
                    className="p-1.5 text-gray-500 hover:text-gray-800 disabled:opacity-30"
                    disabled={val >= cap || val >= total}
                    onClick={() => onChangeDays(t, val + 1)}
                    aria-label={`More ${t} days`}
                  >
                    <Plus size={13} />
                  </button>
                </div>
              )}
              <span className="text-[11px] text-gray-400">
                {isAbsorber
                  ? "remaining days"
                  : TRACKED_TYPES.includes(t)
                    ? `max ${cap}`
                    : ""}
              </span>
            </li>
          );
        })}
      </ul>
      {fallbackUnpaid > 0 && (
        <p className="text-[11px] text-amber-600 mt-2">
          {fallbackUnpaid} day{fallbackUnpaid === 1 ? "" : "s"} not covered by the
          selected types will be booked as Unpaid.
        </p>
      )}
    </div>
  );
};

const MyLeaveRequests = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [balance, setBalance] = useState(null);
  // Once the person manually checks a type themselves, stop overriding
  // their choice with the auto-suggestion whenever the date changes.
  const [typeTouched, setTypeTouched] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Day counts the person set by hand in the range split, e.g. { casual: 2 }.
  const [allocOverrides, setAllocOverrides] = useState({});

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      const res = await attendanceService.getMyLeaveRequests();
      setRequests(res.data?.leaves || []);
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to load your leave requests",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBalance = useCallback(async () => {
    try {
      const res = await leavePolicyService.getMyBalance();
      setBalance(res.data?.data || null);
    } catch {
      // Non-fatal — the form still works, it just won't show/enforce
      // remaining-balance counts client-side (the server still enforces
      // it when the request is approved).
    }
  }, []);

  useEffect(() => {
    fetchRequests();
    fetchBalance();
  }, [fetchRequests, fetchBalance]);

  // { sick: 3, casual: 2, paid: 10.5 } — remaining days for each
  // balance-tracked type, straight from the balances endpoint.
  const remainingByType = useMemo(() => {
    if (!balance) return {};
    return {
      paid: balance.paid?.remaining,
      sick: balance.sick?.remaining,
      casual: balance.casual?.remaining,
    };
  }, [balance]);

  // Jan-1-to-Dec-31 accrual/carry-forward is computed server-side; here we
  // only need to know, for a given date, whether it's in the past (or
  // today) — in which case Sick/Casual should be preferred over Paid — or
  // in the future, where the person just picks freely from whatever they
  // still have.
  const suggestLeaveType = useCallback(
    (dateStr, needed = 1) => {
      if (!dateStr) return "unpaid";
      // Sick and Casual leave reset every 1 Jan and never carry forward,
      // while unused Paid leave rolls into next year — so it's always
      // better to draw down Sick/Casual first and save Paid for last. This
      // is the forced order for a day that's already past (or today, since
      // it can no longer move), and it's just the pre-checked starting
      // point for a future date — the person can still tick a different
      // box either way.
      return (
        PAST_DATE_PRIORITY.find(
          (t) => t === "unpaid" || (remainingByType[t] ?? 0) >= needed,
        ) || "unpaid"
      );
    },
    [remainingByType],
  );

  // Re-suggest the leave type once balances actually load — the form starts
  // out defaulted to "unpaid" before that fetch resolves, but Unpaid may be
  // locked (Sick/Casual/Paid still has balance), so this swaps it for a
  // real suggestion as soon as we know. Only runs while the person hasn't
  // manually picked a type and hasn't chosen a date yet (once a date is
  // picked, handleChange's own re-suggestion takes over).
  useEffect(() => {
    if (typeTouched || form.leaveDate) return;
    setForm((prev) => ({ ...prev, leaveTypes: [suggestLeaveType(prev.leaveDate)] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      // Re-run the suggestion whenever the leave date changes, as long as
      // the person hasn't manually overridden the type themselves.
      const range = next.duration === "range";
      if (!typeTouched && (name === "leaveDate" || name === "endDate" || name === "duration")) {
        if (range) {
          const total = countWorkingDays(next.leaveDate, next.endDate);
          if (total > 0) next.leaveTypes = suggestRangeTypes(total, remainingByType);
        } else {
          next.leaveTypes = [suggestLeaveType(next.leaveDate, prev.isHalfDay ? 0.5 : 1)];
        }
      }
      // A half day only exists for a single-day request.
      if (name === "duration" && value === "range") {
        next.isHalfDay = false;
        next.endDate = prev.endDate || "";
      }
      // Back to a single day → only one type can apply.
      if (name === "duration" && value === "single" && next.leaveTypes.length > 1) {
        next.leaveTypes = [next.leaveTypes[0]];
      }
      return next;
    });
    if (name === "leaveDate" || name === "endDate" || name === "duration") {
      setAllocOverrides({});
    }
    setErrors((prev) => ({ ...prev, [name]: undefined, leaveTypes: undefined }));
  };

  const handleHalfDayChange = (checked) => {
    setForm((prev) => ({
      ...prev,
      isHalfDay: checked,
      leaveTypes: typeTouched
        ? prev.leaveTypes
        : [suggestLeaveType(prev.leaveDate, checked ? 0.5 : 1)],
    }));
  };

  const handleTypeChange = (leaveTypes) => {
    setTypeTouched(true);
    setAllocOverrides({});
    setForm((prev) => ({ ...prev, leaveTypes }));
    setErrors((prev) => ({ ...prev, leaveTypes: undefined }));
  };

  const isRange = form.duration === "range";

  const rangeWorkingDays = isRange
    ? countWorkingDays(form.leaveDate, form.endDate)
    : 0;
  const allocation = useMemo(
    () =>
      buildAllocation(form.leaveTypes, rangeWorkingDays, remainingByType, allocOverrides),
    [form.leaveTypes, rangeWorkingDays, remainingByType, allocOverrides],
  );
  const showSplit = isRange && rangeWorkingDays > 0 && form.leaveTypes.length > 1;

  // Group multi-day requests, newest first, and only list the latest few on
  // the page — the complete list lives in the history modal.
  const allGroups = useMemo(
    () => sortGroupsNewestFirst(groupRequests(requests)),
    [requests],
  );
  const recentGroups = allGroups.slice(0, RECENT_LIMIT);
  const totalGroups = allGroups.length;

  const validate = () => {
    const next = {};
    if (!form.leaveDate) next.leaveDate = "Please select a date";
    if (isRange) {
      if (!form.endDate) next.endDate = "Please select an end date";
      else if (form.endDate < form.leaveDate)
        next.endDate = "End date must be on or after start date";
    }
    if (isRange && form.leaveDate && form.endDate && rangeWorkingDays === 0)
      next.endDate = "The selected range has no working days";
    if (!form.leaveTypes.length) next.leaveTypes = "Pick a leave type";
    if (!form.reason.trim()) next.reason = "Please provide a reason";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      // The backend reads fromDate/toDate for a range (the old payload
      // sent `endDate`, so every range collapsed into a single day).
      // A range with several types sends an ordered day split, e.g.
      // [{ sick: 1 }, { casual: 3 }, { paid: 5 }] — the backend fills the
      // earliest working days with the first type, and so on.
      const allocations = showSplit
        ? allocation.ordered
            .map((t) => ({ leaveType: t, days: allocation.days[t] || 0 }))
            .filter((a) => a.days > 0)
        : null;
      const payload = {
        reason: form.reason,
        leaveType: form.leaveTypes[0],
        ...(allocations && allocations.length ? { allocations } : {}),
        ...(isRange
          ? { fromDate: form.leaveDate, toDate: form.endDate }
          : { leaveDate: form.leaveDate, isHalfDay: !!form.isHalfDay }),
      };
      await attendanceService.submitLeaveRequest(payload);
      showToast(
        "success",
        isRange
          ? "Leave request submitted for the selected days. Waiting for admin approval."
          : "Leave request submitted. Waiting for admin approval.",
      );
      setForm(emptyForm);
      setTypeTouched(false);
      setAllocOverrides({});
      await fetchRequests();
      await fetchBalance(); // reflect the newly-used day(s) right away
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to submit leave request",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const selectedLabel = sortByTypeOrder(form.leaveTypes)
    .map((t) => {
      const label = LEAVE_TYPE_OPTIONS.find((o) => o.value === t)?.label;
      if (!label) return null;
      return showSplit
        ? `${allocation.days[t] ?? 0} ${label.replace(" Leave", "")}`
        : label;
    })
    .filter(Boolean)
    .join(" + ");
  const isPastDate = form.leaveDate && form.leaveDate <= getTodayDate();
  const maxDate = new Date(new Date().getFullYear() + 1, 11, 31);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:h-full lg:overflow-hidden">
      {/* Page header */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
          <CalendarPlus className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800 leading-tight">
            My Leave Requests
          </h1>
          <p className="text-xs text-gray-500">
            Apply for leave and track your recent requests
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:flex-1 lg:min-h-0">
        {/* ── Request form ───────────────────────────────────────── */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-3 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col lg:min-h-0"
        >
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-800">
              Request Leave
            </h3>
            <span className="hidden sm:inline text-xs text-gray-400">
              Fields marked <span className="text-red-500">*</span> are required
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            {/* Duration + dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">
                    Duration
                  </label>
                  {!isRange && (
                    <label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                      <span>Half day</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!!form.isHalfDay}
                        onClick={() => handleHalfDayChange(!form.isHalfDay)}
                        className={`relative w-8 h-[18px] rounded-full transition-colors ${
                          form.isHalfDay ? "bg-blue-600" : "bg-gray-300"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                            form.isHalfDay ? "translate-x-3.5" : ""
                          }`}
                        />
                      </button>
                    </label>
                  )}
                </div>
                <div className="grid grid-cols-2 p-1 bg-gray-100 rounded-lg">
                  {DURATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        handleChange({
                          target: { name: "duration", value: opt.value },
                        })
                      }
                      className={`py-1.5 text-sm font-medium rounded-md transition-all ${
                        form.duration === opt.value
                          ? "bg-white text-blue-700 shadow-sm"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {isRange ? (
                <div className="grid grid-cols-2 gap-3">
                  <DatePicker
                    label="From"
                    name="leaveDate"
                    value={form.leaveDate}
                    onChange={handleChange}
                    error={errors.leaveDate}
                    maxDate={maxDate}
                    required
                  />
                  <DatePicker
                    label="To"
                    name="endDate"
                    value={form.endDate}
                    onChange={handleChange}
                    error={errors.endDate}
                    minDate={form.leaveDate ? new Date(form.leaveDate) : undefined}
                    maxDate={maxDate}
                    required
                  />
                </div>
              ) : (
                <DatePicker
                  label="Leave Date"
                  name="leaveDate"
                  value={form.leaveDate}
                  onChange={handleChange}
                  error={errors.leaveDate}
                  maxDate={maxDate}
                  required
                />
              )}
            </div>

            {/* Leave type */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                Leave Type
                {isRange && (
                  <span className="ml-1.5 text-xs font-normal text-gray-400">
                    (tick more than one to split the days)
                  </span>
                )}
              </label>
              <LeaveTypeCheckboxGroup
                value={form.leaveTypes}
                onChange={handleTypeChange}
                remainingByType={remainingByType}
                multiple={isRange}
              />
              {errors.leaveTypes && (
                <p className="text-xs text-red-500 mt-1">{errors.leaveTypes}</p>
              )}
              {showSplit && (
                <AllocationEditor
                  allocation={allocation}
                  total={rangeWorkingDays}
                  remainingByType={remainingByType}
                  onChangeDays={(t, n) =>
                    setAllocOverrides((prev) => ({ ...prev, [t]: n }))
                  }
                />
              )}
              <p className="flex items-start gap-1.5 text-xs text-gray-400 mt-2">
                <Info size={13} className="mt-px flex-shrink-0" />
                {isPastDate
                  ? "This date has passed, so Sick and Casual are suggested first, then Paid. Unpaid and Swap can be picked any time."
                  : "Sick & Casual reset every year; Paid carries forward. Unpaid and Swap can be picked any time."}
              </p>
            </div>

            {/* Reason grows to fill whatever height is left in the card. */}
            <div className="flex-1 flex flex-col min-h-[7.5rem] [&>div]:flex-1 [&_textarea]:flex-1 [&_textarea]:max-h-56">
              <TextArea
                label="Reason"
                name="reason"
                value={form.reason}
                onChange={handleChange}
                error={errors.reason}
                placeholder="Let your admin know why you need this leave..."
                rows={3}
                className="resize-none text-sm"
                required
              />
            </div>
          </div>

          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500 truncate">
              {isRange ? "Date range" : form.isHalfDay ? "Half day" : "Full day"}
              {selectedLabel && (
                <>
                  {" · "}
                  <span className="font-medium text-gray-700">
                    {selectedLabel}
                  </span>
                </>
              )}
            </p>
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              className="whitespace-nowrap flex-shrink-0"
            >
              <Send size={15} />
              Submit Request
            </Button>
          </div>
        </form>

        {/* ── Balances + recent requests ─────────────────────────── */}
        <div className="lg:col-span-2 flex flex-col gap-4 lg:min-h-0">
          <div className="grid grid-cols-3 gap-3 flex-shrink-0">
            {BALANCE_TILES.map((t) => {
              const remaining = remainingByType[t.key];
              const Icon = t.icon;
              return (
                <div
                  key={t.key}
                  className="bg-white rounded-2xl border border-gray-200 shadow-sm px-3 py-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">
                      {t.label}
                    </span>
                    <span
                      className={`w-6 h-6 rounded-lg flex items-center justify-center ${t.iconClass}`}
                    >
                      <Icon size={13} />
                    </span>
                  </div>
                  <p
                    className={`mt-1 text-2xl font-bold leading-none ${
                      remaining != null && remaining <= 0
                        ? "text-gray-300"
                        : "text-gray-800"
                    }`}
                  >
                    {remaining != null ? remaining : "—"}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">days left</p>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col lg:flex-1 lg:min-h-0 max-h-[28rem] lg:max-h-none">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-800">
                Recent Requests
              </h3>
              {requests.length > 0 && (
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 px-2 py-1 rounded-md hover:bg-blue-50"
                >
                  <History size={13} />
                  View history
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {loading ? (
                <div className="p-10 flex justify-center">
                  <Spinner />
                </div>
              ) : requests.length === 0 ? (
                <div className="p-10 text-center">
                  <CalendarX2 className="w-8 h-8 mx-auto text-gray-300" />
                  <p className="text-sm text-gray-500 mt-2">
                    You haven&apos;t submitted any leave requests yet.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {recentGroups.map((g) => {
                    const first = g.days[0];
                    const d = new Date(first.leaveDate);
                    const typeKey = first.leaveType;
                    return (
                      <li
                        key={g.key}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/70"
                      >
                        <div className="w-11 flex-shrink-0 text-center rounded-lg bg-gray-50 border border-gray-100 py-1">
                          <p className="text-base font-bold text-gray-800 leading-none">
                            {isNaN(d) ? "–" : String(d.getDate()).padStart(2, "0")}
                          </p>
                          <p className="text-[10px] font-semibold uppercase text-gray-400 mt-0.5">
                            {isNaN(d)
                              ? ""
                              : d.toLocaleDateString("en-IN", { month: "short" })}
                          </p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-1.5 py-px rounded text-[11px] font-medium ${
                                TYPE_CHIP[typeKey] || TYPE_CHIP.unpaid
                              }`}
                            >
                              {groupTypeLabel(g)}
                              {groupIsHalfDay(g) ? " · Half" : ""}
                            </span>
                            {g.days.length > 1 && (
                              <span className="text-[11px] text-gray-400">
                                {groupDateLabel(g)}
                              </span>
                            )}
                          </div>
                          <p
                            className="text-sm text-gray-600 truncate mt-0.5"
                            title={first.reason}
                          >
                            {first.reason}
                          </p>
                        </div>
                        <LeaveStatusBadge status={groupStatus(g)} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {!loading && totalGroups > RECENT_LIMIT && (
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="px-4 py-2.5 border-t border-gray-100 text-xs font-medium text-blue-600 hover:bg-blue-50/50 rounded-b-2xl"
              >
                Showing latest {RECENT_LIMIT} of {totalGroups} — view all
              </button>
            )}
          </div>
        </div>
      </div>

      <LeaveHistoryModal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        requests={requests}
        loading={loading}
      />
    </div>
  );
};

export default MyLeaveRequests;