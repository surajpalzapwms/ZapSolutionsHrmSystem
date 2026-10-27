// src/components/attendance/LateComingPanel.jsx
// "Late coming" box under the Monthly calendar (admin + staff views).
//
// Rules (same as backend services/lateDeduction.js):
//   • first 15 minutes after shift start are a buffer — never deducted
//   • every minute after that is deducted at the per-minute salary
//     (per-day salary ÷ net shift minutes)
//   • minutes stayed after shift end on the same day cancel late minutes
//     (late 20 min at 10:20, sign out 6:50 PM → nothing deducted)
//   • LUNCH (1:30–2:15 PM, 45 min): if lunch was NOT taken the lunch time counts
//     as working time; if lunch was taken, the unused part of the 45 min counts.
//     It is only applied when a deduction would otherwise be generated.
//   • SUPER ADMIN can switch the deduction off for the whole month, or
//     waive single dates. Everyone else just sees the figures.
import React, { useEffect, useState } from "react";
import { AlarmClock, Check, Ban, Hourglass, Utensils } from "lucide-react";
import { formatCurrency } from "../../utils/numberUtils";
import { formatTime } from "./calendarHelpers";
import { mins, fmtDay, lateState, lateExplain } from "./lateHelpers";


// Lunch control for one late date.
//   Super admin: "No lunch" switch; when it is off, type how many minutes lunch took.
//   Everyone else: read-only text.
const LunchCell = ({ late, canEdit, busy, onChangeLunch }) => {
  const [val, setVal] = useState(late.lunchTakenMinutes ?? "");
  useEffect(() => setVal(late.lunchTakenMinutes ?? ""), [late.lunchTakenMinutes, late.lunchSkipped]);

  const allowed = late.lunchAllowedMinutes || 45;
  // Lunch only matters when a deduction exists (or already was cancelled by lunch).
  const relevant =
    late.lunchEligible && !late.pending && (late.deductibleBeforeLunch > 0 || late.lunchCreditMinutes > 0);

  if (!relevant) return <span className="text-[11px] text-gray-400">—</span>;

  const credit = late.lunchCreditMinutes > 0 ? (
    <span className="text-[11px] font-semibold text-green-700">+{mins(late.lunchCreditMinutes)} counted</span>
  ) : null;

  if (!canEdit) {
    return (
      <div className="flex flex-col items-end leading-tight">
        <span className="text-[11px] text-gray-600">
          {late.lunchSkipped
            ? "Lunch not taken"
            : late.lunchTakenMinutes !== null
              ? `Lunch ${mins(late.lunchTakenMinutes)}`
              : "—"}
        </span>
        {credit}
      </div>
    );
  }

  const save = () => {
    const raw = String(val).trim();
    if (raw === "") {
      if (late.lunchTakenMinutes !== null) onChangeLunch?.(late.date, false, null);
      return;
    }
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 0 || n > 480) return setVal(late.lunchTakenMinutes ?? "");
    if (n !== late.lunchTakenMinutes) onChangeLunch?.(late.date, false, n);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-700 select-none">
        <Utensils size={11} />
        <span>No lunch</span>
        <button
          type="button"
          role="switch"
          aria-checked={late.lunchSkipped}
          disabled={busy}
          title="Lunch not taken — lunch time counts as working time"
          onClick={() => onChangeLunch?.(late.date, !late.lunchSkipped, null)}
          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            late.lunchSkipped ? "bg-green-500" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
              late.lunchSkipped ? "translate-x-3.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </label>
      {!late.lunchSkipped && (
        <label className="flex items-center gap-1 text-[11px] text-gray-500">
          taken
          <input
            type="number"
            min={0}
            max={480}
            inputMode="numeric"
            value={val}
            disabled={busy}
            placeholder={String(allowed)}
            onChange={(e) => setVal(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="w-12 rounded border border-gray-300 px-1 py-0.5 text-right text-[11px] text-gray-800 disabled:opacity-50"
          />
          min
        </label>
      )}
      {credit}
    </div>
  );
};

const LateComingPanel = ({
  summary, // calendar.lateSummary
  monthLabel,
  canEdit = false, // super admin only
  busy = false,
  onToggleMonth, // (deductLate: boolean) => void
  onToggleDay, // (date, waived: boolean) => void
  onChangeLunch, // (date, lunchSkipped: boolean, lunchTakenMinutes: number|null) => void
}) => {
  if (!summary) return null;
  const { enabled, dates = [], bufferMinutes = 15, perMinuteRate = 0 } = summary;

  return (
    <section className="mt-5 rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-amber-50/60">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-bold text-gray-800">
            <AlarmClock size={16} className="text-amber-600" /> Late coming — {monthLabel}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {bufferMinutes} min grace after shift start · {formatCurrency(perMinuteRate)}/min ·
            time stayed after shift end is adjusted first
          </p>
        </div>

        {canEdit ? (
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700 select-none">
            <span>Deduct from salary this month</span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={busy}
              onClick={() => onToggleMonth?.(!enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                enabled ? "bg-red-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  enabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
            <span className={enabled ? "text-red-600 font-semibold" : "text-gray-500"}>{enabled ? "ON" : "OFF"}</span>
          </label>
        ) : (
          <span
            className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${
              enabled ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
            }`}
          >
            {enabled ? "Deducted this month" : "Not deducted this month"}
          </span>
        )}
      </div>

      {dates.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 border-b border-gray-100 bg-white text-xs text-gray-600">
          <span className="flex items-center gap-1.5 font-semibold text-gray-700">
            <Utensils size={13} className="text-amber-600" /> Lunch ({summary.lunchAllowedMinutes || 45} min allowed)
          </span>
          <span>
            Not taken: <b className="text-gray-800">{summary.lunchSkippedDays || 0}</b> day{summary.lunchSkippedDays === 1 ? "" : "s"}
          </span>
          <span>
            Taken: <b className="text-gray-800">{summary.lunchTakenDays || 0}</b> day{summary.lunchTakenDays === 1 ? "" : "s"}
            {summary.totalLunchTakenMinutes > 0 && <> ({mins(summary.totalLunchTakenMinutes)} total)</>}
          </span>
          <span>
            Counted as working time:{" "}
            <b className={summary.totalLunchCreditMinutes > 0 ? "text-green-700" : "text-gray-800"}>
              {mins(summary.totalLunchCreditMinutes || 0)}
            </b>
          </span>
        </div>
      )}

      {dates.length === 0 ? (
        <p className="px-4 py-4 text-sm text-gray-500 flex items-center gap-2">
          <Check size={16} className="text-green-600" /> No late coming this month.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50">
                <th className="px-4 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">In / Out</th>
                <th className="px-3 py-2 font-semibold text-right">Late</th>
                <th className="px-3 py-2 font-semibold text-right">Stayed extra</th>
                <th className="px-3 py-2 font-semibold text-right">Lunch</th>
                <th className="px-3 py-2 font-semibold text-right">Charged</th>
                <th className="px-3 py-2 font-semibold text-right">Amount</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                {canEdit && <th className="px-4 py-2 font-semibold text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dates.map((l) => {
                const st = lateState(l, enabled);
                const canToggle = canEdit && !l.pending && (l.deductibleMinutes > 0 || l.waived);
                return (
                  <tr key={l.date} className="hover:bg-gray-50">
                    <td className="px-4 py-2 whitespace-nowrap font-medium text-gray-800">{fmtDay(l.date)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                      {formatTime(l.loginTime)} – {l.logoutTime ? formatTime(l.logoutTime) : "…"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-gray-700">{mins(l.lateMinutes)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-green-700">
                      {l.stayedLateMinutes > 0 ? mins(l.stayedLateMinutes) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <LunchCell late={l} canEdit={canEdit} busy={busy} onChangeLunch={onChangeLunch} />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-gray-700">{mins(l.deductibleMinutes)}</td>
                    <td
                      className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${
                        l.deducted ? "text-red-600" : "text-gray-400 line-through decoration-1"
                      }`}
                    >
                      {l.amount > 0 ? formatCurrency(l.amount) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 ${st.cls}`}>
                        {st.key === "pending" && <Hourglass size={11} />}
                        {st.label}
                      </span>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-2 text-right">
                        {canToggle ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onToggleDay?.(l.date, !l.waived)}
                            className={`inline-flex items-center gap-1 text-xs font-semibold rounded-md border px-2 py-1 disabled:opacity-50 ${
                              l.waived
                                ? "border-red-200 text-red-700 hover:bg-red-50"
                                : "border-gray-300 text-gray-700 hover:bg-gray-100"
                            }`}
                          >
                            {l.waived ? "Deduct" : (<><Ban size={12} /> Don't deduct</>)}
                          </button>
                        ) : (
                          <span className="text-[11px] text-gray-400">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-gray-100 bg-gray-50 text-xs">
        <span className="text-gray-600">
          {summary.lateDays} late day{summary.lateDays === 1 ? "" : "s"}
          {summary.madeUpDays ? ` · ${summary.madeUpDays} made up by staying late` : ""}
          {summary.waivedAmount > 0 ? ` · ${formatCurrency(summary.waivedAmount)} not deducted` : ""}
          {summary.pendingAmount > 0 ? ` · ${formatCurrency(summary.pendingAmount)} pending today` : ""}
        </span>
        <span className="font-semibold text-gray-800">
          Deducted from salary:{" "}
          <span className={summary.totalDeduction > 0 ? "text-red-600" : "text-gray-500"}>
            {formatCurrency(summary.totalDeduction)}
          </span>
          {summary.totalDeductibleMinutes > 0 && (
            <span className="ml-1 font-normal text-gray-500">({mins(summary.totalDeductibleMinutes)})</span>
          )}
        </span>
      </div>
    </section>
  );
};

/** Small clock dot on a calendar day that has late coming. */
export const LateDayBadge = ({ late, monthEnabled = true }) => {
  const st = lateState(late, monthEnabled);
  if (!st) return null;
  return (
    <span
      className={`pointer-events-none absolute bottom-1 left-1 inline-flex items-center justify-center w-4 h-4 rounded-full text-white ${st.dot}`}
      title={lateExplain(late)}
      aria-label={`Late: ${st.label}`}
    >
      <AlarmClock size={10} />
    </span>
  );
};

export default LateComingPanel;
