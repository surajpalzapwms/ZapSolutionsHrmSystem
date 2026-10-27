// src/components/staff/StaffReferralSection.jsx
// "Referral organisation" box inside Staff Details.
//   • Super admin: set / change / remove the organisation (e.g. Navkar) and
//     the % of the FIRST month salary that goes to it as commission.
//   • Admin: read-only.
// The figure shown underneath comes from the same salary calculation the
// payroll and attendance calendar use, e.g.
//   20,000 basic, Navkar 25%, 2 unpaid days in a 30-day month
//   -> commission ₹5,000.00, leave ₹1,333.33, salary ₹13,666.67
import React, { useCallback, useEffect, useState } from "react";
import { Building2, Pencil, Trash2 } from "lucide-react";
import Button from "../common/Button";
import { staffService } from "../../services/staffService";
import { payrollService } from "../../services/payrollService";
import { isSuperAdminUser } from "../../utils/authUser";
import { showToast } from "../../utils/toast";
import { formatCurrency } from "../../utils/numberUtils";

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const istPeriodOf = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};
const periodLabel = (p) => {
  if (!p) return "—";
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

const StaffReferralSection = ({ staff, onSaved }) => {
  const canEdit = isSuperAdminUser();
  const defaultPeriod = istPeriodOf(staff?.date);
  const [referral, setReferral] = useState(staff?.referral || null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    organizationName: "",
    commissionPercent: "",
    commissionPeriod: "",
    remarks: "",
  });
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    setReferral(staff?.referral || null);
    setEditing(false);
  }, [staff?._id, staff?.referral]);

  const active =
    !!referral?.organizationName && Number(referral?.commissionPercent) > 0;
  // Commission is taken from the FIRST (joining) month only.
  const period = active ? defaultPeriod : "";

  // Live figure for the commission month.
  const loadPreview = useCallback(() => {
    if (!staff?._id || !period) {
      setPreview(null);
      return;
    }
    payrollService
      .calculate(staff._id, period)
      .then((r) => setPreview(r.data?.data || r.data || null))
      .catch(() => setPreview(null));
  }, [staff?._id, period]);
  useEffect(loadPreview, [loadPreview]);

  const startEdit = () => {
    setForm({
      organizationName: referral?.organizationName || "",
      commissionPercent: referral?.commissionPercent ? String(referral.commissionPercent) : "",
      commissionPeriod: "",
      remarks: referral?.remarks || "",
    });
    setEditing(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const pct = Number(form.commissionPercent);
    if (!form.organizationName.trim()) return showToast("error", "Enter the organisation name");
    if (!(pct > 0 && pct <= 100)) return showToast("error", "Commission % must be between 0 and 100");
    setSaving(true);
    try {
      const res = await staffService.setReferral(staff._id, {
        organizationName: form.organizationName.trim(),
        commissionPercent: Math.round(pct * 100) / 100,
        // Same as the joining month -> stored empty, so it follows the
        // joining date if that is corrected later.
        commissionPeriod: "", // first (joining) month only
        remarks: form.remarks.trim(),
      });
      const next = {
        organizationName: form.organizationName.trim(),
        commissionPercent: Math.round(pct * 100) / 100,
        commissionPeriod: "",
        remarks: form.remarks.trim(),
      };
      setReferral(next);
      setEditing(false);
      showToast("success", res.data?.message || "Referral saved");
      onSaved?.(next);
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message ||
          err.response?.data?.errors?.[0]?.msg ||
          "Could not save referral",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm?.("Remove the referral organisation and its commission?")) return;
    setSaving(true);
    try {
      await staffService.clearReferral(staff._id);
      setReferral(null);
      setPreview(null);
      showToast("success", "Referral removed");
      onSaved?.(null);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Could not remove referral");
    } finally {
      setSaving(false);
    }
  };

  if (!active && !canEdit) return null;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
        Referral Organisation
      </p>

      {editing ? (
        <form onSubmit={save} className="space-y-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 text-xs font-medium text-gray-600">
              Organisation name
              <input
                type="text"
                value={form.organizationName}
                onChange={(e) => setForm((f) => ({ ...f, organizationName: e.target.value }))}
                placeholder="e.g. Navkar"
                maxLength={120}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-gray-600">
              Commission %
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                value={form.commissionPercent}
                onChange={(e) => setForm((f) => ({ ...f, commissionPercent: e.target.value }))}
                placeholder="25"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <div className="text-xs font-medium text-gray-600">
              Taken from
              <div className="mt-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800">
                First month only — {periodLabel(defaultPeriod) || "joining month"}
              </div>
              <span className="block text-[10px] text-gray-400">
                Never taken from any other month
              </span>
            </div>
            <label className="col-span-2 text-xs font-medium text-gray-600">
              Remarks (optional)
              <input
                type="text"
                value={form.remarks}
                onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                maxLength={300}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" type="button" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
          <div className="flex items-start gap-3 min-w-0">
            <Building2 size={18} className="mt-0.5 flex-shrink-0 text-purple-600" />
            {active ? (
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-gray-800">{referral.organizationName}</p>
                <p className="text-xs text-gray-500">
                  {Number(referral.commissionPercent).toFixed(2)}% of the first month salary ·{" "}
                  {periodLabel(period)}
                </p>
                {preview && (
                  <div className="mt-1.5 text-xs text-gray-600 space-y-0.5">
                    <div>
                      Basic {formatCurrency(preview.basicSalary)} × {Number(referral.commissionPercent).toFixed(2)}% ={" "}
                      <span className="font-semibold text-purple-700">
                        {formatCurrency(preview.referralCommissionFull ?? preview.referralCommission)}
                      </span>
                    </div>
                    {Number(preview.leaveDeduction) > 0 && (
                      <div>
                        Leave deduction ({preview.unpaidLeaveDays} day{preview.unpaidLeaveDays === 1 ? "" : "s"} ×{" "}
                        {formatCurrency(preview.perDaySalary)}): {formatCurrency(preview.leaveDeduction)}
                      </div>
                    )}
                    {Number(preview.lateDeduction) > 0 && (
                      <div>Late coming: {formatCurrency(preview.lateDeduction)}</div>
                    )}
                    <div className="font-semibold text-gray-800">
                      Salary payable for {periodLabel(period)}: {formatCurrency(preview.netSalary)}
                    </div>
                    {preview.referralCommissionCapped && (
                      <div className="text-orange-600">
                        Commission limited to {formatCurrency(preview.referralCommission)} (salary earned so far)
                      </div>
                    )}
                  </div>
                )}
                {referral.remarks && <p className="mt-1 text-xs text-gray-400">{referral.remarks}</p>}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No referral organisation</p>
            )}
          </div>
          {canEdit && (
            <div className="flex flex-shrink-0 gap-1.5">
              <Button size="sm" variant="outline" onClick={startEdit} disabled={saving}>
                <Pencil size={13} className="mr-1 inline" />
                {active ? "Edit" : "Set"}
              </Button>
              {active && (
                <Button size="sm" variant="outline" onClick={remove} disabled={saving} title="Remove referral">
                  <Trash2 size={13} />
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StaffReferralSection;
