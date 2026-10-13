// src/components/leave-requests/LeaveHistoryModal.jsx
// Full leave history in a modal. Used by the staff page ("View Leave
// History") and by the admin panel (history of every staff member).
import React, { useMemo, useState } from "react";
import Modal from "../common/Modal";
import Spinner from "../common/Spinner";
import LeaveStatusBadge from "./LeaveStatusBadge";
import {
  groupRequests,
  sortGroupsNewestFirst,
  groupStatus,
  groupTypeLabel,
  groupDateLabel,
  groupIsHalfDay,
} from "./leaveRequestHelpers";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const LeaveHistoryModal = ({
  isOpen,
  onClose,
  requests = [],
  loading = false,
  showStaffName = false,
  title = "Leave History",
}) => {
  const [filter, setFilter] = useState("all");

  const groups = useMemo(
    () => sortGroupsNewestFirst(groupRequests(requests)),
    [requests],
  );

  const visible = useMemo(
    () =>
      filter === "all"
        ? groups
        : groups.filter((g) => g.days.some((d) => d.status === filter)),
    [groups, filter],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="max-w-3xl"
      closeOnBackdrop
      bodyClassName="p-0"
    >
      <div className="flex flex-wrap gap-2 px-6 py-3 border-b border-gray-200">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
              filter === f.value
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400 self-center">
          {visible.length} request{visible.length === 1 ? "" : "s"}
        </span>
      </div>

      {loading ? (
        <div className="p-10 flex justify-center">
          <Spinner />
        </div>
      ) : visible.length === 0 ? (
        <div className="p-10 text-center text-gray-500">
          No leave requests found.
        </div>
      ) : (
        <div className="divide-y divide-gray-200">
          {visible.map((g) => {
            const first = g.days[0];
            return (
              <div
                key={g.key}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-6 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-800">
                    {showStaffName && (
                      <span className="mr-2">
                        {first.userId?.staffName || "Unknown Staff"}
                        <span className="text-gray-300 font-normal"> · </span>
                      </span>
                    )}
                    {groupDateLabel(g)}{" "}
                    <span className="text-xs font-normal text-gray-400">
                      ({groupTypeLabel(g)}
                      {groupIsHalfDay(g) ? " · Half Day" : ""})
                    </span>
                  </p>
                  <p className="text-sm text-gray-500 break-words">
                    {first.reason}
                  </p>
                </div>
                <LeaveStatusBadge status={groupStatus(g)} />
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
};

export default LeaveHistoryModal;