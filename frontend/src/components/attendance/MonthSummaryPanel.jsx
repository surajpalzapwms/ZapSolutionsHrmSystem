// src/components/attendance/MonthSummaryPanel.jsx
// Right-hand panel of the Monthly attendance view: for the month on the
// selected tab it shows
//   • Paid Leave earned, left (GREEN) and taken (RED), with their ₹ value
//   • that month's salary
//   • advance(s) given in that month
//   • Total payable = Salary − Advance given
//     Paid Leave is NOT added month by month. Only in the RELIEVING month
//     of a staff member who has left, the Paid Leave left from ALL months
//     (full & final encashment) is added:
//       Total payable = Salary + total Paid Leave left − Advance given
import React from "react";
import { Wallet, CalendarCheck, HandCoins, Calculator } from "lucide-react";
import { formatCurrency } from "../../utils/numberUtils";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";

const days = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `${v} day${v === 1 ? "" : "s"}`;
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const Line = ({ label, value, className = "text-gray-800", sub }) => (
  <div className="flex items-start justify-between gap-3 py-1">
    <span className="text-xs text-gray-500">
      {label}
      {sub && <span className="block text-[10px] text-gray-400">{sub}</span>}
    </span>
    <span className={`text-sm font-semibold whitespace-nowrap ${className}`}>{value}</span>
  </div>
);

const Section = ({ icon: Icon, title, children }) => (
  <div className="px-4 py-3">
    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
      <Icon size={13} /> {title}
    </p>
    {children}
  </div>
);

const MonthSummaryPanel = ({
  monthLabel,
  pl,
  salary,
  salaryLoading,
  advances = [],
  advancesLoading,
  isRelievingMonth = false,
  finalPaidLeave = null, // { days, amount, months: [{ label, days, perDaySalary, amount }] }
}) => {
  const plLeftAmount = pl?.credited ? Number(pl.plLeftAmount ?? pl.amount) || 0 : 0;
  const plTakenAmount = pl?.credited ? Number(pl.plTakenAmount) || 0 : 0;
  const salaryAmount = salary ? Number(salary.netSalary) || 0 : 0;
  const advanceTotal = round2(advances.reduce((s, a) => s + (Number(a.amount) || 0), 0));
  const addPaidLeave = isRelievingMonth && !!finalPaidLeave;
  const finalPlAmount = addPaidLeave ? Number(finalPaidLeave.amount) || 0 : 0;
  const totalPayable = round2(salaryAmount + finalPlAmount - advanceTotal);

  return (
    <aside className="rounded-xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100 self-start">
      <div className="bg-[#1f4a82] px-4 py-2.5">
        <p className="text-sm font-bold text-white">{monthLabel} — Summary</p>
      </div>

      <Section icon={CalendarCheck} title="Paid Leave">
        {!pl ? (
          <p className="text-xs text-gray-400 py-1">No Paid Leave for this month (before confirmation).</p>
        ) : !pl.credited ? (
          <p className="text-xs text-orange-600 py-1">{pl.reason || "Not earned this month."}</p>
        ) : (
          <>
            <Line
              label={`Earned ${days(pl.plDays)}`}
              sub={`${formatCurrency(pl.perDaySalary)}/day`}
              value={formatCurrency(pl.amount)}
            />
            <Line
              label={`Left ${days(pl.plLeftDays)}`}
              value={formatCurrency(plLeftAmount)}
              className="text-green-600"
            />
            <Line
              label={`Taken ${days(pl.plTakenDays)}`}
              value={formatCurrency(plTakenAmount)}
              className="text-red-600"
            />
          </>
        )}
      </Section>

      <Section icon={Wallet} title="Salary">
        {salaryLoading && !salary ? (
          <p className="text-xs text-gray-400 py-1">Loading…</p>
        ) : !salary ? (
          <p className="text-xs text-gray-400 py-1">No salary for this month.</p>
        ) : (
          <Line
            label={salary.isEstimate ? "Salary (estimate)" : `Salary (${salary.status || "saved"})`}
            sub={
              salary.payableDays != null && salary.totalDays != null
                ? `${salary.payableDays}/${salary.totalDays} days paid${
                    salary.unpaidDays ? ` · ${salary.unpaidDays} unpaid` : ""
                  }${
                    // Why the month is short (joining / relieving date / month
                    // not finished) — from the backend calculation.
                    salary.payableNote && salary.payableDays < salary.totalDays
                      ? ` · ${salary.payableNote}`
                      : ""
                  }`
                : undefined
            }
            value={formatCurrency(salaryAmount)}
            className="text-blue-800"
          />
        )}
        {Number(salary?.advanceDeduction) > 0 && (
          <p className="text-[10px] text-gray-400">
            {formatCurrency(salary.advanceDeduction)} advance already recovered in this payroll
          </p>
        )}
      </Section>

      <Section icon={HandCoins} title="Advance given">
        {advancesLoading ? (
          <p className="text-xs text-gray-400 py-1">Loading…</p>
        ) : advances.length === 0 ? (
          <Line label="No advance this month" value={formatCurrency(0)} className="text-gray-400" />
        ) : (
          <>
            {advances.map((a) => (
              <Line
                key={a._id}
                label={formatDateToDDMMMYYYY(a.date)}
                sub={[a.reason, a.status].filter(Boolean).join(" · ")}
                value={formatCurrency(a.amount)}
                className="text-orange-600"
              />
            ))}
            {advances.length > 1 && (
              <Line label="Total advance" value={formatCurrency(advanceTotal)} className="text-orange-600" />
            )}
          </>
        )}
      </Section>

      <div className="px-4 py-3 bg-amber-50">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 mb-1">
          <Calculator size={13} /> Total payable
        </p>
        <div className="text-[11px] text-gray-500 space-y-0.5">
          <div className="flex justify-between"><span>Salary</span><span>{formatCurrency(salaryAmount)}</span></div>
          {addPaidLeave && (
            <>
              <div className="flex justify-between">
                <span>+ Paid Leave (full &amp; final, {days(finalPaidLeave.days)})</span>
                <span className="text-green-600">{formatCurrency(finalPlAmount)}</span>
              </div>
              {finalPaidLeave.months.map((m) => (
                <div key={m.period} className="flex justify-between pl-3 text-[10px] text-gray-400">
                  <span>
                    {m.label}: {days(m.days)} × {formatCurrency(m.perDaySalary)}
                  </span>
                  <span>{formatCurrency(m.amount)}</span>
                </div>
              ))}
            </>
          )}
          <div className="flex justify-between"><span>− Advance given</span><span className="text-orange-600">{formatCurrency(advanceTotal)}</span></div>
        </div>
        {isRelievingMonth && !finalPaidLeave && (
          <p className="mt-1 text-[10px] text-orange-600">Loading full &amp; final Paid Leave…</p>
        )}
        <div className="mt-2 pt-2 border-t border-amber-200 flex justify-between items-baseline">
          <span className="text-sm font-semibold text-amber-900">Total payable</span>
          <span className={`text-lg font-bold ${totalPayable < 0 ? "text-red-600" : "text-amber-900"}`}>
            {formatCurrency(totalPayable)}
          </span>
        </div>
      </div>
    </aside>
  );
};

export default MonthSummaryPanel;