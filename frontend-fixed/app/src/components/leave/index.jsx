// src/components/leave/index.jsx
import React, { useEffect, useState } from "react";
import {
  Save,
  RefreshCw,
  ArrowRightCircle,
  SlidersHorizontal,
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
      // ✅ type="text" hai lekin sirf digits allow hote hain — koi bhi
      // non-digit character (letters, symbols, spaces, ".", "-") type karne
      // par turant strip ho jaata hai.
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
      <span className="text-gray-400"> / {bucket.allotted}</span>
      {/* <div className="text-xs text-gray-500">
        taken {bucket.taken}
        {showCarry && bucket.carriedForward > 0 && (
          <span className="text-blue-600"> · +{bucket.carriedForward} c/f</span>
        )}
      </div> */}
    </td>
  );
};

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

  // ✅ NAYA: Allowances ab ek Modal ke andar hain. Yeh state modal ko
  // open/close karti hai.
  const [showAllowancesModal, setShowAllowancesModal] = useState(false);

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

      // Only admins can read everyone's balances; staff read their own.
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
      setShowAllowancesModal(false); // save ke baad modal band
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
          {/* ✅ NAYA: Allowances button — click karne par Modal khulta hai */}
          {admin && (
            <Button
              variant="outline"
              onClick={() => setShowAllowancesModal(true)}
            >
              <SlidersHorizontal size={16} className="mr-2" />
              Leave Allowances
            </Button>
          )}
          <Button variant="outline" onClick={load}>
            <RefreshCw size={16} className="mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Leave Requests (admin) — ✅ NAYA: ab Leave tab par bhi dikhta hai ── */}
      {admin && <LeaveRequestsPanel onDecision={load} />}

      {/* ── Balances ───────────────────────────────────────────────────── */}
      <Card title={admin ? "Staff Leave Balances" : "My Leave Balance"}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase text-gray-500">
                <th className="px-3 py-2">Staff</th>
                <th className="px-3 py-2">Remaining Paid</th>
                <th className="px-3 py-2">Sick</th>
                <th className="px-3 py-2">Casual</th>
              </tr>
            </thead>
            <tbody>
              {balances.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
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
                  <td className="px-3 py-2">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">
        
        </p>
      </Card>

      {/* ── Allowances Modal ─────────────────────────────────────────────
          ✅ NAYA: pehle jo inline "Leave Allowances" card tha, ab woh is
          modal ke andar hai. Save Allowances button modal footer mein. */}
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
    </div>
  );
};

export default LeaveManagement;
