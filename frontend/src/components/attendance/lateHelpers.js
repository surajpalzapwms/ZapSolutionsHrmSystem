// src/components/attendance/lateHelpers.js
// Small helpers for the late-coming UI (LateComingPanel, day badges, tooltips).
import { formatCurrency } from "../../utils/numberUtils";

export const mins = (n) => {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v < 60) return `${v} min`;
  const h = Math.floor(v / 60);
  const m = v % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

export const fmtDay = (key) => {
  const d = new Date(`${key}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? key
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", weekday: "short" });
};

// Status of one late date, for the chip + colours.
export const lateState = (late, monthEnabled = true) => {
  if (!late) return null;
  if (late.pending) return { key: "pending", label: "Pending", cls: "bg-amber-100 text-amber-700", dot: "bg-amber-500" };
  if (late.fullyMadeUp) return { key: "madeup", label: "Made up", cls: "bg-green-100 text-green-700", dot: "bg-green-500" };
  if (late.waived) return { key: "waived", label: "Waived", cls: "bg-gray-100 text-gray-600", dot: "bg-gray-400" };
  if (!monthEnabled) return { key: "off", label: "Not deducted", cls: "bg-gray-100 text-gray-600", dot: "bg-gray-400" };
  return { key: "deducted", label: "Deducted", cls: "bg-red-100 text-red-700", dot: "bg-red-500" };
};

/** One-line explanation used in tooltips. */
export const lateExplain = (late) => {
  if (!late) return "";
  const parts = [`Late ${mins(late.lateMinutes)} (${late.bufferMinutes} min grace)`];
  if (late.stayedLateMinutes > 0) parts.push(`stayed ${mins(late.stayedLateMinutes)} extra`);
  if (late.lunchCreditMinutes > 0) parts.push(`lunch counted as work ${mins(late.lunchCreditMinutes)}`);
  if (late.pending) parts.push("still signed in — can be made up today");
  else if (late.deductibleMinutes > 0) parts.push(`${mins(late.deductibleMinutes)} = ${formatCurrency(late.amount)}`);
  else parts.push("fully made up");
  return parts.join(" · ");
};


/** Same details as lateExplain, one item per line — used by the calendar
 *  tooltip so nothing is cut off. */
export const lateExplainLines = (late) => {
  if (!late) return [];
  const lines = [`Signed in late: ${mins(late.lateMinutes)} (${late.bufferMinutes} min grace)`];
  if (late.stayedLateMinutes > 0) lines.push(`Stayed after shift: ${mins(late.stayedLateMinutes)} extra`);
  if (late.lunchCreditMinutes > 0) lines.push(`Lunch counted as work: ${mins(late.lunchCreditMinutes)}`);
  if (late.pending) lines.push("Still signed in — can be made up today");
  else if (late.deductibleMinutes > 0)
    lines.push(`Deducted: ${mins(late.deductibleMinutes)} = ${formatCurrency(late.amount)}`);
  else lines.push("Fully made up — nothing deducted");
  return lines;
};
