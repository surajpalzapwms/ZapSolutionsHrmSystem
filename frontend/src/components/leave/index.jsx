// src/components/leave/index.jsx
import React, { useEffect, useState } from "react";
import {
  Save,
  RefreshCw,
  ArrowRightCircle,
  SlidersHorizontal,
  Bell,
} from "lucide-react";
import Card from "../common/Card";
import Button from "../common/Button";
import Spinner from "../common/Spinner";
import Modal from "../common/Modal";
import LeaveRequestsPanel from "../attendance/LeaveRequestsPanel";
import { leavePolicyService } from "../../services/leavePolicyService";
import { showToast } from "../../utils/toast";
import { isAdminUser } from "../../utils/authUser";

// One numeric field in the policy editor.
const PolicyField = ({ label, hint, value, onChange, disabled }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label}
    </label>
    <input
      type="text"
      inputMode="decimal"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
      className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:cursor-not-allowed"
    />
    {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    <p className="text-xs text-blue-600 mt-0.5">
      = {Math.round(((Number(value) || 0) / 12) * 100) / 100} day(s) per
      completed month after confirmation
    </p>
  </div>
);

const fmt = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
};

// Confirmation column: the date leave starts accruing. Paid / Sick / Casual
// only accrue from the confirmation month; before it every leave day is Unpaid.
const ConfirmationCell = ({ row, year }) => {
  const d = row.accrualStartDate || row.confirmationDate;
  if (!d) {
    return (
      <td className="px-3 py-2 text-sm border-l border-gray-200">
        <span className="text-[12px] text-amber-600">Not confirmed yet</span>
      </td>
    );
  }
  const label = new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  const months = Number(row.monthsAccrued) || 0;
  return (
    <td className="px-3 py-2 text-sm border-l border-gray-200">
      <div className="font-medium text-gray-800">{label}</div>
      {months > 0 && (
        <div className="text-[11px] text-gray-400">
          {months} month{months > 1 ? "s" : ""} earned in {year}
        </div>
      )}
    </td>
  );
};

// Remaining PL: what can still be taken (with the advance / borrow / over
// limit notes kept as small lines underneath).
const RemainingPaidCell = ({ bucket }) => {
  if (!bucket) {
    return (
      <td className="px-3 py-2 text-gray-400 border-l border-gray-200">—</td>
    );
  }
  const borrowable = Number(bucket.borrowable) || 0;
  const overLimit = Number(bucket.overLimit) || 0;
  const advance = Number(bucket.advanceAllowed) || 0;
  return (
    <td className="px-3 py-2 text-sm border-l border-gray-200">
      <div className="font-semibold text-gray-800">{fmt(bucket.remaining)}</div>
      {advance > 0 && (
        <div className="text-[11px] text-amber-600">
          incl. {fmt(advance)} advance
        </div>
      )}
      {borrowable > 0 && (
        <div className="text-[11px] text-gray-400">
          {fmt(bucket.ownRemaining)} + {fmt(borrowable)} from SL/CL
        </div>
      )}
      {overLimit > 0 && (
        <div className="text-[11px] font-medium text-red-600">
          {fmt(overLimit)} over allowance
        </div>
      )}
    </td>
  );
};

// Plain number cell used for Remaining SL / CL and every Taken column.
const NumCell = ({ value, bordered = false, strong = false }) => (
  <td
    className={`px-3 py-2 text-sm ${bordered ? "border-l border-gray-200" : ""}`}
  >
    {value === undefined || value === null ? (
      <span className="text-gray-400">—</span>
    ) : (
      <span
        className={strong ? "font-semibold text-gray-800" : "text-gray-800"}
      >
        {fmt(value)}
      </span>
    )}
  </td>
);

// Paid, sick and casual `taken` are all year-to-date now (all three
// accumulate across the year — see leaveBalance.js). `takenThisYear` is
// kept as an alias on sick/casual for backwards compatibility with any
// older cached payload shape.
const paidTakenTotal = (row) =>
  row.paid?.sinceConfirmation?.taken ?? row.paid?.taken ?? 0;

const totalTaken = (row) =>
  paidTakenTotal(row) +
  (row.sick?.takenThisYear ?? row.sick?.taken ?? 0) +
  (row.casual?.takenThisYear ?? row.casual?.taken ?? 0);

const CategoryBreakdownRow = ({ label, taken, remaining, allotted, note }) => (
  <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
    <span className="text-sm text-gray-600">{label}</span>
    <span className="text-sm text-right">
      <span className="font-semibold text-gray-800">{fmt(taken)}</span>
      <span className="text-gray-400"> taken</span>
      {remaining !== undefined && (
        <span className="text-gray-400">
          {" "}
          &middot; {fmt(remaining)} / {fmt(allotted)} left
        </span>
      )}
      {note && <div className="text-[11px] text-gray-400">{note}</div>}
    </span>
  </div>
);

// Month-by-month statement: what was EARNED each month from the confirmation
// month, what was TAKEN, and the running balance. Paid carries into the next
// year; Sick + Casual restart on 1 Jan (shown as "lapsed").
const MonthlyLedger = ({ data, loading }) => {
  if (loading) {
    return <div className="py-6 text-center text-sm text-gray-400">Loading month-wise leave…</div>;
  }
  const months = data?.months || [];
  if (months.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-gray-400">
        Leave starts accruing from the confirmation date — nothing earned yet.
      </div>
    );
  }
  const th = "px-2 py-1.5 text-center font-medium";
  const td = "px-2 py-1.5 text-center";
  return (
    <div className="mt-4">
      <div className="text-sm font-semibold text-gray-700 mb-2">
        Month-wise leave (from confirmation date)
      </div>
      <div className="overflow-auto max-h-80 border border-gray-200 rounded-lg">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
            <tr>
              <th className={`${th} text-left`} rowSpan={2}>Month</th>
              <th className={`${th} border-l border-gray-200`} colSpan={3}>Earned</th>
              <th className={`${th} border-l border-gray-200`} colSpan={3}>Taken</th>
              <th className={`${th} border-l border-gray-200`} colSpan={2}>Balance</th>
            </tr>
            <tr>
              <th className={`${th} border-l border-gray-200`}>PL</th>
              <th className={th}>SL</th>
              <th className={th}>CL</th>
              <th className={`${th} border-l border-gray-200`}>PL</th>
              <th className={th}>SL</th>
              <th className={th}>CL</th>
              <th className={`${th} border-l border-gray-200`}>PL</th>
              <th className={th}>SL+CL</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <React.Fragment key={m.period}>
                {m.paidCarriedIn !== undefined && (
                  <tr className="bg-blue-50/60 text-[11px] text-gray-500">
                    <td className="px-2 py-1" colSpan={9}>
                      New year: Paid {fmt(m.paidCarriedIn)} carried forward
                      {Number(m.sickCasualLapsed) > 0
                        ? ` · Sick + Casual ${fmt(m.sickCasualLapsed)} lapsed`
                        : ""}
                    </td>
                  </tr>
                )}
                <tr className="border-t border-gray-100">
                  <td className={`${td} text-left font-medium text-gray-700`}>
                    {m.label}
                    {m.beforeConfirmation && (
                      <span className="ml-1 text-[10px] text-amber-600">(before confirmation)</span>
                    )}
                    {!m.credited && !m.beforeConfirmation && (
                      <span className="ml-1 text-[10px] text-gray-400">(not earned yet)</span>
                    )}
                  </td>
                  <td className={`${td} border-l border-gray-100`}>{fmt(m.earned?.paid)}</td>
                  <td className={td}>{fmt(m.earned?.sick)}</td>
                  <td className={td}>{fmt(m.earned?.casual)}</td>
                  <td className={`${td} border-l border-gray-100`}>{fmt(m.taken?.paid)}</td>
                  <td className={td}>{fmt(m.taken?.sick)}</td>
                  <td className={td}>{fmt(m.taken?.casual)}</td>
                  <td className={`${td} border-l border-gray-100 font-semibold`}>{fmt(m.balance?.paid)}</td>
                  <td className={`${td} font-semibold`}>{fmt(m.balance?.sickCasual)}</td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
          {data?.totals && (
            <tfoot className="bg-gray-50 font-semibold text-gray-800 sticky bottom-0">
              <tr className="border-t border-gray-200">
                <td className={`${td} text-left`}>Total</td>
                <td className={`${td} border-l border-gray-200`}>{fmt(data.totals.earned?.paid)}</td>
                <td className={td}>{fmt(data.totals.earned?.sick)}</td>
                <td className={td}>{fmt(data.totals.earned?.casual)}</td>
                <td className={`${td} border-l border-gray-200`}>{fmt(data.totals.taken?.paid)}</td>
                <td className={td}>{fmt(data.totals.taken?.sick)}</td>
                <td className={td}>{fmt(data.totals.taken?.casual)}</td>
                <td className={`${td} border-l border-gray-200`}>{fmt(data.totals.closing?.paid)}</td>
                <td className={td}>{fmt(data.totals.closing?.sickCasual)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

const LeaveManagement = () => {
  const admin = isAdminUser();

  const [policy, setPolicy] = useState({
    paidPerYear: 0,
    sickPerYear: 0,
    casualPerYear: 0,
    advancePaidLimit: 15,
  });
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());

  const [showAllowancesModal, setShowAllowancesModal] = useState(false);

  // Which staff row's "Total Taken" breakdown modal is open (or null).
  const [breakdownRow, setBreakdownRow] = useState(null);
  // Month-by-month statement for the open breakdown (own data already has it;
  // for admins it is fetched for the clicked staff member).
  const [monthly, setMonthly] = useState(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  // ✅ NEW: Leave Requests is now a bell-style notification instead of an
  // always-open panel. `showLeaveRequests` controls whether the panel is
  // visible; `pendingCount` drives the red badge on the bell and is kept
  // mounted-but-hidden (see below) so the count is correct even before the
  // admin opens it.
  const [showLeaveRequests, setShowLeaveRequests] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const policyRes = await leavePolicyService.getPolicy();
      const p = policyRes.data?.data ?? policyRes.data ?? {};
      setPolicy({
        paidPerYear: p.paidPerYear ?? 0,
        sickPerYear: p.sickPerYear ?? 0,
        casualPerYear: p.casualPerYear ?? 0,
        advancePaidLimit: p.advancePaidLimit ?? 15,
      });

      if (admin) {
        const balRes = await leavePolicyService.getAllBalances();
        const list = balRes.data?.data ?? [];
        setBalances(Array.isArray(list) ? list : []);
        if (list[0]?.year) setYear(list[0].year);
      } else {
        const meRes = await leavePolicyService.getMyBalance();
        const me = meRes.data?.data;
        setBalances(me ? [me] : []);
        if (me?.year) setYear(me.year);
      }
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to load leave data",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMonthly(null);
    if (!breakdownRow) return undefined;
    if (breakdownRow.monthly) {
      setMonthly(breakdownRow.monthly);
      return undefined;
    }
    if (!admin) return undefined;
    let cancelled = false;
    setMonthlyLoading(true);
    leavePolicyService
      .getStaffBalance(breakdownRow.staffId)
      .then((res) => {
        if (!cancelled) setMonthly(res.data?.data?.monthly || null);
      })
      .catch(() => {
        if (!cancelled) setMonthly(null);
      })
      .finally(() => {
        if (!cancelled) setMonthlyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [breakdownRow, admin]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await leavePolicyService.updatePolicy({
        paidPerYear: Number(policy.paidPerYear) || 0,
        sickPerYear: Number(policy.sickPerYear) || 0,
        casualPerYear: Number(policy.casualPerYear) || 0,
        advancePaidLimit: Number(policy.advancePaidLimit) || 0,
      });
      showToast("success", "Leave policy saved");
      setShowAllowancesModal(false);
      await load();
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to save leave policy",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Leave</h1>
          <p className="text-sm text-gray-500">
            Requests, allowances and balances for {year} — earned month by month from the confirmation date
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Leave Allowances comes first */}
          {admin && (
            <Button
              variant="outline"
              onClick={() => setShowAllowancesModal(true)}
            >
              <SlidersHorizontal size={16} className="mr-2" />
              Set leave allowances
            </Button>
          )}

          {/* ✅ NEW: Leave request notification bell — comes after
              Allowances. Badge shows the pending count; click toggles the
              panel below open/closed. */}
          {admin && (
            <button
              type="button"
              onClick={() => setShowLeaveRequests((v) => !v)}
              className="relative inline-flex items-center justify-center w-10 h-10 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors cursor-pointer"
              aria-label="Leave requests"
              title="Leave requests"
            >
              <Bell size={18} className="text-gray-600" />
              {pendingCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
                  {pendingCount > 99 ? "99+" : pendingCount}
                </span>
              )}
            </button>
          )}

          <Button variant="outline" onClick={load}>
            <RefreshCw size={16} className="mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Leave Requests (admin) ──────────────────────────────────────
          Kept mounted (hidden via `hidden` class, not unmounted) so it can
          keep fetching in the background and report the pending count for
          the bell badge above even while collapsed. Toggled open by the
          bell click. */}
      {admin && (
        <div className={showLeaveRequests ? "" : "hidden"}>
          <LeaveRequestsPanel
            onDecision={load}
            onCountChange={setPendingCount}
          />
        </div>
      )}

      {/* ── Balances ───────────────────────────────────────────────────── */}
      <Card title={admin ? "Staff Leave Balances" : "My Leave Balance"}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-center">
            <thead>
              <tr className="text-xs uppercase text-gray-500">
                <th
                  rowSpan={2}
                  className="px-3 py-2 text-center align-middle border-b border-gray-200"
                >
                  Staff
                </th>
                <th
                  rowSpan={2}
                  className="px-3 py-2 text-center align-middle border-b border-l border-gray-200"
                >
                  Confirmation
                </th>
                <th
                  colSpan={3}
                  className="px-3 py-2 text-center border-l border-gray-200"
                >
                  Remaining
                </th>
                <th
                  colSpan={3}
                  className="px-3 py-2 text-center border-l border-gray-200"
                >
                  Taken
                </th>
              </tr>
              <tr className="border-b border-gray-200 text-xs uppercase text-gray-500">
                <th className="px-3 py-2 text-center border-l border-gray-200">
                  PL
                </th>
                <th className="px-3 py-2 text-center border-l border-gray-200">
                  SL
                </th>
                <th className="px-3 py-2 text-center border-l border-gray-200">
                  CL
                </th>
                <th className="px-3 py-2 text-center border-l border-gray-200">
                  PL
                </th>
                <th className="px-3 py-2 text-center border-l border-gray-200">
                  SL
                </th>
                <th className="px-3 py-2 text-center border-l border-gray-200">
                  CL
                </th>
              </tr>
            </thead>
            <tbody>
              {balances.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-6 text-center text-gray-400"
                  >
                    No records to show.
                  </td>
                </tr>
              )}
              {balances.map((row) => (
                <tr
                  key={row.staffId}
                  className="border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="px-3 py-2 text-center">
                    {/* Click the name for the full leave-taken breakdown. */}
                    <button
                      type="button"
                      onClick={() => setBreakdownRow(row)}
                      className="font-medium text-gray-800 hover:text-blue-600 hover:underline"
                      title="View leave breakdown"
                    >
                      {row.staffName}
                    </button>
                    {row.email && (
                      <div className="text-xs text-gray-400">{row.email}</div>
                    )}
                  </td>
                  <ConfirmationCell row={row} year={year} />
                  <RemainingPaidCell bucket={row.paid} />
                  <NumCell value={row.sick?.remaining} bordered strong />
                  <NumCell value={row.casual?.remaining} bordered strong />
                  <NumCell value={paidTakenTotal(row)} bordered />
                  <NumCell
                    value={row.sick?.takenThisYear ?? row.sick?.taken}
                    bordered
                  />
                  <NumCell
                    value={row.casual?.takenThisYear ?? row.casual?.taken}
                    bordered
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Allowances Modal ─────────────────────────────────────────── */}
      <Modal
        isOpen={showAllowancesModal}
        onClose={() => setShowAllowancesModal(false)}
        title="Leave Allowances (per year)"
        size="max-w-lg"
        actions={
          admin ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setShowAllowancesModal(false)}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSave} loading={saving}>
                <Save size={16} className="mr-2" />
                Save
              </Button>
            </>
          ) : null
        }
      >
        <div className="grid grid-cols-1 gap-4">
          <PolicyField
            label="Paid Leave"
            hint="e.g. 16.5. Unused days carry forward. A half day can round up to a whole day (16.5 → 17) using 0.5 from Sick + Casual."
            value={policy.paidPerYear}
            disabled={!admin}
            onChange={(v) => setPolicy((s) => ({ ...s, paidPerYear: v }))}
          />
          <PolicyField
            label="Sick Leave"
            hint="e.g. 3.5. Shares one pool with Casual Leave. Resets every year."
            value={policy.sickPerYear}
            disabled={!admin}
            onChange={(v) => setPolicy((s) => ({ ...s, sickPerYear: v }))}
          />
          <PolicyField
            label="Casual Leave"
            hint="e.g. 3.5. Shares one pool with Sick Leave. Resets every year."
            value={policy.casualPerYear}
            disabled={!admin}
            onChange={(v) => setPolicy((s) => ({ ...s, casualPerYear: v }))}
          />
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(breakdownRow)}
        onClose={() => setBreakdownRow(null)}
        title={`Leave — ${breakdownRow?.staffName || ""}`}
        size="max-w-3xl"
        actions={
          <Button variant="secondary" onClick={() => setBreakdownRow(null)}>
            Close
          </Button>
        }
      >
        {breakdownRow && (
          <div>
            <div className="flex items-center justify-between pb-3 mb-2 border-b border-gray-200">
              <span className="text-sm font-medium text-gray-700">
                Total leave taken (paid since confirmation + {year} sick/casual)
              </span>
              <span className="text-lg font-bold text-gray-800">
                {fmt(totalTaken(breakdownRow))}
              </span>
            </div>
            <CategoryBreakdownRow
              label="Paid Leave (since confirmation)"
              taken={paidTakenTotal(breakdownRow)}
              remaining={breakdownRow.paid?.remaining}
              allotted={
                breakdownRow.paid?.sinceConfirmation?.earned ??
                breakdownRow.paid?.allotted
              }
              note={
                Number(breakdownRow.paid?.borrowable) > 0
                  ? `includes ${fmt(breakdownRow.paid.borrowable)} that can be borrowed from Sick + Casual`
                  : Number(breakdownRow.paid?.borrowed) > 0
                    ? `${fmt(breakdownRow.paid.borrowed)} borrowed from Sick + Casual`
                    : null
              }
            />
            <CategoryBreakdownRow
              label="Sick + Casual (shared)"
              taken={breakdownRow.sickCasualPool?.taken}
              remaining={breakdownRow.sickCasualPool?.remaining}
              allotted={breakdownRow.sickCasualPool?.allotted}
            />
            <CategoryBreakdownRow
              label={`Sick Leave (earned ${fmt(breakdownRow.sick?.accruedThisYear)} so far in ${year})`}
              taken={breakdownRow.sick?.taken}
              note={`can take up to ${fmt(breakdownRow.sick?.remaining)} more`}
            />
            <CategoryBreakdownRow
              label={`Casual Leave (earned ${fmt(breakdownRow.casual?.accruedThisYear)} so far in ${year})`}
              taken={breakdownRow.casual?.taken}
              note={`can take up to ${fmt(breakdownRow.casual?.remaining)} more`}
            />
            <MonthlyLedger data={monthly} loading={monthlyLoading} />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default LeaveManagement;
