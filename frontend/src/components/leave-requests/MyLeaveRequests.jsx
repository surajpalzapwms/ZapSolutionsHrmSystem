// src/components/leave-requests/MyLeaveRequests.jsx
import React, { useCallback, useEffect, useState } from "react";
import { CalendarPlus, CheckCircle2, Clock3, XCircle } from "lucide-react";
import Card from "../common/Card";
import Button from "../common/Button";
import DatePicker from "../common/DatePicker";
import Select from "../common/Select";
import TextArea from "../common/TextArea";
import Spinner from "../common/Spinner";
import { attendanceService } from "../../services/attendanceService";
import { showToast } from "../../utils/toast";

const LEAVE_TYPE_OPTIONS = [
  { value: "unpaid", label: "Unpaid Leave" },
  { value: "paid", label: "Paid Leave" },
  { value: "swapleave", label: "Swap Leave" },
];

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

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
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
      await fetchRequests();
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
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">
                Leave Type
              </label>
              <Select
                name="leaveType"
                value={form.leaveType}
                onChange={handleChange}
                options={LEAVE_TYPE_OPTIONS}
                placeholder="Select leave type"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DatePicker
              label={isRange ? "From" : "Leave Date"}
              name="leaveDate"
              value={form.leaveDate}
              onChange={handleChange}
              error={errors.leaveDate}
              maxDate={new Date(new Date().getFullYear() + 1, 11, 31)}
              required
            />
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
