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
import { Wallet, CalendarCheck, HandCoins, Calculator, Building2 } from "lucide-react";
import { formatCurrency } from "../../utils/numberUtils";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";
import { referralLabel } from "./salaryBreakdown";

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const istPeriodOf = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};
const periodLabel = (p) => {
  if (!p) return "";
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

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
  // Referral organisation (set by the super admin in Staff Details).
  referral = null,
  joinDate = null,
  period = null, // "YYYY-MM" of this panel's month
  adminView = false,
}) => {
  const hasReferral =
    !!referral?.organizationName && Number(referral?.commissionPercent) > 0;
  const referralPeriod = hasReferral
    ? istPeriodOf(joinDate) // always the first (joining) month only
    : "";
  const referralThisMonth = hasReferral && period && referralPeriod === period;
  const takenThisMonth = Number(salary?.referralCommission) > 0;
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
          <>
            {/* Full breakdown — every step shown, 2 decimal places */}
            {Number(salary.basicSalary) > 0 && (
              <Line label="Basic salary (month)" value={formatCurrency(salary.basicSalary)} />
            )}
            {Number(salary.perDaySalary) > 0 && (
              <Line
                label="Per day salary"
                sub={salary.totalDays ? `${formatCurrency(salary.basicSalary)} ÷ ${salary.totalDays} days` : undefined}
                value={formatCurrency(salary.perDaySalary)}
                className="text-gray-600"
              />
            )}
            {salary.payableDays != null && salary.totalDays != null && (
              <Line
                label="Days paid"
                sub={
                  salary.payableNote && salary.payableDays < salary.totalDays
                    ? salary.payableNote
                    : undefined
                }
                value={`${round2(salary.payableDays - (Number(salary.unpaidDays) || 0))}/${salary.totalDays}`}
                className="text-gray-600"
              />
            )}
            {Number(salary.leaveDeduction) > 0 && (
              <Line
                label={`− Leave deduction`}
                sub={
                  salary.unpaidDays
                    ? `${days(salary.unpaidDays)} unpaid × ${formatCurrency(salary.perDaySalary)}`
                    : undefined
                }
                value={formatCurrency(salary.leaveDeduction)}
                className="text-red-600"
              />
            )}
            {Number(salary.lateDeduction) > 0 && (
              <Line
                label="− Late coming"
                value={formatCurrency(salary.lateDeduction)}
                className="text-red-600"
              />
            )}
            {Number(salary.referralCommission) > 0 && (
              <Line
                label={`− ${referralLabel(salary)}`}
                sub={
                  salary.referralCommissionCapped
                    ? "First month · limited to the salary earned"
                    : `First month · ${round2(salary.referralPercent)}% of ${formatCurrency(salary.basicSalary)}`
                }
                value={formatCurrency(salary.referralCommission)}
                className="text-purple-700"
              />
            )}
            {Number(salary.advanceDeduction) > 0 && (
              <Line
                label="− Advance recovered"
                value={formatCurrency(salary.advanceDeduction)}
                className="text-orange-600"
              />
            )}
            <div className="mt-1 pt-1 border-t border-gray-100">
              <Line
                label={salary.isEstimate ? "= Salary (estimate)" : `= Salary (${salary.status || "saved"})`}
                value={formatCurrency(salaryAmount)}
                className="text-blue-800"
              />
            </div>
          </>
        )}
        {salary && salary.lateDeductionEnabled === false && (
          <p className="text-[10px] text-gray-400">Late coming not deducted this month</p>
        )}
      </Section>

      {/* Referral organisation — always shown, so it is clear which
          month's salary the commission comes out of. */}
      <Section icon={Building2} title="Referral organisation">
        {hasReferral ? (
          referralThisMonth || takenThisMonth ? (
            // Joining (first) month only — show the commission amount.
            <>
              <Line
                label={referral.organizationName}
                sub={`${round2(referral.commissionPercent)}% of first month salary · ${
                  periodLabel(referralPeriod) || "joining month"
                }`}
                value={
                  takenThisMonth
                    ? formatCurrency(salary.referralCommission)
                    : salary?.basicSalary
                    ? formatCurrency(round2((Number(salary.basicSalary) * Number(referral.commissionPercent)) / 100))
                    : `${round2(referral.commissionPercent)}%`
                }
                className="text-purple-700"
              />
              <p className="text-[11px] text-gray-500">
                {takenThisMonth
                  ? "Taken from this month's salary (shown above)."
                  : "Commission month — no salary earned yet to take it from."}
              </p>
            </>
          ) : (
            // Any other month: no commission, no amount shown.
            <p className="text-xs text-gray-500 py-1">
              Referred by {referral.organizationName}. Commission was taken
              only from the {periodLabel(referralPeriod) || "first month"} salary
              — nothing is deducted this month.
            </p>
          )
        ) : (
          <p className="text-xs text-gray-400 py-1">
            No referral organisation.
            {adminView && " The super admin can set one in Staff → View details → Referral Organisation."}
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