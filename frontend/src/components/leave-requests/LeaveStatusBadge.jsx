// src/components/leave-requests/LeaveStatusBadge.jsx
import React from "react";
import { CheckCircle2, Clock3, XCircle, CircleDashed } from "lucide-react";

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
  // Some days of a multi-day request decided differently from the others.
  partial: {
    className: "bg-blue-100 text-blue-700",
    icon: CircleDashed,
    label: "Partially decided",
  },
};

const LeaveStatusBadge = ({ status }) => {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  const Icon = style.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${style.className}`}
    >
      <Icon size={12} />
      {style.label}
    </span>
  );
};

export default LeaveStatusBadge;