// src/components/staff/SettlementStatement.jsx
//
// The Full & Final Settlement Statement preview, shared by:
//   - StaffSettlementModal  (staff self-service "View Final Settlement")
//   - the admin "Final Settlement" page (pick a left staff member -> preview)
// so both always show exactly the same statement as the PDF.
import React, { memo, useState } from "react";
import { FileText, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

import Spinner from "../common/Spinner";
import BrandLogo from "../common/BrandLogo";
import { monthBreakdownLines, monthTotals } from "../../utils/settlementBreakdown";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";
import { formatCurrency, formatNumber } from "../../utils/numberUtils";

// Two-column "Particulars / Value" row, matching the paper Full & Final
// Settlement Statement template's table layout.
const Row = ({ label, value, bold = false, highlight = false }) => (
  <div
    className={`flex items-center justify-between px-4 py-2.5 text-sm ${
      highlight
        ? "bg-amber-50 font-semibold text-gray-900"
        : "text-gray-700 odd:bg-white even:bg-gray-50/60"
    } ${bold ? "font-semibold text-gray-900" : ""}`}
  >
    <span>{label}</span>
    <span>{value}</span>
  </div>
);

// Navy header band + bordered body, matching the sample statement's
// "Particulars / Details" table styling.
const SectionTable = ({ title, children }) => (
  <div className="mb-5">
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="bg-[#1f4a82] px-4 py-2">
        <p className="text-sm font-bold text-white">{title}</p>
      </div>
      <div className="divide-y divide-gray-100">{children}</div>
    </div>
  </div>
);

// Days without trailing zeros: 1.5, 2, 0.5.
const d = (n) => String(Math.round((Number(n) || 0) * 100) / 100);
// Same, but "—" for zero so months with no leave stay easy to scan.
const dz = (n) => (Number(n) ? d(n) : "—");

const Th = ({ children, className = "" }) => (
  <th
    className={`px-2 py-1.5 text-[11px] font-semibold text-gray-500 whitespace-nowrap ${className}`}
  >
    {children}
  </th>
);
const Td = ({ children, className = "" }) => (
  <td className={`px-2 py-1.5 text-right whitespace-nowrap ${className}`}>
    {children}
  </td>
);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// PL Amount is split in two for every month:
//   GREEN = Paid Leave still LEFT in that month  (days left  × per-day) → encashed
//   RED   = Paid Leave TAKEN from that month     (days taken × per-day)
// e.g. May: earned 1.5, 0.5 taken → ₹806.45 green (1 day) + ₹403.23 red (0.5 day).
const plLeftAmount = (m) =>
  round2(m.plAmount ?? Number(m.plRemaining) * Number(m.perDaySalary));
const plTakenAmount = (m) =>
  round2(Number(m.deducted?.paid) * Number(m.perDaySalary));

const PlAmountCell = ({ m }) => {
  const left = plLeftAmount(m);
  const taken = plTakenAmount(m);
  if (!left && !taken) return <span className="text-gray-400">—</span>;
  return (
    <>
      {left > 0 && (
        <span className="block text-green-600">{formatCurrency(left)}</span>
      )}
      {taken > 0 && (
        <span className="block text-red-600">{formatCurrency(taken)}</span>
      )}
    </>
  );
};

const LeaveLedgerTable = memo(({ leaveBalance }) => {
  const months = leaveBalance.monthly || [];
  const yearly = leaveBalance.yearly || [];
  const totals = leaveBalance.totals;
  if (!months.length) {
    return (
      <p className="px-4 py-3 text-sm text-gray-500">
        No confirmation date — no leave has been earned.
      </p>
    );
  }
  const g = "border-l border-gray-200";
  const COLS = 14;
  const takenTotal = round2(months.reduce((s, m) => s + plTakenAmount(m), 0));

  const rows = [];
  months.forEach((m, i) => {
    rows.push(
      <tr
        key={m.period}
        className="text-gray-700 odd:bg-white even:bg-gray-50/60"
      >
        <td className="px-2 py-1.5 text-left whitespace-nowrap">
          {m.label}
          {m.beforeConfirmation && (
            <span className="block text-[10px] text-gray-400">
              before confirmation
            </span>
          )}
          {!m.credited && !m.beforeConfirmation && (
            <span className="block text-[10px] text-orange-600">
              not earned (&lt;20 days)
            </span>
          )}
          {Number(m.taken.unpaid) > 0 && (
            <span className="block text-[10px] text-gray-400">
              + {d(m.taken.unpaid)} unpaid
            </span>
          )}
        </td>
        <Td className={g}>{dz(m.earned.sick)}</Td>
        <Td>{dz(m.earned.casual)}</Td>
        <Td>{dz(m.earned.paid)}</Td>
        <Td className={g}>{dz(m.taken.sick)}</Td>
        <Td>{dz(m.taken.casual)}</Td>
        <Td>{dz(m.taken.paid)}</Td>
        <Td className="font-medium">{dz(m.taken.total)}</Td>
        <Td className={g}>{dz(m.deducted.sickCasual)}</Td>
        <Td>{dz(m.deducted.paid)}</Td>
        <Td className={`${g} font-medium`}>{dz(m.plRemaining)}</Td>
        <Td>{m.perDaySalary ? formatCurrency(m.perDaySalary) : "—"}</Td>
        <Td className="font-semibold">
          <PlAmountCell m={m} />
        </Td>
      </tr>,
    );
    const next = months[i + 1];
    if (!next || next.year !== m.year) {
      const yr = yearly.find((r) => r.year === m.year);
      if (yr) {
        rows.push(
          <tr
            key={`yt-${m.year}`}
            className="bg-blue-50/60 text-[11px] text-blue-900"
          >
            <td colSpan={COLS - 1} className="px-2 py-1.5 text-left">
              <b>{m.year}:</b> leave taken {d(yr.taken.total)} day(s) →{" "}
              {d(yr.fromSickCasual)} from Sick + Casual
              {yr.toPaid > 0 && <>, {d(yr.toPaid)} from Paid Leave</>}
              {yr.sickCasualLapsed > 0 && (
                <>
                  {" "}
                  · Sick + Casual unused {d(yr.sickCasualLapsed)} (lapsed, not
                  paid)
                </>
              )}
            </td>
          </tr>,
        );
      }
    }
  });

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            <Th />
            <Th className={`text-center ${g}`}>Earned</Th>
            <Th />
            <Th />
            <Th className={`text-center ${g}`}>Taken</Th>
            <Th />
            <Th />
            <Th />
            <Th className={`text-center ${g}`}>Deducted from</Th>
            <Th />
            <Th className={`text-center ${g}`}>Paid Leave left</Th>
            <Th />
            <Th />
          </tr>
          <tr className="border-b border-gray-200">
            <Th className="text-left">Month</Th>
            <Th className={`text-right ${g}`}>Sick</Th>
            <Th className="text-right">Casual</Th>
            <Th className="text-right">Paid</Th>
            <Th className={`text-right ${g}`}>Sick</Th>
            <Th className="text-right">Casual</Th>
            <Th className="text-right">Paid</Th>
            <Th className="text-right">Total</Th>
            <Th className={`text-right ${g}`}>S + C</Th>
            <Th className="text-right">Paid</Th>
            <Th className={`text-right ${g}`}>Days</Th>
            <Th className="text-right">Per day</Th>
            <Th className="text-right">PL Amount</Th>
          </tr>
        </thead>
        <tbody>
          {rows}
          {totals && (
            <tr className="bg-amber-50 font-semibold text-gray-900 border-t border-amber-200">
              <td className="px-2 py-2 text-left whitespace-nowrap">
                Grand total
              </td>
              <Td className={g}>{d(totals.earned.sick)}</Td>
              <Td>{d(totals.earned.casual)}</Td>
              <Td>{d(totals.earned.paid)}</Td>
              <Td className={g}>{d(totals.taken.sick)}</Td>
              <Td>{d(totals.taken.casual)}</Td>
              <Td>{d(totals.taken.paid)}</Td>
              <Td>{d(totals.taken.total)}</Td>
              <Td className={g}>{d(totals.deducted.sickCasual)}</Td>
              <Td>{d(totals.deducted.paid)}</Td>
              <Td className={g}>{d(totals.plRemaining)}</Td>
              <Td />
              <Td>
                {takenTotal > 0 && (
                  <span className="block text-red-600">
                    PL Used: {formatCurrency(takenTotal)}
                  </span>
                )}
                <span className="block text-green-700">
                  PL Payable: {formatCurrency(totals.encashment)}
                </span>
              </Td>
            </tr>
          )}
        </tbody>
      </table>

      <ol className="mt-3 list-decimal space-y-1 pl-5 pr-4 pb-3 text-xs leading-relaxed text-gray-600">
        <li>
          Leave taken is adjusted first against the Sick Leave and Casual Leave
          balances. These leave types are not encashable and are not paid out.
        </li>
        <li>
          Once the Sick and Casual Leave balances are exhausted, the remaining
          leave is adjusted against the Paid Leave balance, starting with the
          oldest month.
        </li>
        <li>
          Unutilised Paid Leave for a month is paid out at that month's salary
          divided by the number of days in that month.
        </li>
        <li>
          In the PL Amount column:
          <ul className="mt-1 list-[circle] space-y-1 pl-5">
            <li>
              <b className="text-green-700">Green</b> indicates the value of
              Paid Leave remaining for that month, which is payable.
            </li>
            <li>
              <b className="text-red-600">Red</b> indicates the value of Paid
              Leave utilised from that month which is not payable.
            </li>
          </ul>
        </li>
      </ol>
    </div>
  );
});

// "How this month's amount came" — opened with the View details button.
const MonthBreakdown = ({ m }) => (
  <div className="mx-4 mb-3 mt-1 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2">
    {monthBreakdownLines(m).map((l, i) => (
      <div
        key={i}
        className={`flex items-start justify-between gap-3 py-1 text-xs ${
          l.kind === "total" ? "border-t border-blue-100 font-semibold text-gray-900" : "text-gray-700"
        } ${l.kind === "muted" ? "text-gray-500" : ""}`}
      >
        <span>
          {l.sign && l.sign !== "=" ? <b className="mr-1">{l.sign === "-" ? "−" : "+"}</b> : null}
          {l.label}
          {l.sub && <span className="block text-[11px] font-normal text-gray-400">{l.sub}</span>}
        </span>
        <span
          className={`whitespace-nowrap ${
            l.sign === "-" ? "text-red-600" : ""
          } ${l.kind === "pending" ? "font-semibold text-amber-700" : ""} ${
            l.kind === "paid" && l.label === "Settled" ? "text-green-600" : ""
          }`}
        >
          {l.sign === "-" ? "− " : ""}
          {formatCurrency(l.amount)}
        </span>
      </div>
    ))}
  </div>
);

const MonthSalaryTable = memo(({ months }) => {
  const [open, setOpen] = useState({});
  const toggle = (p) => setOpen((o) => ({ ...o, [p]: !o[p] }));
  const t = monthTotals(months);
  const cols = "grid grid-cols-[1.4fr_0.8fr_1fr_1fr_1fr_auto] gap-2 items-center";
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className={`${cols} px-4 py-2 text-xs font-semibold text-gray-500 bg-gray-50`}>
          <span>Month</span>
          <span className="text-right">Unpaid leave</span>
          <span className="text-right">Salary Earned</span>
          <span className="text-right">Paid</span>
          <span className="text-right">Pending</span>
          <span className="w-24" />
        </div>
        {months.map((m) => (
          <div key={m.period} className="border-t border-gray-100">
            <div
              className={`${cols} px-4 py-2 text-sm ${
                m.pending > 0 ? "bg-amber-50 font-medium text-gray-900" : "text-gray-700"
              }`}
            >
              <span>
                {m.label}
                <span className="block text-[11px] font-normal text-gray-400">
                  {formatNumber(m.payableDays - m.unpaidDays, 1)}/{m.totalDays} days paid
                </span>
              </span>
              <span className={`text-right ${Number(m.unpaidDays) ? "text-red-600" : "text-gray-400"}`}>
                {Number(m.unpaidDays) ? `${d(m.unpaidDays)} d` : "—"}
              </span>
              <span className="text-right">{formatCurrency(m.earned)}</span>
              <span className="text-right">{formatCurrency(m.paid)}</span>
              <span className="text-right">
                {m.pending > 0 ? (
                  <span className="text-amber-700">{formatCurrency(m.pending)}</span>
                ) : (
                  <span className="text-green-600">Settled</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => toggle(m.period)}
                className="w-24 inline-flex items-center justify-end gap-1 text-xs font-semibold text-blue-700 hover:underline"
              >
                {open[m.period] ? "Hide" : "View details"}
                {open[m.period] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
            {open[m.period] && <MonthBreakdown m={m} />}
          </div>
        ))}
        <div className={`${cols} px-4 py-2 text-sm font-semibold text-gray-900 bg-gray-50 border-t border-gray-200`}>
          <span>Total</span>
          <span className="text-right text-red-600">{t.unpaidDays ? `${d(t.unpaidDays)} d` : "—"}</span>
          <span className="text-right">{formatCurrency(t.earned)}</span>
          <span className="text-right">{formatCurrency(t.paid)}</span>
          <span className="text-right text-amber-700">{formatCurrency(t.pending)}</span>
          <span className="w-24" />
        </div>
      </div>
    </div>
  );
});

// Spinner / error box / statement, depending on the load state.
export const SettlementStatementView = ({ staff, loading, error, data }) => (
  <>
    {loading && (
      <div className="py-10">
        <Spinner size="md" />
      </div>
    )}

    {!loading && error && (
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
        <p>{error}</p>
      </div>
    )}

    {!loading && !error && data && (
      <SettlementStatementBody data={data} staff={staff} />
    )}
  </>
);

// The statement itself (header, summary box, tables).
export const SettlementStatementBody = memo(({ data, staff }) => {
  const probation = !!data?.probationExit;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5 pb-4 border-b border-gray-100">
        <BrandLogo
          className="h-9 w-auto object-contain"
          badgeClassName="h-9 w-9 text-base"
          showName
        />
        <div className="flex items-center gap-2 text-gray-500">
          <FileText size={16} />
          <p className="text-xs text-right">
            Salary {data.salaryPeriod.fromLabel} to{" "}
            {formatDateToDDMMMYYYY(data.staff.relievingDate)}
          </p>
        </div>
      </div>

      {/* Same summary the app shows on its Full & Final Settlement card */}
      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        {data.pendingMonths.length ? (
          data.pendingMonths.map((m) => (
            <div key={m.period} className="flex justify-between py-1 text-sm text-gray-700">
              <span>{m.label} salary</span>
              <span className="font-semibold text-gray-900">{formatCurrency(m.pending)}</span>
            </div>
          ))
        ) : (
          <div className="flex justify-between py-1 text-sm text-gray-700">
            <span>Pending salary</span>
            <span className="font-semibold text-gray-900">{formatCurrency(0)}</span>
          </div>
        )}
        {data.pendingMonths.length > 1 && (
          <div className="flex justify-between py-1 text-sm text-gray-700">
            <span>Pending salary (total)</span>
            <span className="font-semibold text-gray-900">
              {formatCurrency(data.finalSettlement.pendingSalary)}
            </span>
          </div>
        )}
        {!probation && (
          <div className="flex justify-between py-1 text-sm text-gray-700">
            <span>Paid Leave encashment ({d(data.finalSettlement.leaveEncashmentDays)} days)</span>
            <span className="font-semibold text-gray-900">
              {formatCurrency(data.finalSettlement.leaveEncashment)}
            </span>
          </div>
        )}
        {data.finalSettlement.outstandingAdvance > 0 && (
          <div className="flex justify-between py-1 text-sm text-gray-700">
            <span>Less: outstanding advance</span>
            <span className="font-semibold text-red-600">
              − {formatCurrency(data.finalSettlement.outstandingAdvance)}
            </span>
          </div>
        )}
        <div className="mt-1.5 flex justify-between border-t border-amber-200 pt-2 text-amber-900">
          <span className="text-sm font-bold">Balance payable</span>
          <span className="text-lg font-extrabold">
            {formatCurrency(data.finalSettlement.balancePayable)}
          </span>
        </div>
      </div>

      <SectionTable title="Overview">
        <Row label="Staff Name" value={data.staff.staffName} />
        {data.staff.staffId && <Row label="Staff ID" value={data.staff.staffId} />}
        <Row
          label={probation ? "Joining Date (Probation)" : "Joining Date"}
          value={formatDateToDDMMMYYYY(data.staff.joiningDate || staff?.date) || "—"}
        />
        <Row
          label="Date of Confirmation"
          value={
            probation
              ? "— (left during probation)"
              : formatDateToDDMMMYYYY(data.staff.confirmationDate) || "—"
          }
        />
        <Row
          label={probation ? "Termination / Relieving Date" : "Relieving Date"}
          value={formatDateToDDMMMYYYY(data.staff.relievingDate)}
        />
        {!probation && (
          <>
            <Row
              label="Monthly Salary"
              value={formatCurrency(data.monthlySalary)}
            />
            <Row
              label="Per Day Salary"
              value={formatCurrency(data.perDaySalary)}
            />
          </>
        )}
      </SectionTable>

      {probation && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 mb-5">
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
          <p>
            Left during the probation period — no leave is earned before
            confirmation, so there is no Leave Summary or leave
            encashment. Unpaid leave is deducted month by month below;
            use <b>View details</b> to see how each month&apos;s amount
            was worked out.
          </p>
        </div>
      )}

      {!probation && (
      <SectionTable title="Leave Summary">
        {data.leaveBalance.policy && (
          <Row
            label="Leave earned per month (Leave Policy)"
            value={`Sick ${d(data.leaveBalance.policy.sickPerMonth)} · Casual ${d(
              data.leaveBalance.policy.casualPerMonth,
            )} · Paid ${d(data.leaveBalance.policy.paidPerMonth)}`}
          />
        )}
        {data.leaveBalance.totals && (
          <>
            <Row
              label="Sick Leave earned"
              value={`${d(data.leaveBalance.totals.earned.sick)} days`}
            />
            <Row
              label="Casual Leave earned"
              value={`${d(data.leaveBalance.totals.earned.casual)} days`}
            />
            <Row
              label="Paid Leave earned"
              value={`${d(data.leaveBalance.totals.earned.paid)} days`}
            />
            <Row
              label={`Total Leave earned (Sick ${d(data.leaveBalance.totals.earned.sick)} + Casual ${d(
                data.leaveBalance.totals.earned.casual,
              )} + Paid ${d(data.leaveBalance.totals.earned.paid)})`}
              value={`${d(
                data.leaveBalance.totals.earned.sick +
                  data.leaveBalance.totals.earned.casual +
                  data.leaveBalance.totals.earned.paid,
              )} days`}
              bold
            />
            <Row
              label="Sick Leave taken"
              value={`${d(data.leaveBalance.totals.taken.sick)} days`}
            />
            <Row
              label="Casual Leave taken"
              value={`${d(data.leaveBalance.totals.taken.casual)} days`}
            />
            <Row
              label="Paid Leave taken"
              value={`${d(data.leaveBalance.totals.taken.paid)} days`}
            />
            <Row
              label={`Total Leave taken (Sick ${d(data.leaveBalance.totals.taken.sick)} + Casual ${d(
                data.leaveBalance.totals.taken.casual,
              )} + Paid ${d(data.leaveBalance.totals.taken.paid)})`}
              value={`${d(data.leaveBalance.totals.taken.total)} days`}
              bold
            />
            <Row
              label="Deducted from Sick + Casual first"
              value={`− ${d(data.leaveBalance.totals.deducted.sickCasual)} days`}
            />
            <Row
              label="Then deducted from Paid Leave (oldest month first)"
              value={`− ${d(data.leaveBalance.totals.deducted.paid)} days`}
            />
            <Row
              label="Sick + Casual unused (lapsed — not paid)"
              value={`${d(data.leaveBalance.totals.sickCasualUnused)} days`}
            />
          </>
        )}
        <Row
          label="Paid Leave Remaining (encashed)"
          value={`${formatNumber(data.leaveBalance.paidRemaining, 2)} days`}
          highlight
        />
      </SectionTable>
      )}

      {!probation && data.leaveBalance?.monthly?.length > 0 && (
        <SectionTable
          title={`Month-wise Leave (${data.leaveBalance.monthly[0].label} – ${
            data.leaveBalance.monthly[data.leaveBalance.monthly.length - 1]
              .label
          })`}
        >
          <LeaveLedgerTable leaveBalance={data.leaveBalance} />
        </SectionTable>
      )}

      {!probation && data.leaveBalance?.relievingMonthAccrualQualified === false && (
        <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800 mb-5">
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
          <p>
            The staff member worked fewer than 20 days (holidays included)
            in their final calendar month, so that month did not earn any
            additional Paid/Sick/Casual leave.
          </p>
        </div>
      )}

      <SectionTable
        title={`Month-wise Salary (${data.salaryPeriod.fromLabel} – ${data.salaryPeriod.toLabel})`}
      >
        <MonthSalaryTable months={data.months} />
      </SectionTable>

      <SectionTable title="Final Settlement Amount">
        {data.pendingMonths.length === 0 && (
          <Row label="Pending Salary" value={formatCurrency(0)} />
        )}
        {data.pendingMonths.map((m) => (
          <Row
            key={m.period}
            label={
              m.beforeConfirmation
                ? `${m.label} salary (pending from before confirmation)`
                : `${m.label} salary (${formatNumber(m.payableDays - m.unpaidDays, 1)} of ${m.totalDays} days)`
            }
            value={formatCurrency(m.pending)}
          />
        ))}
        {!probation && (data.finalSettlement.leaveEncashmentMonths || []).map((m) => (
          <Row
            key={`pl-${m.period}`}
            label={`Paid Leave ${m.label} (${d(m.days)} days × ${formatCurrency(m.perDaySalary)})`}
            value={<span className="text-green-600">{formatCurrency(m.amount)}</span>}
          />
        ))}
        {!probation && (
          <Row
            label={`Leave encashment — Paid Leave only (${formatNumber(
              data.finalSettlement.leaveEncashmentDays,
              2,
            )} days)`}
            value={formatCurrency(data.finalSettlement.leaveEncashment)}
            bold
          />
        )}
        <Row
          label="Total Amount Payable"
          value={formatCurrency(data.finalSettlement.totalAmountPayable)}
          bold
        />
        {data.finalSettlement.outstandingAdvance > 0 && (
          <Row
            label="Less: Outstanding Advance"
            value={
              <span className="text-red-600">
                − {formatCurrency(data.finalSettlement.outstandingAdvance)}
              </span>
            }
          />
        )}
        <Row
          label="Balance Payable — Full & Final Settlement"
          value={formatCurrency(data.finalSettlement.balancePayable)}
          highlight
        />
      </SectionTable>

      <p className="text-xs text-gray-400 mt-2">
        Figures are calculated live from attendance, leave and payroll
        records as of today, and will change if any of that underlying data
        changes.
      </p>
    </div>
  );
});
