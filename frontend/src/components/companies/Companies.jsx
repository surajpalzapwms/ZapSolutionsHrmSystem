// src/components/companies/Companies.jsx
// Super admin: every company in one place. Add / edit / deactivate / delete a
// company, and click one to open it — from then on the whole website shows
// ONLY that company's data until you press "Switch company".
import React, { useCallback, useEffect, useState } from "react";
import { Building2, Plus, Pencil, Trash2, Users, LogOut, Upload, X, ChevronRight, Wifi, LayoutGrid } from "lucide-react";
import Spinner from "../common/Spinner";
import { companyService } from "../../services/companyService";
import { TAB_TREE, ALL_TAB_KEYS } from "../../utils/permissionTabs";
import { setSelectedCompany, clearSelectedCompany } from "../../utils/company";
import { resetBrand } from "../../utils/brand";
import { showToast } from "../../utils/toast";

const MAX_W = 360;
const MAX_H = 140;

// Shrinks the chosen image (stored in the database, downloaded by visitors).
const fileToLogoDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not read this image"));
      img.onload = () => {
        const scale = Math.min(1, MAX_W / img.width, MAX_H / img.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

const slugify = (v) =>
  String(v || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

const EMPTY = {
  name: "",
  slug: "",
  tagline: "",
  logoUrl: "",
  primaryColor: "#2563eb",
  sidebarColor: "#0b1220",
  isActive: true,
  officeNetworksText: "",
  enabledTabs: null, // null = every tab
};

const CompanyBadge = ({ company, size = "h-12 w-12 text-xl" }) =>
  company.logoUrl ? (
    <img src={company.logoUrl} alt={company.name} className="h-12 w-auto max-w-[120px] object-contain" />
  ) : (
    <span
      className={`inline-flex items-center justify-center rounded-xl font-bold text-white shrink-0 ${size}`}
      style={{ backgroundColor: company.primaryColor || "#2563eb" }}
    >
      {(company.shortName || company.name || "?").trim().charAt(0).toUpperCase()}
    </span>
  );

function CompanyModal({ company, onClose, onSaved }) {
  const editing = Boolean(company?._id);
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...(company || {}),
    officeNetworksText: (company?.officeNetworks || []).join("\n"),
  }));
  const [detecting, setDetecting] = useState(false);
  const [slugTouched, setSlugTouched] = useState(editing);
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const onLogoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("error", "Please choose an image file");
      return;
    }
    try {
      set("logoUrl")(await fileToLogoDataUrl(file));
    } catch (err) {
      showToast("error", err.message || "Could not use this image");
    }
  };

  // Tabs this company has. null = every tab (also what old companies have).
  const tabsOn = form.enabledTabs === null ? ALL_TAB_KEYS : form.enabledTabs;
  const setTabs = (keys) =>
    setForm((f) => ({
      ...f,
      // all selected = "every tab" (so tabs added in future updates appear automatically)
      enabledTabs: ALL_TAB_KEYS.every((k) => keys.includes(k)) ? null : keys,
    }));
  const toggleTab = (tab, subKey) => {
    const on = new Set(tabsOn);
    if (!subKey) {
      if (on.has(tab.key)) {
        on.delete(tab.key);
        (tab.subTabs || []).forEach((s) => on.delete(s.key));
      } else {
        on.add(tab.key);
        (tab.subTabs || []).forEach((s) => on.add(s.key));
      }
    } else if (on.has(subKey)) {
      on.delete(subKey);
    } else {
      on.add(subKey);
      on.add(tab.key); // a sub-tab needs its tab
    }
    setTabs([...on]);
  };

  // Adds the Wi-Fi this computer is on right now (connect to the office Wi-Fi first).
  const detectNetwork = async () => {
    setDetecting(true);
    try {
      const res = await companyService.myNetwork();
      const found = res.data?.entries || [];
      setForm((f) => {
        const have = f.officeNetworksText.split(/[\s,;]+/).filter(Boolean);
        const merged = [...have, ...found.filter((x) => !have.includes(x))];
        return { ...f, officeNetworksText: merged.join("\n") };
      });
      if (!found.length) showToast("error", "Could not detect a network address");
    } catch (err) {
      showToast("error", err.response?.data?.message || "Could not detect the network");
    } finally {
      setDetecting(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast("error", "Company name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug || slugify(form.name),
        tagline: form.tagline,
        logoUrl: form.logoUrl,
        primaryColor: form.primaryColor,
        sidebarColor: form.sidebarColor,
        isActive: form.isActive,
        officeNetworks: form.officeNetworksText,
        enabledTabs: form.enabledTabs,
      };
      if (editing) await companyService.update(company._id, payload);
      else await companyService.create(payload);
      showToast("success", editing ? "Company updated" : "Company added");
      onSaved();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Could not save company");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">{editing ? "Edit company" : "Add company"}</h2>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 cursor-pointer" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">Company name *</span>
          <input
            className={inputCls}
            maxLength={80}
            value={form.name}
            autoFocus
            onChange={(e) => {
              set("name")(e.target.value);
              if (!slugTouched) set("slug")(slugify(e.target.value));
            }}
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">Link name</span>
          <input
            className={inputCls}
            maxLength={40}
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true);
              set("slug")(slugify(e.target.value));
            }}
          />
          <span className="block text-xs text-gray-500 mt-1">
            Staff can open the login page with <span className="font-mono">?company={form.slug || "link-name"}</span> to see this company&apos;s logo.
          </span>
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">Tagline</span>
          <input className={inputCls} maxLength={160} value={form.tagline || ""} onChange={(e) => set("tagline")(e.target.value)} />
        </label>

        <div>
          <span className="block text-sm font-medium text-gray-700 mb-1">Logo</span>
          <div className="flex items-center gap-3">
            <CompanyBadge company={form} />
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-sm cursor-pointer hover:bg-gray-50">
              <Upload size={16} /> Upload
              <input type="file" accept="image/*" className="hidden" onChange={onLogoPick} />
            </label>
            {form.logoUrl && (
              <button type="button" onClick={() => set("logoUrl")("")} className="text-sm text-red-600 hover:underline cursor-pointer">
                Remove
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {[
            ["primaryColor", "Primary colour"],
            ["sidebarColor", "Sidebar colour"],
          ].map(([key, label]) => (
            <label key={key} className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form[key]}
                  onChange={(e) => set(key)(e.target.value)}
                  className="h-10 w-12 rounded border border-gray-300 cursor-pointer bg-white"
                />
                <input className={inputCls} value={form[key]} maxLength={7} onChange={(e) => set(key)(e.target.value)} />
              </div>
            </label>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Wifi size={15} className="text-blue-600" /> Office Wi-Fi address
            </span>
            <button
              type="button"
              onClick={detectNetwork}
              disabled={detecting}
              className="text-xs font-semibold text-blue-600 hover:underline disabled:opacity-60 cursor-pointer"
            >
              {detecting ? "Detecting…" : "Use this computer's network"}
            </button>
          </div>
          <textarea
            className={`${inputCls} font-mono text-xs`}
            rows={3}
            value={form.officeNetworksText}
            onChange={(e) => set("officeNetworksText")(e.target.value)}
            placeholder={"203.0.113.5\n2401:4900:88b1:ac1e::/64"}
          />
          <span className="block text-xs text-gray-500 mt-1">
            One per line: the office router&apos;s public IP, or a range. Staff on this Wi-Fi are signed in
            automatically — only for <b>this</b> company. Leave empty to set it later.
          </span>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <LayoutGrid size={15} className="text-blue-600" /> Tabs this company has
            </span>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabledTabs === null}
                onChange={(e) => setTabs(e.target.checked ? ALL_TAB_KEYS : [])}
              />
              All tabs
            </label>
          </div>
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
            {TAB_TREE.map((tab) => (
              <div key={tab.key} className="px-3 py-2">
                <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
                  <input type="checkbox" checked={tabsOn.includes(tab.key)} onChange={() => toggleTab(tab)} />
                  {tab.label}
                </label>
                {tab.subTabs?.length ? (
                  <div className="ml-6 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {tab.subTabs.map((sub) => (
                      <label key={sub.key} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={tabsOn.includes(sub.key)}
                          onChange={() => toggleTab(tab, sub.key)}
                        />
                        {sub.label}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <span className="block text-xs text-gray-500 mt-1">
            Only the ticked tabs exist for this company — on its website <b>and</b> its app, for its admins and staff.
            Dashboard and Holidays are always there. Its admin can then give admins only a subset of these.
          </span>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive")(e.target.checked)} />
          Active (inactive companies can&apos;t log in)
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 cursor-pointer">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 cursor-pointer"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Add company"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Companies() {
  const [companies, setCompanies] = useState(null);
  const [modal, setModal] = useState(null); // null | {} (new) | company (edit)

  const load = useCallback(async () => {
    try {
      const res = await companyService.list();
      setCompanies(res.data?.data || []);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Could not load companies");
      setCompanies([]);
    }
  }, []);

  useEffect(() => {
    // No company is open on this page.
    clearSelectedCompany();
    resetBrand();
    load();
  }, [load]);

  // Opens the company. A full page load makes sure nothing from another
  // company is left in memory.
  const open = (company) => {
    if (company.isActive === false) {
      showToast("error", "This company is inactive. Activate it first (Edit).");
      return;
    }
    setSelectedCompany(company);
    window.location.assign("/hrmlayout");
  };

  const remove = async (e, company) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${company.name}"? This only works for a company with no staff.`)) return;
    try {
      await companyService.remove(company._id);
      showToast("success", "Company deleted");
      load();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Could not delete company");
    }
  };

  const logout = () => {
    ["token", "user", "email", "role", "username", "selectedCompany"].forEach((k) => localStorage.removeItem(k));
    window.location.assign("/login");
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          <div className="flex items-center gap-2.5">
            <Building2 className="text-blue-600" />
            <h1 className="text-lg font-bold text-gray-800">Companies</h1>
          </div>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600 cursor-pointer"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <p className="text-sm text-gray-600">
            Click a company to open it. You will then see <b>only that company&apos;s</b> staff, attendance and payroll.
          </p>
          <button
            onClick={() => setModal({})}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 cursor-pointer"
          >
            <Plus size={16} /> Add company
          </button>
        </div>

        {companies === null ? (
          <div className="flex justify-center py-24">
            <Spinner size="lg" />
          </div>
        ) : companies.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <Building2 className="mx-auto text-gray-300" size={40} />
            <p className="mt-3 font-semibold text-gray-700">No company yet</p>
            <p className="text-sm text-gray-500">Add your first company to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {companies.map((c) => (
              <div
                key={c._id}
                role="button"
                tabIndex={0}
                onClick={() => open(c)}
                onKeyDown={(e) => e.key === "Enter" && open(c)}
                className={`group rounded-2xl bg-white border border-gray-200 p-5 shadow-sm hover:shadow-md hover:border-blue-300 transition cursor-pointer ${
                  c.isActive === false ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <CompanyBadge company={c} />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal(c);
                      }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer"
                      aria-label={`Edit ${c.name}`}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={(e) => remove(e, c)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                      aria-label={`Delete ${c.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <h2 className="mt-4 text-base font-semibold text-gray-800 truncate">{c.name}</h2>
                <p className="text-xs text-gray-400 font-mono truncate">{c.slug}</p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500 ml-3">
                  <LayoutGrid size={12} />
                  {Array.isArray(c.enabledTabs)
                    ? `${TAB_TREE.filter((t) => c.enabledTabs.includes(t.key)).length} of ${TAB_TREE.length} tabs`
                    : "All tabs"}
                </p>
                <p
                  className={`mt-1 inline-flex items-center gap-1 text-xs ${c.officeNetworks?.length ? "text-gray-500" : "text-amber-600"}`}
                  title={(c.officeNetworks || []).join(", ")}
                >
                  <Wifi size={12} />
                  {c.officeNetworks?.length
                    ? `${c.officeNetworks.length} office Wi-Fi address${c.officeNetworks.length > 1 ? "es" : ""}`
                    : "No office Wi-Fi set"}
                </p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-sm text-gray-600">
                    <Users size={15} /> {c.staffCount} staff
                    {c.adminCount ? ` · ${c.adminCount} admin${c.adminCount > 1 ? "s" : ""}` : ""}
                  </span>
                  {c.isActive === false ? (
                    <span className="text-xs font-medium text-red-600 bg-red-50 rounded-full px-2 py-0.5">Inactive</span>
                  ) : (
                    <span className="inline-flex items-center text-xs font-medium text-blue-600 group-hover:translate-x-0.5 transition">
                      Open <ChevronRight size={14} />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {modal && (
        <CompanyModal
          company={modal._id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
    </div>
  );
}
