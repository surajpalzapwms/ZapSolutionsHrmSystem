// src/components/companies/Companies.jsx
//
// SUPER ADMIN — White label companies.
//   • Add a company with just a name + country (India, Saudi Arabia, Qatar …)
//     and, optionally, a one-time invite link for its admin. The country fills in currency,
//     time zone, weekly off days and the registration numbers to collect.
//   • Open a company: from then on the whole website works on that company
//     only (X-Company-Id). Its logo, address, CR / VAT / GSTIN etc. are then
//     completed on the Company Profile page — by you or the company's admin.
//   • Edit: link name, active / inactive, tabs, staff limit, own domain.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Users,
  ShieldCheck,
  Search,
  Link as LinkIcon,
  Copy,
  ArrowRight,
  Power,
  ChevronDown,
  LogOut,
  Wifi,
} from "lucide-react";
import "flag-icons/css/flag-icons.min.css";
import Modal from "../common/Modal";
import Spinner from "../common/Spinner";
import InviteLinkBox from "../common/InviteLinkBox";
import { companyService } from "../../services/companyService";
import { COMPANY_TABS, ALWAYS_ON_COMPANY_TABS } from "../../utils/permissionTabs";
import {
  getSelectedCompany,
  setSelectedCompany,
  clearSelectedCompany,
  loginLinkFor,
} from "../../utils/company";
import { loadBrandFromServer, resetBrand } from "../../utils/brand";
import { mergeCountries, countryNameOf } from "../../utils/countries";
import { showToast } from "../../utils/toast";
import { confirmDialog } from "../../utils/confirmationDialog";

const confirmAction = async (opts) => (await confirmDialog(opts)).isConfirmed;

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ALWAYS_ON = ALWAYS_ON_COMPANY_TABS; // Dashboard, Staff, Company Profile
const TOP_TABS = COMPANY_TABS.map((t) => ({ key: t.key, label: t.label }));

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]";

const slugify = (v) =>
  String(v || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const errMsg = (err, fallback) => err?.response?.data?.message || fallback;

const Flag = ({ code, className = "" }) =>
  code && code !== "OTHER" ? (
    <span className={`fi fi-${code.toLowerCase()} rounded-sm ${className}`} aria-hidden="true" />
  ) : (
    <span className={`inline-block h-3 w-4 rounded-sm bg-gray-300 ${className}`} aria-hidden="true" />
  );

const Field = ({ label, hint, children, required }) => (
  <label className="block">
    <span className="block text-sm font-medium text-gray-700 mb-1">
      {label}
      {required && <span className="text-red-500"> *</span>}
    </span>
    {children}
    {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
  </label>
);

const CompanyBadge = ({ company, size = "h-12 w-12 text-lg" }) =>
  company.logoUrl ? (
    <img
      src={company.logoUrl}
      alt=""
      className="h-12 w-16 object-contain rounded-lg bg-white border border-gray-100 p-1"
    />
  ) : (
    <span
      className={`inline-flex items-center justify-center rounded-xl font-bold text-white shrink-0 ${size}`}
      style={{ backgroundColor: company.primaryColor || "#2563eb" }}
    >
      {(company.shortName || company.name || "?").trim().charAt(0).toUpperCase()}
    </span>
  );

// ── Tabs picker (top-level tabs only) ─────────────────────────────────────
// Every tab of the website (Dashboard … Admin Permissions) plus the
// "Internship & Probation" switch. An unticked tab disappears from that
// company's website. `probation` / `onProbation`: false = staff are confirmed
// from the joining date (Confirmation Date = Joining Date).
function TabsPicker({ value, onChange, probation, onProbation }) {
  const all = value === null;
  const on = new Set(all ? TOP_TABS.map((t) => t.key) : value);
  const toggle = (key) => {
    const next = new Set(on);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    ALWAYS_ON.forEach((k) => next.add(k));
    const list = TOP_TABS.map((t) => t.key).filter((k) => next.has(k));
    onChange(list.length === TOP_TABS.length ? null : list);
  };
  const count = TOP_TABS.filter((t) => on.has(t.key)).length + (probation ? 1 : 0);
  return (
    <div>
    <div className="mb-2 text-xs text-gray-500">
      {count} of {TOP_TABS.length + 1} switched on · unticked tabs are hidden from this company&apos;s website
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {TOP_TABS.map((t) => {
        const locked = ALWAYS_ON.includes(t.key);
        return (
          <label
            key={t.key}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              on.has(t.key) ? "border-[var(--brand-primary)] bg-blue-50/40" : "border-gray-200"
            } ${locked ? "opacity-70" : "cursor-pointer"}`}
          >
            <input type="checkbox" checked={on.has(t.key)} disabled={locked} onChange={() => toggle(t.key)} />
            {t.label}
          </label>
        );
      })}
      <label
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${
          probation ? "border-[var(--brand-primary)] bg-blue-50/40" : "border-gray-200"
        }`}
        title="Unticked: no internship / probation — staff are confirmed on their joining date"
      >
        <input type="checkbox" checked={probation} onChange={(e) => onProbation(e.target.checked)} />
        Internship &amp; Probation
      </label>
    </div>
    {!probation && (
      <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
        No internship or probation: every staff member is confirmed on the joining date
        (Confirmation Date = Joining Date). Staff now in Internship / Probation are confirmed when you save.
      </p>
    )}
    </div>
  );
}

// ── Add / edit company ────────────────────────────────────────────────────
function CompanyModal({ company, countries, onClose, onSaved }) {
  const editing = Boolean(company?._id);
  const isOwner = Boolean(company?.isOwner);
  const lockDetails = editing && !isOwner; // client company: its admin edits the details
  const [form, setForm] = useState(() => ({
    name: company?.name || "",
    slug: company?.slug || "",
    country: company?.country || "IN",
    isActive: company?.isActive !== false,
    enabledTabs: company ? company.enabledTabs ?? null : null,
    probationEnabled: company ? company.probationEnabled !== false : true,
    maxStaff: company?.maxStaff ?? "",
    customDomain: company?.customDomain || "",
    officeNetworksText: (company?.officeNetworks || []).join("\n"),
  }));
  const [slugTouched, setSlugTouched] = useState(editing);
  // New company: make the one-time admin invite link right away.
  const [withInvite, setWithInvite] = useState(!editing);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const preset = countries.find((c) => c.code === form.country);

  const onName = (v) => {
    setForm((f) => ({ ...f, name: v, slug: slugTouched ? f.slug : slugify(v) }));
  };

  const detectNetwork = async () => {
    setDetecting(true);
    try {
      const res = await companyService.myNetwork();
      const add = res.data?.entries || [];
      setForm((f) => {
        const have = f.officeNetworksText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
        return { ...f, officeNetworksText: [...new Set([...have, ...add])].join("\n") };
      });
    } catch (err) {
      showToast("error", errMsg(err, "Could not detect this network"));
    } finally {
      setDetecting(false);
    }
  };

  const save = async () => {
    if (!form.name.trim()) return showToast("error", "Company name is required");
    const body = {
      slug: form.slug || slugify(form.name),
      enabledTabs: form.enabledTabs,
      probationEnabled: form.probationEnabled,
      maxStaff: form.maxStaff === "" ? null : Number(form.maxStaff),
      customDomain: form.customDomain.trim(),
    };
    // Name / country / Wi-Fi: set when the company is created, and editable
    // here only for the owner company. A client company's admin owns its details.
    if (!editing || isOwner) {
      body.name = form.name.trim();
      body.country = form.country;
    }
    if (editing && isOwner) body.officeNetworks = form.officeNetworksText;
    if (editing) body.isActive = form.isActive;
    if (!editing && withInvite) body.inviteAdmin = true;
    setSaving(true);
    try {
      const res = editing ? await companyService.update(company._id, body) : await companyService.create(body);
      showToast("success", res.data?.message || "Saved");
      onSaved(res.data?.data, !editing, res.data?.invite || null);
    } catch (err) {
      showToast("error", errMsg(err, "Could not save the company"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="max-w-2xl"
      title={editing ? `Edit ${company.name}` : "Add company"}
      actions={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 bg-[var(--brand-primary)]"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Create company"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Company name" required>
            <input className={`${inputCls} disabled:bg-gray-100 disabled:text-gray-500`} value={form.name} maxLength={80} disabled={lockDetails} onChange={(e) => onName(e.target.value)} autoFocus={!lockDetails} />
          </Field>
          <Field label="Country" required hint={preset ? `${preset.currencyCode} · ${preset.timeZone} · weekly off ${preset.weeklyOffDays.map((d) => DAY[d]).join(" + ")}` : ""}>
            <div className="relative">
              <select className={`${inputCls} pl-10 appearance-none disabled:bg-gray-100 disabled:text-gray-500`} value={form.country} disabled={lockDetails} onChange={(e) => set("country")(e.target.value)}>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="absolute left-3 top-1/2 -translate-y-1/2 flex pointer-events-none">
                <Flag code={form.country} />
              </span>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </Field>
          <Field label="Link name" hint={`Login page: ${window.location.origin}/login?company=${form.slug || "…"}`}>
            <input
              className={inputCls}
              value={form.slug}
              maxLength={40}
              onChange={(e) => {
                setSlugTouched(true);
                set("slug")(slugify(e.target.value));
              }}
            />
          </Field>
          {editing && (
            <Field label="Status">
              <label className="flex items-center gap-2 h-[38px] text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive")(e.target.checked)} />
                Active — staff and admins can log in
              </label>
            </Field>
          )}
        </div>

        {!editing && (
          <label className="flex items-start gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm cursor-pointer">
            <input type="checkbox" className="mt-1" checked={withInvite} onChange={(e) => setWithInvite(e.target.checked)} />
            <span>
              <span className="font-medium">Make a one-time admin invite link</span>
              <span className="block text-xs text-gray-500 mt-0.5">
                You get a link to send to anyone. They open it and create their own admin login (their own e-mail and
                password). A company can have only one admin.
              </span>
            </span>
          </label>
        )}

        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
          {isOwner
            ? "This is your own company — logo, address, registration numbers, signatory and stamp are on its Company Profile page."
            : "You only create the company here. Its logo, address, registration numbers, staff and everything else are added by the company's own admin, using the invite link."}
        </p>

        <button type="button" onClick={() => setAdvanced((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-gray-700">
          <ChevronDown size={16} className={`transition-transform ${advanced ? "rotate-180" : ""}`} />
          {isOwner ? "Plan, tabs, domain & office Wi-Fi" : "Plan, tabs & domain"}
        </button>
        {advanced && (
          <div className="space-y-4">
            <Field label="Tabs this company has">
              <TabsPicker
                value={form.enabledTabs}
                onChange={set("enabledTabs")}
                probation={form.probationEnabled}
                onProbation={set("probationEnabled")}
              />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Staff limit" hint="Empty = unlimited">
                <input type="number" min={1} className={inputCls} value={form.maxStaff} onChange={(e) => set("maxStaff")(e.target.value)} />
              </Field>
              <Field label="Own login domain" hint="e.g. hr.company.com — point it at this website first">
                <input className={inputCls} value={form.customDomain} onChange={(e) => set("customDomain")(e.target.value)} />
              </Field>
            </div>
            {isOwner && (
            <Field label="Office Wi-Fi addresses" hint="Public IP or range per line — used for automatic attendance">
              <textarea rows={3} className={`${inputCls} font-mono`} value={form.officeNetworksText} onChange={(e) => set("officeNetworksText")(e.target.value)} />
              <button type="button" onClick={detectNetwork} disabled={detecting} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-primary)]">
                <Wifi size={14} /> {detecting ? "Detecting…" : "Use this computer's network"}
              </button>
            </Field>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Admin of a company: one-time invite link ──────────────────────────────
// A company has exactly ONE admin. The super admin never types that person's
// password: they make a one-time link, the person opens it and creates their
// own login. A new link cancels the older unused one.
const STATUS_LABEL = {
  pending: ["Waiting to be used", "text-amber-700 bg-amber-50"],
  used: ["Used", "text-emerald-700 bg-emerald-50"],
  expired: ["Expired", "text-gray-600 bg-gray-100"],
  revoked: ["Cancelled", "text-gray-600 bg-gray-100"],
};

function AdminsModal({ company, onClose, onChanged }) {
  const [admins, setAdmins] = useState(null);
  const [invites, setInvites] = useState([]);
  const [fresh, setFresh] = useState(null); // { token, expiresAt, email } shown once
  const [email, setEmail] = useState("");
  const [days, setDays] = useState(7);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    companyService.admins(company._id).then((r) => setAdmins(r.data?.data || [])).catch(() => setAdmins([]));
    companyService.adminInvites(company._id).then((r) => setInvites(r.data?.data || [])).catch(() => setInvites([]));
  }, [company._id]);
  useEffect(load, [load]);

  const companyAdmin = (admins || []).find((a) => a.scope === "company");
  const branchAdmins = (admins || []).filter((a) => a.scope === "branch");

  const makeLink = async () => {
    setSaving(true);
    try {
      const res = await companyService.createAdminInvite(company._id, { email: email.trim() || undefined, days: Number(days) || 7 });
      setFresh({ token: res.data.token, expiresAt: res.data.data?.expiresAt, email: email.trim() });
      setEmail("");
      load();
      onChanged();
    } catch (err) {
      showToast("error", errMsg(err, "Could not create the invite link"));
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (inv) => {
    try {
      await companyService.cancelAdminInvite(company._id, inv._id);
      showToast("success", "Invite link cancelled");
      setFresh(null);
      load();
    } catch (err) {
      showToast("error", errMsg(err, "Could not cancel the link"));
    }
  };

  return (
    <Modal isOpen onClose={onClose} size="max-w-xl" title={`Admin — ${company.name}`}>
      <div className="space-y-5">
        {admins === null ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : companyAdmin ? (
          <div className="rounded-lg border border-gray-200 px-4 py-3 text-sm flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-800">{companyAdmin.name || companyAdmin.firstName}</div>
              <div className="text-gray-500">{companyAdmin.email}</div>
            </div>
            <span className="text-xs text-gray-400">
              {companyAdmin.lastLogin ? `Last login ${new Date(companyAdmin.lastLogin).toLocaleDateString()}` : "Never logged in"}
            </span>
          </div>
        ) : (
          <p className="text-sm text-gray-500">This company has no admin yet.</p>
        )}

        {admins !== null && !companyAdmin && (
          <div className="rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-700">Send an invite link</div>
            <p className="text-xs text-gray-500">
              Whoever opens the link creates the company&apos;s admin login themselves. It works once; a new link cancels the older one.
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              <input
                className={`${inputCls} sm:col-span-2`}
                type="email"
                placeholder="Lock to an e-mail (optional)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <select className={inputCls} value={days} onChange={(e) => setDays(e.target.value)}>
                {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>Valid {d} day{d > 1 ? "s" : ""}</option>)}
              </select>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={makeLink}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[var(--brand-primary)] disabled:opacity-60"
            >
              {saving ? "Creating…" : "Generate invite link"}
            </button>
          </div>
        )}

        {fresh && <InviteLinkBox token={fresh.token} expiresAt={fresh.expiresAt} lockedEmail={fresh.email} what={`admin account for ${company.name}`} />}

        {invites.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Recent links</div>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {invites.map((inv) => {
                const [label, cls] = STATUS_LABEL[inv.status] || STATUS_LABEL.expired;
                return (
                  <li key={inv._id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="text-gray-700 truncate">{inv.email || "Any e-mail"}</div>
                      <div className="text-xs text-gray-400">Created {new Date(inv.createdAt).toLocaleDateString()} · expires {new Date(inv.expiresAt).toLocaleDateString()}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
                      {inv.status === "pending" && (
                        <button type="button" onClick={() => cancel(inv)} className="text-xs text-red-600 hover:underline">Cancel</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {branchAdmins.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Branch admins (made by the company admin)</div>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {branchAdmins.map((a) => (
                <li key={a._id} className="px-4 py-2 text-sm">
                  <span className="font-medium text-gray-800">{a.name || a.firstName}</span>
                  <span className="text-gray-500"> · {a.email}</span>
                  <span className="text-xs text-gray-400"> · {a.branchName || "branch"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function Companies() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [countries, setCountries] = useState(() => mergeCountries([]));
  const [query, setQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [editing, setEditing] = useState(null); // company | {} for new
  const [adminsOf, setAdminsOf] = useState(null);
  const [createdInvite, setCreatedInvite] = useState(null); // { company, token, expiresAt } right after "Add company"
  const selectedId = getSelectedCompany()?._id;

  const load = useCallback(async () => {
    try {
      const res = await companyService.list();
      setRows(res.data?.data || []);
      setCountries(mergeCountries(res.data?.countries || []));
    } catch (err) {
      setRows([]);
      showToast("error", errMsg(err, "Could not load companies"));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows || []).filter(
      (c) =>
        (!countryFilter || c.country === countryFilter) &&
        (!q || c.name.toLowerCase().includes(q) || c.slug.includes(q)),
    );
  }, [rows, query, countryFilter]);

  const open = async (company, path = "/hrmlayout") => {
    if (!company.isActive) return showToast("error", "Activate this company first");
    setSelectedCompany(company);
    await loadBrandFromServer();
    navigate(path);
  };

  const toggleActive = async (c) => {
    const ok = await confirmAction({
      title: c.isActive ? `Deactivate ${c.name}?` : `Activate ${c.name}?`,
      text: c.isActive ? "Its staff and admins will not be able to log in until it is activated again." : "Its staff and admins can log in again.",
      confirmButtonText: c.isActive ? "Deactivate" : "Activate",
    });
    if (!ok) return;
    try {
      await companyService.update(c._id, { isActive: !c.isActive });
      showToast("success", c.isActive ? "Company deactivated" : "Company activated");
      load();
    } catch (err) {
      showToast("error", errMsg(err, "Could not change the status"));
    }
  };

  const remove = async (c) => {
    const ok = await confirmAction({
      title: `Delete ${c.name}?`,
      text: "Only a company without staff or logins can be deleted.",
      confirmButtonText: "Delete",
    });
    if (!ok) return;
    try {
      await companyService.remove(c._id);
      if (selectedId === c._id) clearSelectedCompany();
      showToast("success", "Company deleted");
      load();
    } catch (err) {
      showToast("error", errMsg(err, "Could not delete the company"));
    }
  };

  // Copies the company's login link. When the company has an admin, the link
  // also carries a signed key so the login page fills in that admin's e-mail
  // and password (valid 24 h). Without an admin it is the plain link.
  const copyLink = async (c) => {
    let link = loginLinkFor(c);
    let message = "Login link copied";
    try {
      const res = await companyService.loginLink(c._id);
      const d = res.data?.data;
      if (d?.token) {
        link = loginLinkFor(c, d.token);
        const until = d.expiresAt ? new Date(d.expiresAt).toLocaleString() : "";
        message = d.hasPassword
          ? `Login link copied — opens with ${d.adminEmail} and password filled in${until ? ` (valid until ${until})` : ""}`
          : `Login link copied — fills in ${d.adminEmail}. The password fills in once this admin has logged in one time.`;
      }
    } catch (err) {
      if (err.response?.data?.code === "NO_COMPANY_ADMIN") {
        message = "Login link copied (this company has no admin yet, so nothing is filled in)";
      } else {
        message = "Login link copied (without the admin's details)";
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      showToast("success", message);
    } catch {
      showToast("error", "Could not copy");
    }
  };

  const logout = () => {
    ["token", "user", "email", "role", "username", "selectedCompany"].forEach((k) => localStorage.removeItem(k));
    resetBrand();
    navigate("/login", { replace: true });
  };

  const counts = useMemo(() => {
    const by = {};
    (rows || []).forEach((c) => (by[c.country] = (by[c.country] || 0) + 1));
    return by;
  }, [rows]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-gray-800">
            <Building2 className="text-[var(--brand-primary)]" size={22} />
            Companies
          </div>
          <div className="flex items-center gap-2">
            {selectedId && (
              <button type="button" onClick={() => navigate("/hrmlayout")} className="hidden sm:inline-flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-gray-300">
                Back to {getSelectedCompany()?.name} <ArrowRight size={14} />
              </button>
            )}
            <button type="button" onClick={logout} className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100">
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Your client companies</h1>
            <p className="text-sm text-gray-500">
              Add a company, then send its admin the invite link — the admin adds the logo, staff and all other details. You can open any company to view it, but add / edit only inside your own company.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing({})}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[var(--brand-primary)]"
          >
            <Plus size={16} /> Add company
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className={`${inputCls} pl-9 bg-white`} placeholder="Search companies" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => setCountryFilter("")}
              className={`px-3 py-2 rounded-lg text-sm border whitespace-nowrap ${!countryFilter ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300"}`}
            >
              All {rows ? `(${rows.length})` : ""}
            </button>
            {countries
              .filter((c) => counts[c.code])
              .map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => setCountryFilter(c.code)}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm border whitespace-nowrap ${countryFilter === c.code ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300"}`}
                >
                  <Flag code={c.code} /> {c.name} ({counts[c.code]})
                </button>
              ))}
          </div>
        </div>

        {rows === null ? (
          <div className="flex justify-center py-20"><Spinner size="lg" /></div>
        ) : shown.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
            <Building2 className="mx-auto text-gray-300" size={40} />
            <p className="mt-3 text-gray-600 font-medium">{rows.length ? "No company matches" : "No companies yet"}</p>
            {!rows.length && <p className="text-sm text-gray-500">Add your first client company to get started.</p>}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {shown.map((c) => (
              <div
                key={c._id}
                className={`bg-white rounded-xl border p-4 flex flex-col gap-4 ${selectedId === c._id ? "border-[var(--brand-primary)] ring-1 ring-[var(--brand-primary)]" : "border-gray-200"} ${c.isActive ? "" : "opacity-70"}`}
              >
                <div className="flex items-start gap-3">
                  <CompanyBadge company={c} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-800 truncate">{c.name}</h3>
                      {c.isOwner && <span className="text-[10px] font-semibold uppercase rounded bg-blue-100 text-blue-700 px-1.5 py-0.5">Your company</span>}
                      {!c.isActive && <span className="text-[10px] font-semibold uppercase rounded bg-gray-200 text-gray-600 px-1.5 py-0.5">Inactive</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
                      <Flag code={c.country} /> {c.countryName || countryNameOf(c.country)} · {c.currencyCode}
                    </div>
                    <button type="button" onClick={() => copyLink(c)} className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800" title="Copy login link">
                      <LinkIcon size={12} /> /login?company={c.slug} <Copy size={11} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-gray-50 py-2">
                    <div className="text-lg font-bold text-gray-800">{c.staffCount}</div>
                    <div className="text-[11px] text-gray-500">Staff{c.maxStaff ? ` / ${c.maxStaff}` : ""}</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 py-2">
                    <div className="text-lg font-bold text-gray-800">{c.adminCount}</div>
                    <div className="text-[11px] text-gray-500">Admins</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 py-2">
                    <div className="text-lg font-bold text-gray-800">{c.profileComplete}%</div>
                    <div className="text-[11px] text-gray-500">Profile</div>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden -mt-2">
                  <div className="h-full rounded-full" style={{ width: `${c.profileComplete}%`, backgroundColor: c.primaryColor || "var(--brand-primary)" }} />
                </div>

                <div className="flex items-center gap-2 mt-auto">
                  <button
                    type="button"
                    onClick={() => open(c)}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-[var(--brand-primary)] disabled:opacity-50"
                    disabled={!c.isActive}
                  >
                    {c.isOwner ? "Open" : "View"} <ArrowRight size={14} />
                  </button>
                  <button type="button" title="Company profile" onClick={() => open(c, "/hrmlayout/settings")} disabled={!c.isActive} className="p-2 rounded-lg border border-gray-300 disabled:opacity-50">
                    <Building2 size={16} />
                  </button>
                  <button type="button" title="Admin logins" onClick={() => setAdminsOf(c)} className="p-2 rounded-lg border border-gray-300">
                    <ShieldCheck size={16} />
                  </button>
                  <button type="button" title="Edit" onClick={() => setEditing(c)} className="p-2 rounded-lg border border-gray-300">
                    <Pencil size={16} />
                  </button>
                  <button type="button" title={c.isActive ? "Deactivate" : "Activate"} onClick={() => toggleActive(c)} className="p-2 rounded-lg border border-gray-300">
                    <Power size={16} className={c.isActive ? "text-emerald-600" : "text-gray-400"} />
                  </button>
                  {!c.isOwner && c.staffCount === 0 && c.adminCount === 0 && (
                    <button type="button" title="Delete" onClick={() => remove(c)} className="p-2 rounded-lg border border-gray-300 text-red-600">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-400 flex items-center gap-1">
          <Users size={12} /> Staff and admins log in at their company&apos;s link and only ever see their own company.
        </p>
      </main>

      {editing && (
        <CompanyModal
          company={editing._id ? editing : null}
          countries={countries}
          onClose={() => setEditing(null)}
          onSaved={(saved, created, invite) => {
            setEditing(null);
            load();
            if (created && saved && invite?.token) setCreatedInvite({ company: saved, token: invite.token, expiresAt: invite.expiresAt });
            // Keep the open company's tabs / name current.
            if (saved && selectedId === saved._id) setSelectedCompany(saved);
            if (created && saved) showToast("success", `Open “${saved.name}” to complete its profile`);
          }}
        />
      )}
      {adminsOf && <AdminsModal company={adminsOf} onClose={() => setAdminsOf(null)} onChanged={load} />}
      {createdInvite && (
        <Modal isOpen onClose={() => setCreatedInvite(null)} size="max-w-xl" title={`${createdInvite.company.name} created`}>
          <InviteLinkBox
            token={createdInvite.token}
            expiresAt={createdInvite.expiresAt}
            what={`admin account for ${createdInvite.company.name}`}
          />
        </Modal>
      )}
    </div>
  );
}