// src/components/attendance/calendarHelpers.js
// Plain constants/helpers shared by the attendance calendar components.
// Kept separate from calendarGridPieces.jsx (components only) so Vite's
// fast refresh works for those components during development.

export const STATUS_STYLES = {
  present: "bg-green-500 text-white border-green-500",
  half: "bg-orange-400 text-white border-orange-400",
  swap: "bg-purple-500 text-white border-purple-500",
  paid: "bg-blue-500 text-white border-blue-500",
  sick: "bg-teal-500 text-white border-teal-500",
  casual: "bg-pink-500 text-white border-pink-500",
  unpaid: "bg-red-600 text-white border-red-600",
  holiday: "bg-yellow-400 text-gray-900 border-yellow-400",
};

export const LEGEND = [
  { label: "Present", className: "bg-green-500" },
  { label: "Half Day", className: "bg-orange-400" },
  { label: "Swap Leave", className: "bg-purple-500" },
  { label: "Paid Leave", className: "bg-blue-500" },
  { label: "Sick Leave", className: "bg-teal-500" },
  { label: "Casual Leave", className: "bg-pink-500" },
  { label: "Unpaid Leave", className: "bg-red-600" },
  { label: "Holiday", className: "bg-yellow-400" },
  {
    // Half green (worked) / half red (Paid, Sick or Casual leave)
    label: "Half Day + Leave",
    className: "bg-[linear-gradient(135deg,#22c55e_50%,#dc2626_50%)]",
  },
  { label: "Today", className: "bg-white border-2 border-indigo-400" },
];

// Colors for the diagonal split shown on a day that is half present and
// half covered by leave. CSS can't split one background between two
// Tailwind classes, so the split is painted with an inline linear-gradient.
export const SPLIT_HEX = {
  present: "#22c55e", // green-500 — the worked half, always green
  paid: "#dc2626", // red-600 — Paid leave half
  sick: "#dc2626", // red-600 — Sick leave half
  casual: "#dc2626", // red-600 — Casual leave half
  unpaid: "#dc2626", // red-600
  swap: "#a855f7", // purple-500
};

const SPLIT_LEAVE_TYPES = ["paid", "sick", "casual", "unpaid", "swap"];

// Which leave covers the other half of a half-present day.
// Uses topUpLeaveType when the backend sends it; otherwise falls back to
// the cell's status if that status is itself a leave type.
export const getSplitLeaveType = (info) => {
  if (!info) return null;
  const t = (info.topUpLeaveType || "").toLowerCase();
  if (t === "swapleave") return "swap";
  if (SPLIT_LEAVE_TYPES.includes(t)) return t;
  if (SPLIT_LEAVE_TYPES.includes(info.status)) return info.status;
  return null;
};

// A day is "split" when it is half present + half leave. Covers both the
// isHalfDayTopUp flag and a "half" day that carries a topUpLeaveType.
export const isSplitDay = (info) => {
  if (!info || info.status === "holiday") return false;
  if (info.isHalfDayTopUp) return true;
  return info.status === "half" && !!info.topUpLeaveType;
};

// Inline style: half green (present) / half red (paid, sick or casual leave).
// Returns undefined for ordinary single-color days so callers fall back to
// the normal Tailwind background from dayCellClasses.
export const dayCellSplitStyle = (info) => {
  if (!isSplitDay(info)) return undefined;
  const leaveType = getSplitLeaveType(info);
  const otherColor = SPLIT_HEX[leaveType] || SPLIT_HEX.paid;
  return {
    background: `linear-gradient(135deg, ${SPLIT_HEX.present} 0%, ${SPLIT_HEX.present} 50%, ${otherColor} 50%, ${otherColor} 100%)`,
  };
};

export const formatTime = (value) => {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export const TOOLTIP_STATUSES = [
  "present",
  "half",
  "holiday",
  "paid",
  "sick",
  "casual",
  "unpaid",
  "swap",
];

// "holiday" is deliberately excluded from DELETABLE_STATUSES
export const DELETABLE_STATUSES = [
  "present",
  "half",
  "paid",
  "sick",
  "casual",
  "unpaid",
  "swap",
];

// Days an admin can re-mark from the pencil icon: anything concrete, plus
// Holiday/Sunday — an admin can change a holiday into Paid / Sick /
// Casual / Unpaid leave (for this staff member only), or turn any marked
// day into a Holiday. Blank days (future / before joining) aren't editable.
export const EDITABLE_STATUSES = [...DELETABLE_STATUSES, "holiday"];

export const LEAVE_LABELS = {
  paid: "Paid Leave",
  sick: "Sick Leave",
  casual: "Casual Leave",
  unpaid: "Unpaid Leave",
  swap: "Swap Leave",
};


export const dayCellClasses = (status, isToday, isSelected, isSplit) => {
  if (status === "holiday") {
    return STATUS_STYLES.holiday; // Always yellow, ignore rings
  }
  const base = isSplit
    ? "text-white border-transparent"
    : STATUS_STYLES[status] || "bg-white text-gray-600 border-gray-200";
  const todayRing = isToday ? "ring-2 ring-indigo-400 ring-offset-1" : "";
  const selectedRing = isSelected ? "ring-2 ring-gray-800 ring-offset-1" : "";
  return `${base} ${todayRing} ${selectedRing}`;
};

// ─── Staff lifecycle dates (joining / internship / probation) ─────────
// Used by the staff self-service calendar (MyAttendance) so it only shows
// data from the joining date onward, and can label each day that falls in
// the internship or probation period.

// Any date-ish value -> "YYYY-MM-DD" in IST (dates are stored as IST
// midnight, which is the previous day in UTC — so never slice the ISO).
export const toISTDateKey = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
};

// year, 0-based month, day -> "YYYY-MM-DD"
export const dateKeyOf = (year, month, day) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const shiftKey = (key, deltaDays) => {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dateKeyOf(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
};

const prettyKey = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

// Builds { joinKey, relieveKey, periods: [{ type, label, start, end }] }
// from a Staff record. Same lifecycle rules as StaffForm/StaffDetailsModal:
//   Internship: joining date -> internshipEndDate
//   Probation : day after internship (or joining date) -> probationEndDate
//               (falls back to the day before confirmation, or open-ended
//               while the staff member is still on probation)
export const buildStaffTimeline = (staff) => {
  if (!staff) return { joinKey: null, relieveKey: null, periods: [] };
  const joinKey = toISTDateKey(staff.date);
  const relieveKey =
    staff.status === "Relieved" ? toISTDateKey(staff.relievingDate) : null;
  const internEnd = toISTDateKey(staff.internshipEndDate);
  const probEnd = toISTDateKey(staff.probationEndDate);
  const confirmKey = toISTDateKey(staff.confirmationDate);
  const periods = [];

  if (joinKey && (internEnd || staff.status === "Internship")) {
    periods.push({ type: "internship", label: "Internship period", start: joinKey, end: internEnd });
  }

  const probStart = internEnd ? shiftKey(internEnd, 1) : joinKey;
  const probEndResolved = probEnd || (confirmKey ? shiftKey(confirmKey, -1) : null);
  if (probStart && (probEndResolved || staff.status === "Probation")) {
    periods.push({ type: "probation", label: "Probation period", start: probStart, end: probEndResolved });
  }

  periods.forEach((p) => {
    p.rangeText = `${prettyKey(p.start)} – ${p.end ? prettyKey(p.end) : "ongoing"}`;
  });
  return { joinKey, relieveKey, periods };
};

// Which internship/probation period (if any) a "YYYY-MM-DD" falls in.
export const periodForDate = (periods, key) => {
  if (!key || !periods?.length) return null;
  return periods.find((p) => key >= p.start && (!p.end || key <= p.end)) || null;
};

export const PERIOD_STYLES = {
  internship: "text-purple-300",
  probation: "text-sky-300",
};
