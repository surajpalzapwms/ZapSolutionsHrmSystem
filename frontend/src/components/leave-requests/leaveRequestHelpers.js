// src/components/leave-requests/leaveRequestHelpers.js
// Shared by the staff page (MyLeaveRequests), the admin panel
// (LeaveRequestsPanel) and the history modal, so both sides group and label
// leave requests exactly the same way.

export const LEAVE_TYPE_LABELS = {
  sick: "Sick",
  casual: "Casual",
  paid: "Paid",
  unpaid: "Unpaid",
  swapleave: "Swap",
};

export const leaveTypeLabel = (t) =>
  LEAVE_TYPE_LABELS[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : "Leave");

export const formatDate = (d) => {
  if (!d) return "-";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// A multi-day request is saved by the backend as one Leave per day sharing
// the same `batchId` (NOT `requestGroupId` — the old staff page grouped on
// that field, which is never saved, so ranges were never collapsed).
// Collapse each batch into one group; groups keep the order of `requests`
// (the caller sorts newest first).
export const groupRequests = (requests) => {
  const groups = [];
  const byBatch = new Map();
  for (const r of requests) {
    if (!r.batchId) {
      groups.push({ key: r._id, days: [r] });
      continue;
    }
    if (byBatch.has(r.batchId)) {
      byBatch.get(r.batchId).days.push(r);
    } else {
      const entry = { key: r.batchId, days: [r] };
      byBatch.set(r.batchId, entry);
      groups.push(entry);
    }
  }
  groups.forEach((g) =>
    g.days.sort((a, b) => new Date(a.leaveDate) - new Date(b.leaveDate)),
  );
  return groups;
};

// Newest request first (by the day requested, then by when it was created).
export const sortGroupsNewestFirst = (groups) =>
  [...groups].sort((a, b) => {
    const la = new Date(a.days[a.days.length - 1].leaveDate).getTime();
    const lb = new Date(b.days[b.days.length - 1].leaveDate).getTime();
    if (lb !== la) return lb - la;
    return (
      new Date(b.days[0].createdAt || 0).getTime() -
      new Date(a.days[0].createdAt || 0).getTime()
    );
  });

export const dayValueOf = (r) => r.dayValue ?? 1;

// One status for a whole group. If some days are decided and others are not
// (or they differ), the group is shown as "partial" rather than picking
// whichever day happens to be first.
export const groupStatus = (group) => {
  const set = new Set(group.days.map((d) => d.status));
  if (set.size === 1) return [...set][0];
  if (set.has("pending")) return "pending";
  return "partial";
};

// "Sick", "Casual + Unpaid" ... — a range can contain several types (when a
// balance runs out part-way the remaining days fall back to Unpaid).
export const groupTypeLabel = (group) => {
  const types = [...new Set(group.days.map((d) => d.leaveType))];
  return types.map(leaveTypeLabel).join(" + ");
};

export const groupIsHalfDay = (group) =>
  group.days.length === 1 && dayValueOf(group.days[0]) < 1;

export const groupDateLabel = (group) => {
  const first = group.days[0];
  const last = group.days[group.days.length - 1];
  if (group.days.length > 1) {
    return `${formatDate(first.leaveDate)} - ${formatDate(last.leaveDate)} (${group.days.length} days)`;
  }
  return formatDate(first.leaveDate);
};