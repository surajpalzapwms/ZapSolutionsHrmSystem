// src/components/attendance/LeaveRequestsPanel.jsx
import React, { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Inbox,
  XCircle,
} from "lucide-react";
import Card from "../common/Card";
import Button from "../common/Button";
import Spinner from "../common/Spinner";
import { attendanceService } from "../../services/attendanceService";
import { showToast } from "../../utils/toast";

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

// Multi-day ("range") requests share a requestGroupId — collapse them into
// one row (From - To, N days) so the admin approves/rejects the whole span
// with a single action instead of one per day.
const groupRequests = (requests) => {
  const groups = [];
  const byGroupId = new Map();
  for (const r of requests) {
    if (!r.requestGroupId) {
      groups.push({ key: r._id, groupId: null, days: [r] });
      continue;
    }
    if (byGroupId.has(r.requestGroupId)) {
      byGroupId.get(r.requestGroupId).days.push(r);
    } else {
      const entry = {
        key: r.requestGroupId,
        groupId: r.requestGroupId,
        days: [r],
      };
      byGroupId.set(r.requestGroupId, entry);
      groups.push(entry);
    }
  }
  groups.forEach((g) =>
    g.days.sort((a, b) => new Date(a.leaveDate) - new Date(b.leaveDate)),
  );
  return groups;
};

/**
 * Admin panel: lists every leave request awaiting a decision and lets the
 * admin approve or reject it in place. Embedded at the top of the Attendance
 * & Leaves page so admins see pending requests without a separate route.
 */
const LeaveRequestsPanel = ({ onDecision }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [actingId, setActingId] = useState(null);

  const fetchPending = useCallback(async () => {
    try {
      setLoading(true);
      const res = await attendanceService.getPendingLeaveRequests();
      setRequests(res.data?.leaves || []);
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to load leave requests",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const handleApprove = async (group) => {
    setActingId(group.key);
    try {
      if (group.groupId) {
        await attendanceService.approveLeaveGroup(group.groupId);
      } else {
        await attendanceService.approveLeaveRequest(group.key);
      }
      showToast(
        "success",
        group.days.length > 1
          ? `Leave request approved for ${group.days.length} days`
          : "Leave request approved",
      );
      const idsInGroup = new Set(group.days.map((d) => d._id));
      setRequests((prev) => prev.filter((r) => !idsInGroup.has(r._id)));
      onDecision?.();
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to approve request",
      );
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (group) => {
    setActingId(group.key);
    try {
      if (group.groupId) {
        await attendanceService.rejectLeaveGroup(group.groupId);
      } else {
        await attendanceService.rejectLeaveRequest(group.key);
      }
      showToast(
        "success",
        group.days.length > 1
          ? `Leave request rejected for ${group.days.length} days`
          : "Leave request rejected",
      );
      const idsInGroup = new Set(group.days.map((d) => d._id));
      setRequests((prev) => prev.filter((r) => !idsInGroup.has(r._id)));
      onDecision?.();
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to reject request",
      );
    } finally {
      setActingId(null);
    }
  };

  return (
    <Card className="mb-4" noPadding>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-4"
      >
        <div className="flex items-center gap-2">
          <Inbox className="w-5 h-5 text-amber-600" />
          <h3 className="text-base font-semibold text-gray-800">
            Leave Requests
          </h3>
          {requests.length > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">
              {requests.length} pending
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {expanded && (
        <div className="border-t border-gray-200">
          {loading ? (
            <div className="p-8 flex justify-center">
              <Spinner />
            </div>
          ) : requests.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No pending leave requests. 🎉
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
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4"
                  >
                    <div>
                      <p className="font-medium text-gray-800">
                        {first.userId?.staffName || "Unknown Staff"}{" "}
                        <span className="text-xs font-normal text-gray-400">
                          {dateLabel} · {first.leaveType}
                        </span>
                      </p>
                      <p className="text-sm text-gray-500">{first.reason}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="success"
                        onClick={() => handleApprove(g)}
                        disabled={actingId === g.key}
                      >
                        <CheckCircle2 size={14} />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleReject(g)}
                        disabled={actingId === g.key}
                      >
                        <XCircle size={14} />
                        Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

export default LeaveRequestsPanel;
