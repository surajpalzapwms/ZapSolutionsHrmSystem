// src/components/leave-requests/MyLeaveRequests.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock3,
  XCircle,
} from "lucide-react";
import Card from "../common/Card";
import Button from "../common/Button";
import DatePicker from "../common/DatePicker";
import Select from "../common/Select";
import TextArea from "../common/TextArea";
import Spinner from "../common/Spinner";
import { attendanceService } from "../../services/attendanceService";
import { leavePolicyService } from "../../services/leavePolicyService";
import { showToast } from "../../utils/toast";
import { getTodayDate } from "../../utils/dateUtils";

// Balance-tracked types (checked against the accrued/carried-forward balance
// from LeavePolicy — see backend services/leaveBalance.js) come first, in
// the priority order past-dated leave should prefer: Sick and Casual before
// Paid. Unpaid/Swap are never balance-checked so they're always available.
const LEAVE_TYPE_OPTIONS = [
  { value: "sick", label: "Sick Leave", trackedKey: "sick" },
  { value: "casual", label: "Casual Leave", trackedKey: "casual" },
  { value: "paid", label: "Paid Leave", trackedKey: "paid" },
  { value: "unpaid", label: "Unpaid Leave", trackedKey: null },
  { value: "swapleave", label: "Swap Leave", trackedKey: null },
];

// Priority used to auto-suggest a type for a day that's already in the past
// (or today): use up Sick and Casual leave first, only falling back to Paid
// (or finally Unpaid, if nothing is left) once those are exhausted.
const PAST_DATE_PRIORITY = ["sick", "casual", "paid", "unpaid"];

const STATUS_STYLES = {
  pending: {
    className: "bg-amber-100 text-amber-700",
    icon: Clock3,
    label: "Pending",
  },
  approved: {
    className: "bg-green-100 text-green-700",
    icon: CheckCircle2,
    label: "Approved",
  },
  rejected: {
    className: "bg-red-100 text-red-600",
    icon: XCircle,
    label: "Rejected",
  },
};

const emptyForm = {
  duration: "single",
  leaveDate: "",
  endDate: "",
  reason: "",
  leaveType: "unpaid",
};

const DURATION_OPTIONS = [
  { value: "single", label: "Single Day" },
  { value: "range", label: "Date Range" },
];

const StatusBadge = ({ status }) => {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  const Icon = style.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${style.className}`}
    >
      <Icon size={12} />
      {style.label}
    </span>
  );
};

// Balance-aware leave type picker. Renders each type as a checkbox pill —
// only one can be checked at a time (a single day off is exactly one type),
// but checkboxes are what was asked for instead of a plain dropdown, and
// they let each option show its own remaining-balance count and grey out
// once that balance hits zero. Unpaid/Swap never carry a balance so they're
// always selectable.
const LeaveTypeCheckboxGroup = ({ value, onChange, remainingByType }) => (
  <div className="flex flex-wrap gap-2">
    {LEAVE_TYPE_OPTIONS.map((opt) => {
      const remaining = opt.trackedKey
        ? remainingByType?.[opt.trackedKey]
        : null;
      // Leave is always taken in whole days, so anything under 1 remaining
      // (e.g. 0.5 of an accrued day) isn't usable yet — treat it the same
      // as fully depleted so the option greys out instead of letting the
      // staff member pick a type they can't actually draw a full day from.
      const isDepleted =
        opt.trackedKey && remaining != null && remaining < 1;
      const isChecked = value === opt.value;
      return (
        <label
          key={opt.value}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-colors ${
            isChecked
              ? "border-blue-500 bg-blue-50 text-blue-700"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          } ${isDepleted ? "opacity-50 cursor-not-allowed hover:bg-white" : ""}`}
        >
          <span
            className={`flex items-center justify-center w-4 h-4 rounded border ${
              isChecked
                ? "bg-blue-600 border-blue-600"
                : "bg-white border-gray-400"
            }`}
          >
            {isChecked && <Check size={12} className="text-white" />}
          </span>
          <input
            type="checkbox"
            className="sr-only"
            checked={isChecked}
            disabled={isDepleted}
            onChange={() => {
              if (isDepleted) return;
              onChange(opt.value);
            }}
          />
          <span>{opt.label}</span>
          {opt.trackedKey && (
            <span
              className={`text-xs ${isDepleted ? "text-red-500" : "text-gray-400"}`}
            >
              ({remaining != null ? remaining : "—"} left)
            </span>
          )}
        </label>
      );
    })}
  </div>
);

// Multi-day requests share a requestGroupId — collapse them into one row
// (From - To, N days) instead of showing every individual day.
const groupRequests = (requests) => {
  const groups = [];
  const byGroupId = new Map();
  for (const r of requests) {
    if (!r.requestGroupId) {
      groups.push({ key: r._id, days: [r] });
      continue;
    }
    if (byGroupId.has(r.requestGroupId)) {
      byGroupId.get(r.requestGroupId).days.push(r);
    } else {
      const entry = { key: r.requestGroupId, days: [r] };
      byGroupId.set(r.requestGroupId, entry);
      groups.push(entry);
    }
  }
  groups.forEach((g) =>
    g.days.sort((a, b) => new Date(a.leaveDate) - new Date(b.leaveDate)),
  );
  return groups;
};

const formatDate = (d) => {
  if (!d) return "-";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
    } catch (err) {
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
    (dateStr) => {
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
          (t) => t === "unpaid" || (remainingByType[t] ?? 0) >= 1,
        ) || "unpaid"
      );
    },
    [remainingByType],
  );

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      // Re-run the suggestion whenever the leave date changes, as long as
      // the person hasn't manually overridden the type themselves.
      if (name === "leaveDate" && !typeTouched) {
        next.leaveType = suggestLeaveType(value);
      }
      return next;
    });
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handleTypeChange = (leaveType) => {
    setTypeTouched(true);
    setForm((prev) => ({ ...prev, leaveType }));
  };

  const isRange = form.duration === "range";

  const validate = () => {
    const next = {};
    if (!form.leaveDate) next.leaveDate = "Please select a date";
    if (isRange) {
      if (!form.endDate) next.endDate = "Please select an end date";
      else if (form.endDate < form.leaveDate)
        next.endDate = "End date must be on or after start date";
    }
    if (!form.reason.trim()) next.reason = "Please provide a reason";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const payload = {
        leaveDate: form.leaveDate,
        reason: form.reason,
        leaveType: form.leaveType,
        ...(isRange ? { endDate: form.endDate } : {}),
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

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <CalendarPlus className="w-5 h-5 text-blue-600" />
        <h1 className="text-xl font-bold text-gray-800">My Leave Requests</h1>
      </div>

      <Card title="Request Leave">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                Duration
              </label>
              <Select
                name="duration"
                value={form.duration}
                onChange={handleChange}
                options={DURATION_OPTIONS}
              />
            </div>
            <DatePicker
              label={isRange ? "From" : "Leave Date"}
              name="leaveDate"
              value={form.leaveDate}
              onChange={handleChange}
              error={errors.leaveDate}
              maxDate={new Date(new Date().getFullYear() + 1, 11, 31)}
              required
            />
          </div>
          {isRange && (
            <DatePicker
              label="To"
              name="endDate"
              value={form.endDate}
              onChange={handleChange}
              error={errors.endDate}
              maxDate={new Date(new Date().getFullYear() + 1, 11, 31)}
              required
            />
          )}

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Leave Type
            </label>
            <LeaveTypeCheckboxGroup
              value={form.leaveType}
              onChange={handleTypeChange}
              remainingByType={remainingByType}
            />
            <p className="text-xs text-gray-400 mt-1.5">
              {form.leaveDate && form.leaveDate <= getTodayDate()
                ? "This date has already passed, so Sick and Casual leave are drawn down first, then Paid — pick a different box to override."
                : "Pick which balance this leave should count against. Sick and Casual leave resets every year; Paid leave carries forward."}
            </p>
          </div>

          <TextArea
            label="Reason"
            name="reason"
            value={form.reason}
            onChange={handleChange}
            error={errors.reason}
            placeholder="Let your admin know why you need this leave..."
            required
          />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={submitting}>
              Submit Request
            </Button>
          </div>
        </form>
      </Card>

      <Card title="My Requests" noPadding>
        {loading ? (
          <div className="p-10 flex justify-center">
            <Spinner />
          </div>
        ) : requests.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            You haven&apos;t submitted any leave requests yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {groupRequests(requests).map((g) => {
              const first = g.days[0];
              const last = g.days[g.days.length - 1];
              const dateLabel =
                g.days.length > 1
                  ? `${formatDate(first.leaveDate)} - ${formatDate(last.leaveDate)} (${g.days.length} days)`
                  : formatDate(first.leaveDate);
              return (
                <div
                  key={g.key}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4"
                >
                  <div>
                    <p className="font-medium text-gray-800">
                      {dateLabel}{" "}
                      <span className="text-xs font-normal text-gray-400 capitalize">
                        ({first.leaveType})
                      </span>
                    </p>
                    <p className="text-sm text-gray-500">{first.reason}</p>
                  </div>
                  <StatusBadge status={first.status} />
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default MyLeaveRequests;
