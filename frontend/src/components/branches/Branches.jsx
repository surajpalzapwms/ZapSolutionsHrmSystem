// src/components/branches/Branches.jsx
//
// COMPANY ADMIN (or the super admin with a company open) — branches.
//   • Add the company's branches (office locations).
//   • For each branch, send a ONE-TIME invite link. Whoever opens it creates
//     THE admin login of that branch (one branch admin per branch).
//   • A branch admin sees and manages only their own branch's staff.
import React, { useCallback, useEffect, useState } from "react";
import { Building, Plus, Pencil, Trash2, Link as LinkIcon, Power, UserCog, Users } from "lucide-react";
import Modal from "../common/Modal";
import Spinner from "../common/Spinner";
import InviteLinkBox from "../common/InviteLinkBox";
import { branchService } from "../../services/branchService";
import { showToast } from "../../utils/toast";
import { confirmDialog } from "../../utils/confirmationDialog";

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]";
const errMsg = (err, fallback) => err?.response?.data?.message || fallback;
const confirmAction = async (opts) => (await confirmDialog(opts)).isConfirmed;

const EMPTY = { name: "", code: "", address: "", city: "", state: "", phone: "" };

// ── Add / edit a branch ───────────────────────────────────────────────────
function BranchModal({ branch, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(branch || {}) }));
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) return showToast("error", "Branch name is required");
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        code: form.code.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        phone: form.phone.trim(),
      };
      const res = branch?._id ? await branchService.update(branch._id, body) : await branchService.create(body);
      showToast("success", res.data?.message || "Saved");
      onSaved();
    } catch (err) {
      showToast("error", errMsg(err, "Could not save the branch"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} size="max-w-lg" title={branch?._id ? `Edit ${branch.name}` : "Add branch"}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="sm:col-span-2 block text-sm">
            <span className="block font-medium text-gray-700 mb-1">Branch name <span className="text-red-500">*</span></span>
            <input className={inputCls} value={form.name} maxLength={80} onChange={set("name")} placeholder="e.g. Mumbai" />
          </label>
          <label className="block text-sm">
            <span className="block font-medium text-gray-700 mb-1">Code</span>
            <input className={inputCls} value={form.code || ""} maxLength={20} onChange={set("code")} placeholder="MUM" />
          </label>
        </div>
        <label className="block text-sm">
          <span className="block font-medium text-gray-700 mb-1">Address</span>
          <input className={inputCls} value={form.address || ""} maxLength={300} onChange={set("address")} />
        </label>
        <div className="grid sm:grid-cols-3 gap-3">
          <input className={inputCls} placeholder="City" value={form.city || ""} onChange={set("city")} />
          <input className={inputCls} placeholder="State" value={form.state || ""} onChange={set("state")} />
          <input className={inputCls} placeholder="Phone" value={form.phone || ""} onChange={set("phone")} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm">Cancel</button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[var(--brand-primary)] disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── One-time invite link for the branch admin ─────────────────────────────
function InviteModal({ branch, onClose, onChanged }) {
  const [email, setEmail] = useState("");
  const [days, setDays] = useState(7);
  const [fresh, setFresh] = useState(null);
  const [saving, setSaving] = useState(false);

  const make = async () => {
    setSaving(true);
    try {
      const res = await branchService.createAdminInvite(branch._id, { email: email.trim() || undefined, days: Number(days) || 7 });
      setFresh({ token: res.data.token, expiresAt: res.data.data?.expiresAt, email: email.trim() });
      onChanged();
    } catch (err) {
      showToast("error", errMsg(err, "Could not create the invite link"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} size="max-w-xl" title={`Branch admin — ${branch.name}`}>
      <div className="space-y-4">
        {!fresh && (
          <>
            <p className="text-sm text-gray-600">
              Make a one-time link and send it to the person who will manage <b>{branch.name}</b>. They open it and create
              their own login. A branch has only one admin, and they see only this branch&apos;s staff.
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              <input
                type="email"
                className={`${inputCls} sm:col-span-2`}
                placeholder="Lock to an e-mail (optional)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <select className={inputCls} value={days} onChange={(e) => setDays(e.target.value)}>
                {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>Valid {d} day{d > 1 ? "s" : ""}</option>)}
              </select>
            </div>
            {branch.pendingInvite && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                An unused link already exists (expires {new Date(branch.pendingInvite.expiresAt).toLocaleDateString()}). Making a new one cancels it.
              </p>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={make}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[var(--brand-primary)] disabled:opacity-60"
            >
              {saving ? "Creating…" : "Generate invite link"}
            </button>
          </>
        )}
        {fresh && (
          <InviteLinkBox token={fresh.token} expiresAt={fresh.expiresAt} lockedEmail={fresh.email} what={`branch admin account for ${branch.name}`} />
        )}
      </div>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function Branches() {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null); // branch | {} for new
  const [inviteFor, setInviteFor] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await branchService.list();
      setRows(res.data?.data || []);
    } catch (err) {
      setRows([]);
      showToast("error", errMsg(err, "Could not load branches"));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (b) => {
    const ok = await confirmAction({
      title: b.isActive ? `Deactivate ${b.name}?` : `Activate ${b.name}?`,
      text: b.isActive ? "Its branch admin will not be able to log in until it is activated again." : "Its branch admin can log in again.",
      confirmButtonText: b.isActive ? "Deactivate" : "Activate",
    });
    if (!ok) return;
    try {
      await branchService.update(b._id, { isActive: !b.isActive });
      load();
    } catch (err) {
      showToast("error", errMsg(err, "Could not change the status"));
    }
  };

  const remove = async (b) => {
    const ok = await confirmAction({
      title: `Delete ${b.name}?`,
      text: "Only a branch without staff and without an admin can be deleted.",
      confirmButtonText: "Delete",
    });
    if (!ok) return;
    try {
      await branchService.remove(b._id);
      showToast("success", "Branch deleted");
      load();
    } catch (err) {
      showToast("error", errMsg(err, "Could not delete the branch"));
    }
  };

  const cancelLink = async (b) => {
    try {
      await branchService.cancelAdminInvite(b._id, b.pendingInvite._id);
      showToast("success", "Invite link cancelled");
      load();
    } catch (err) {
      showToast("error", errMsg(err, "Could not cancel the link"));
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Building size={22} /> Branches</h1>
          <p className="text-sm text-gray-500">Add your branches and send each one a one-time link for its admin.</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({})}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[var(--brand-primary)]"
        >
          <Plus size={16} /> Add branch
        </button>
      </div>

      {rows === null ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">
          No branches yet. Click <b>Add branch</b> to create the first one.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {rows.map((b) => (
            <div key={b._id} className={`rounded-xl border bg-white p-4 space-y-3 ${b.isActive ? "border-gray-200" : "border-gray-200 opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-800 truncate">
                    {b.name} {b.code ? <span className="text-xs font-normal text-gray-400">({b.code})</span> : null}
                  </div>
                  <div className="text-xs text-gray-500 truncate">{[b.address, b.city, b.state].filter(Boolean).join(", ") || "No address"}</div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${b.isActive ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                  {b.isActive ? "Active" : "Inactive"}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-sm text-gray-600"><Users size={14} /> {b.staffCount} staff</div>

              <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase mb-1"><UserCog size={13} /> Branch admin</div>
                {b.admin ? (
                  <div>
                    <div className="font-medium text-gray-800">{b.admin.name || b.admin.firstName}</div>
                    <div className="text-gray-500 text-xs">{b.admin.email}</div>
                  </div>
                ) : b.pendingInvite ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-amber-700 text-xs">Link sent — waiting to be used (expires {new Date(b.pendingInvite.expiresAt).toLocaleDateString()})</span>
                    <button type="button" onClick={() => cancelLink(b)} className="text-xs text-red-600 hover:underline shrink-0">Cancel</button>
                  </div>
                ) : (
                  <span className="text-gray-500 text-xs">No admin yet</span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {!b.admin && b.isActive && (
                  <button
                    type="button"
                    onClick={() => setInviteFor(b)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[var(--brand-primary)]"
                  >
                    <LinkIcon size={13} /> {b.pendingInvite ? "New invite link" : "Invite branch admin"}
                  </button>
                )}
                <button type="button" onClick={() => setEditing(b)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-xs">
                  <Pencil size={13} /> Edit
                </button>
                <button type="button" onClick={() => toggleActive(b)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-xs">
                  <Power size={13} /> {b.isActive ? "Deactivate" : "Activate"}
                </button>
                {b.staffCount === 0 && !b.admin && (
                  <button type="button" onClick={() => remove(b)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs">
                    <Trash2 size={13} /> Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <BranchModal
          branch={editing._id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {inviteFor && <InviteModal branch={inviteFor} onClose={() => setInviteFor(null)} onChanged={load} />}
    </div>
  );
}
