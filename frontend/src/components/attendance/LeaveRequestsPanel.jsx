// src/components/attendance/LeaveRequestsPanel.jsx
import React, { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  History,
  Inbox,
  XCircle,
} from "lucide-react";
import Card from "../common/Card";
import Button from "../common/Button";
import Spinner from "../common/Spinner";
import { attendanceService } from "../../services/attendanceService";
import { showToast } from "../../utils/toast";
import LeaveHistoryModal from "../leave-requests/Leavehistorymodal";
import {
  groupRequests,
  groupTypeLabel,
  groupDateLabel,
  groupIsHalfDay,
} from "../leave-requests/leaveRequestHelpers";

/**
 * Admin panel: lists every leave request awaiting a decision and lets the
 * admin approve or reject it in place. Embedded at the top of the Attendance
 * & Leaves page so admins see pending requests without a separate route.
 */
const LeaveRequestsPanel = ({ onDecision, onCountChange }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState([]);

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

  // The Attendance & Leaves page passes onCountChange to drive the bell
  // badge, but this panel never called it, so the badge stayed empty.
  useEffect(() => {
    if (!loading) onCountChange?.(requests.length);
  }, [requests, loading, onCountChange]);

  // Approves/rejects every day of a group one at a time (in date order) so
  // the backend's per-day leave-balance check still runs for each day. If
  // one day fails (e.g. balance runs out part-way), the days already
  // decided are removed from the list and the error is shown.
  const decideGroup = async (group, action) => {
    const isApprove = action === "approve";
    const call = isApprove
      ? attendanceService.approveLeaveRequest
      : attendanceService.rejectLeaveRequest;
    const done = new Set();
    setActingId(group.key);
    try {
      for (const day of group.days) {
        await call(day._id);
        done.add(day._id);
      }
      const verb = isApprove ? "approved" : "rejected";
      showToast(
        "success",
        group.days.length > 1
          ? `Leave request ${verb} for ${group.days.length} days`
          : `Leave request ${verb}`,
      );
    } catch (err) {
      showToast(
        "error",
        (done.size ? `${done.size} of ${group.days.length} day(s) done. ` : "") +
          (err.response?.data?.message ||
            `Failed to ${action} request`),
      );
    } finally {
      if (done.size) {
        setRequests((prev) => prev.filter((r) => !done.has(r._id)));
        onDecision?.();
      }
      setActingId(null);
    }
  };

  // Every request (any status, any staff member) for the history modal.
  const openHistory = async () => {
    setHistoryOpen(true);
    try {
      setHistoryLoading(true);
      const res = await attendanceService.getAllLeaveRequests();
      setHistory(res.data?.leaves || []);
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to load leave history",
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleApprove = (group) => decideGroup(group, "approve");
  const handleReject = (group) => decideGroup(group, "reject");

  return (
    <Card className="mb-4" noPadding>
      <div className="flex items-center justify-between pr-6">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex-1 flex items-center justify-between px-6 py-4"
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
      <Button
        size="sm"
        variant="outline"
        className="ml-3 shrink-0"
        onClick={openHistory}
      >
        <History size={14} />
        View Leave History
      </Button>
      </div>

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
                const dateLabel = groupDateLabel(g);
                return (
                  <div
                    key={g.key}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4"
                  >
                    <div>
                      <p className="font-medium text-gray-800">
                        {first.userId?.staffName || "Unknown Staff"}{" "}
                        <span className="text-xs font-normal text-gray-400">
                          {dateLabel} · {groupTypeLabel(g)}
                          {groupIsHalfDay(g) ? " · Half Day" : ""}
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
      <LeaveHistoryModal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        requests={history}
        loading={historyLoading}
        showStaffName
        title="Leave History — All Staff"
      />
    </Card>
  );
};

export default LeaveRequestsPanel;