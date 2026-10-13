// src/components/branding/CompanyBranding.jsx
// Super-admin screen: set this company's name, logo and colours. The same
// branding is used on the website, the PDFs (payslip / settlement) and the
// mobile app (GET /api/company/branding).
import React, { useEffect, useState } from "react";
import { Palette, Upload, Trash2 } from "lucide-react";
import Card from "../common/Card";
import Button from "../common/Button";
import { companyService } from "../../services/companyService";
import { getBrand, setBrand } from "../../utils/brand";
import { showToast } from "../../utils/toast";

const MAX_W = 360;
const MAX_H = 140;

// Shrinks the chosen image so it stays small (stored in the database and
// downloaded by every visitor) and converts it to PNG so PDFs can embed it.
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

const Field = ({ label, hint, children }) => (
  <label className="block">
    <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
    {children}
    {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
  </label>
);

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]";

const ColorField = ({ label, value, onChange }) => (
  <Field label={label}>
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-14 rounded border border-gray-300 cursor-pointer bg-white"
      />
      <input
        className={inputCls}
        value={value}
        maxLength={7}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  </Field>
);

export default function CompanyBranding() {
  const [form, setForm] = useState(() => ({ ...getBrand() }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    companyService
      .getBranding()
      .then((res) => res.data?.data && setForm({ ...res.data.data }))
      .catch(() => {});
  }, []);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const onLogoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("error", "Please choose an image file (PNG, JPG, WebP or SVG)");
      return;
    }
    try {
      set("logoUrl")(await fileToLogoDataUrl(file));
    } catch (err) {
      showToast("error", err.message || "Could not use this image");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await companyService.updateBranding(form);
      setBrand(res.data.data);
      showToast("success", "Branding saved");
    } catch (err) {
      showToast("error", err.response?.data?.message || "Could not save branding");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Palette className="text-[var(--brand-primary)]" />
        <div>
          <h1 className="text-xl font-bold text-gray-800">Company Branding</h1>
          <p className="text-sm text-gray-500">
            Logo, name and colours shown on the website, PDFs and the mobile app.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card title="Details" className="xl:col-span-2" bodyClassName="p-6 space-y-4">
          <Field label="Company name" hint="Shown in the sidebar, login page, browser tab and PDFs">
            <input className={inputCls} maxLength={80} value={form.name || ""} onChange={(e) => set("name")(e.target.value)} />
          </Field>
          <Field label="Short name" hint="Optional — used in tight spaces (sidebar badge)">
            <input className={inputCls} maxLength={30} value={form.shortName || ""} onChange={(e) => set("shortName")(e.target.value)} />
          </Field>

          <Field label="Logo" hint="PNG with a transparent background works best. It is resized automatically.">
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-sm cursor-pointer hover:bg-gray-50">
                <Upload size={16} /> Upload logo
                <input type="file" accept="image/*" className="hidden" onChange={onLogoPick} />
              </label>
              {form.logoUrl && (
                <button
                  type="button"
                  onClick={() => set("logoUrl")("")}
                  className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline cursor-pointer"
                >
                  <Trash2 size={14} /> Remove
                </button>
              )}
            </div>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ColorField label="Primary colour (buttons, links)" value={form.primaryColor || "#2563eb"} onChange={set("primaryColor")} />
            <ColorField label="Sidebar / login panel colour" value={form.sidebarColor || "#0b1220"} onChange={set("sidebarColor")} />
          </div>

          <Field label="Login page title">
            <input className={inputCls} maxLength={80} value={form.loginTitle || ""} onChange={(e) => set("loginTitle")(e.target.value)} />
          </Field>
          <Field label="Login page tagline">
            <input className={inputCls} maxLength={160} value={form.tagline || ""} onChange={(e) => set("tagline")(e.target.value)} />
          </Field>
          <Field label="Login page notice">
            <input className={inputCls} maxLength={200} value={form.loginSubtitle || ""} onChange={(e) => set("loginSubtitle")(e.target.value)} />
          </Field>
          <Field label="Finance signatory title" hint='Printed on payslips, e.g. "Finance Manager"'>
            <input className={inputCls} maxLength={60} value={form.financeTitle || ""} onChange={(e) => set("financeTitle")(e.target.value)} />
          </Field>

          <div className="pt-2">
            <Button onClick={save} loading={saving}>Save branding</Button>
          </div>
        </Card>

        <Card title="Preview" bodyClassName="p-0 overflow-hidden">
          <div className="flex items-center justify-center h-16" style={{ backgroundColor: form.sidebarColor }}>
            <PreviewLogo form={form} />
          </div>
          <div className="p-6 space-y-3">
            <p className="font-semibold text-gray-800">{form.loginTitle || form.name}</p>
            <p className="text-sm text-gray-500">{form.tagline}</p>
            <button
              type="button"
              className="w-full py-2 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: form.primaryColor }}
            >
              Login
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// Preview uses the unsaved form values (BrandLogo reads the saved brand).
const PreviewLogo = ({ form }) =>
  form.logoUrl ? (
    <img src={form.logoUrl} alt={form.name} className="h-10 w-auto object-contain" />
  ) : (
    <div className="flex items-center gap-2.5">
      <span
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg font-bold text-white text-lg"
        style={{ backgroundColor: form.primaryColor }}
      >
        {(form.shortName || form.name || "H").trim().charAt(0).toUpperCase()}
      </span>
      <span className="font-semibold text-white truncate">{form.shortName || form.name}</span>
    </div>
  );
