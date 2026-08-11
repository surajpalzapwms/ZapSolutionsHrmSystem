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
      inputMode="numeric"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
      className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:cursor-not-allowed"
    />
    {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
  </div>
);

const BalanceCell = ({ bucket, showCarry = false }) => {
  if (!bucket) return <td className="px-3 py-2 text-gray-400">—</td>;
  return (
    <td className="px-3 py-2 text-sm">
      <span className="font-medium text-gray-800">{bucket.remaining}</span>
    </td>
  );
};

const totalTaken = (row) =>
  (row.paid?.taken || 0) + (row.sick?.taken || 0) + (row.casual?.taken || 0);

const CategoryBreakdownRow = ({ label, bucket }) => (
  <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
    <span className="text-sm text-gray-600">{label}</span>
    <span className="text-sm">
      <span className="font-semibold text-gray-800">{bucket?.taken || 0}</span>
      <span className="text-gray-400"> taken</span>
      <span className="text-gray-400">
        {" "}
        &middot; {bucket?.remaining ?? 0} / {bucket?.allotted ?? 0} left
      </span>
    </span>
  </div>
);

const LeaveManagement = () => {
  const admin = isAdminUser();

  const [policy, setPolicy] = useState({
    paidPerYear: 0,
    sickPerYear: 0,
    casualPerYear: 0,
  });
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());

  const [showAllowancesModal, setShowAllowancesModal] = useState(false);

  // Which staff row's "Total Taken" breakdown modal is open (or null).
  const [breakdownRow, setBreakdownRow] = useState(null);

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

  const handleSave = async () => {
    setSaving(true);
    try {
      await leavePolicyService.updatePolicy({
        paidPerYear: Number(policy.paidPerYear) || 0,
        sickPerYear: Number(policy.sickPerYear) || 0,
        casualPerYear: Number(policy.casualPerYear) || 0,
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
            Requests, allowances and balances for {year}
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
              Leave Allowances
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
              <tr className="border-b border-gray-200 text-xs uppercase text-gray-500">
                <th className="px-3 py-2 text-center">Staff</th>
                <th className="px-3 py-2 text-center">Remaining Paid</th>
                <th className="px-3 py-2 text-center">Sick</th>
                <th className="px-3 py-2 text-center">Casual</th>
                <th className="px-3 py-2 text-center">Total Taken</th>
              </tr>
            </thead>
            <tbody>
              {balances.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
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
                    <div className="font-medium text-gray-800">
                      {row.staffName}
                    </div>
                    {row.email && (
                      <div className="text-xs text-gray-400">{row.email}</div>
                    )}
                  </td>
                  <BalanceCell bucket={row.paid} showCarry />
                  <BalanceCell bucket={row.sick} />
                  <BalanceCell bucket={row.casual} />
                  <td className="px-3 py-2 text-sm text-center">
                    <button
                      type="button"
                      onClick={() => setBreakdownRow(row)}
                      className="inline-flex items-center justify-center gap-1.5 text-blue-600 hover:text-blue-700"
                    >
                      <span className="font-medium text-gray-800">
                        {totalTaken(row)}
                      </span>
                      <span className="text-xs cursor-pointer">View</span>
                    </button>
                  </td>
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
                Save Allowances
              </Button>
            </>
          ) : null
        }
      >
        <div className="grid grid-cols-1 gap-4">
          <PolicyField
            label="Paid Leave"
            hint="Unused days carry forward to next year"
            value={policy.paidPerYear}
            disabled={!admin}
            onChange={(v) => setPolicy((s) => ({ ...s, paidPerYear: v }))}
          />
          <PolicyField
            label="Sick Leave"
            hint="Resets each year (no carry-forward)"
            value={policy.sickPerYear}
            disabled={!admin}
            onChange={(v) => setPolicy((s) => ({ ...s, sickPerYear: v }))}
          />
          <PolicyField
            label="Casual Leave"
            hint="Resets each year (no carry-forward)"
            value={policy.casualPerYear}
            disabled={!admin}
            onChange={(v) => setPolicy((s) => ({ ...s, casualPerYear: v }))}
          />
        </div>

        <div className="mt-4 inline-flex items-center text-xs text-gray-500">
          <ArrowRightCircle size={14} className="mr-1 text-blue-500" />
          Only paid leave carries forward; sick &amp; casual reset on 1 Jan.
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(breakdownRow)}
        onClose={() => setBreakdownRow(null)}
        title={`Leave Taken — ${breakdownRow?.staffName || ""}`}
        size="max-w-md"
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
                Total leave taken ({year})
              </span>
              <span className="text-lg font-bold text-gray-800">
                {totalTaken(breakdownRow)}
              </span>
            </div>
            <CategoryBreakdownRow
              label="Paid Leave"
              bucket={breakdownRow.paid}
            />
            <CategoryBreakdownRow
              label="Sick Leave"
              bucket={breakdownRow.sick}
            />
            <CategoryBreakdownRow
              label="Casual Leave"
              bucket={breakdownRow.casual}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default LeaveManagement;