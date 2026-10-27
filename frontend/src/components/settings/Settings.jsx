// src/components/settings/Settings.jsx
// Settings tab (super admin, or an admin granted the "Settings" tab):
//   • Branding         – logo, name, colours, login page texts
//   • Company details  – address, phone, email, website
//   • Payroll currency – the currency + number format used for every amount
// Saved on the server, so the website, PDFs and mobile app all use it.
import React, { useEffect, useState } from "react";
import { Settings as SettingsIcon, Palette, Building2, Banknote, Upload, RotateCcw } from "lucide-react";
import Card from "../common/Card";
import Button from "../common/Button";
import { settingsService } from "../../services/settingsService";
import { getBrand, setBrand, formatMoney } from "../../utils/brand";
import { CURRENCIES, NUMBER_FORMATS, findCurrency } from "../../utils/currencies";
import { useBrand } from "../../contexts/BrandContext";
import { showToast } from "../../utils/toast";

const MAX_W = 360;
const MAX_H = 140;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

// Shrinks the chosen image (it is stored in the database and downloaded by
// every visitor) and converts it to PNG so PDFs can embed it.
const fileToLogoDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this file"));
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

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]";

const Field = ({ label, hint, children }) => (
  <label className="block">
    <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
    {children}
    {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
  </label>
);

const TextField = ({ label, hint, value, onChange, maxLength, type = "text", placeholder }) => (
  <Field label={label} hint={hint}>
    <input
      type={type}
      className={inputCls}
      maxLength={maxLength}
      placeholder={placeholder}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
    />
  </Field>
);

const ColorField = ({ label, value, onChange }) => (
  <Field label={label}>
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-14 rounded border border-gray-300 cursor-pointer bg-white"
      />
      <input className={inputCls} value={value || ""} maxLength={7} onChange={(e) => onChange(e.target.value)} />
    </div>
  </Field>
);

const TABS = [
  { key: "branding", label: "Branding", icon: Palette },
  { key: "details", label: "Company details", icon: Building2 },
  { key: "currency", label: "Payroll currency", icon: Banknote },
];

const FIELD_KEYS = [
  "name", "shortName", "tagline", "logoUrl", "primaryColor", "sidebarColor",
  "loginTitle", "loginSubtitle", "financeTitle",
  "address", "phone", "email", "website",
  "currencyCode", "numberLocale",
];

const pick = (b) => Object.fromEntries(FIELD_KEYS.map((k) => [k, b?.[k] ?? ""]));

export default function Settings() {
  useBrand();
  const [tab, setTab] = useState("branding");
  const [form, setForm] = useState(() => pick(getBrand()));
  const [saved, setSaved] = useState(() => pick(getBrand()));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settingsService
      .get()
      .then((res) => {
        const data = pick(res.data?.data);
        setForm(data);
        setSaved(data);
      })
      .catch(() => {});
  }, []);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const dirty = FIELD_KEYS.some((k) => (form[k] || "") !== (saved[k] || ""));

  const onLogoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("error", "Please choose an image file (PNG, JPG, WebP or SVG)");
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      showToast("error", "That image is too big. Please choose one under 8 MB.");
      return;
    }
    try {
      set("logoUrl")(await fileToLogoDataUrl(file));
    } catch (err) {
      showToast("error", err.message || "Could not use this image");
    }
  };

  const onCurrencyPick = (code) => {
    // Picking a currency also picks its usual number format; the number
    // format can still be changed afterwards.
    const cur = findCurrency(code);
    setForm((f) => ({ ...f, currencyCode: code, numberLocale: cur?.locale && NUMBER_FORMATS.some((n) => n.locale === cur.locale) ? cur.locale : "" }));
  };

  const save = async () => {
    if (!form.name?.trim()) {
      showToast("error", "Company name is required");
      setTab("branding");
      return;
    }
    setSaving(true);
    try {
      const res = await settingsService.update(form);
      setBrand(res.data.data);
      const data = pick(res.data.data);
      setForm(data);
      setSaved(data);
      showToast("success", "Settings saved");
    } catch (err) {
      showToast("error", err.response?.data?.message || "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  // Preview of the amounts using the unsaved currency choice.
  const previewMoney = (value) => {
    const cur = findCurrency(form.currencyCode) || findCurrency("INR");
    try {
      return new Intl.NumberFormat(form.numberLocale || cur.locale, {
        style: "currency",
        currency: cur.code,
        currencyDisplay: "narrowSymbol",
      }).format(value);
    } catch {
      return formatMoney(value);
    }
  };

  const logo = form.logoUrl || getBrand().logoUrl;
  const initial = (form.shortName || form.name || "H").trim().charAt(0).toUpperCase();

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <SettingsIcon className="text-[var(--brand-primary)]" />
        <div>
          <h1 className="text-xl font-bold text-gray-800">Settings</h1>
          <p className="text-sm text-gray-500">
            Logo, company details and payroll currency — used on the website, payslips, PDFs and the mobile app.
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
              tab === t.key
                ? "border-[var(--brand-primary)] text-[var(--brand-primary)]"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card
          title={TABS.find((t) => t.key === tab).label}
          className="xl:col-span-2"
          bodyClassName="space-y-4"
        >
          {tab === "branding" && (
            <>
              <TextField label="Company name" hint="Shown in the sidebar, login page, browser tab and PDFs" value={form.name} onChange={set("name")} maxLength={80} />
              <TextField label="Short name" hint="Optional — used in tight spaces" value={form.shortName} onChange={set("shortName")} maxLength={30} />

              <Field label="Logo" hint="PNG with a transparent background works best. It is resized automatically.">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="h-16 min-w-[8rem] px-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center">
                    {logo ? (
                      <img src={logo} alt="Logo preview" className="max-h-12 w-auto object-contain" />
                    ) : (
                      <span className="text-xs text-gray-400">No logo</span>
                    )}
                  </div>
                  <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-sm cursor-pointer hover:bg-gray-50">
                    <Upload size={16} /> Upload logo
                    <input type="file" accept="image/*" className="hidden" onChange={onLogoPick} />
                  </label>
                  {form.logoUrl && (
                    <button
                      type="button"
                      onClick={() => set("logoUrl")("")}
                      className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline cursor-pointer"
                    >
                      <RotateCcw size={14} /> Use default logo
                    </button>
                  )}
                </div>
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ColorField label="Primary colour (buttons, links)" value={form.primaryColor} onChange={set("primaryColor")} />
                <ColorField label="Sidebar / login panel colour" value={form.sidebarColor} onChange={set("sidebarColor")} />
              </div>

              <TextField label="Login page title" value={form.loginTitle} onChange={set("loginTitle")} maxLength={80} />
              <TextField label="Login page tagline" value={form.tagline} onChange={set("tagline")} maxLength={160} />
              <TextField label="Login page notice" value={form.loginSubtitle} onChange={set("loginSubtitle")} maxLength={200} />
              <TextField label="Finance signatory title" hint='Printed on payslips, e.g. "Finance Manager"' value={form.financeTitle} onChange={set("financeTitle")} maxLength={60} />
            </>
          )}

          {tab === "details" && (
            <>
              <Field label="Address">
                <textarea
                  className={inputCls}
                  rows={3}
                  maxLength={300}
                  value={form.address || ""}
                  onChange={(e) => set("address")(e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <TextField label="Phone" value={form.phone} onChange={set("phone")} maxLength={40} />
                <TextField label="Email" type="email" value={form.email} onChange={set("email")} maxLength={120} />
              </div>
              <TextField label="Website" placeholder="https://" value={form.website} onChange={set("website")} maxLength={120} />
            </>
          )}

          {tab === "currency" && (
            <>
              <Field label="Payroll currency" hint="Every salary, payroll, advance and expense amount is shown in this currency.">
                <select className={inputCls} value={form.currencyCode || "INR"} onChange={(e) => onCurrencyPick(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Number format" hint="How digits are grouped.">
                <select className={inputCls} value={form.numberLocale || ""} onChange={(e) => set("numberLocale")(e.target.value)}>
                  <option value="">
                    Default for {form.currencyCode || "INR"}
                  </option>
                  {NUMBER_FORMATS.map((n) => (
                    <option key={n.locale} value={n.locale}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="text-xs text-gray-500 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                Changing the currency only changes how amounts are <strong>displayed</strong>. Existing salary
                figures are not converted — enter or revise salaries in the new currency if needed.
              </p>
            </>
          )}

          <div className="pt-2 flex items-center gap-3">
            <Button onClick={save} loading={saving} disabled={!dirty}>
              Save settings
            </Button>
            {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          </div>
        </Card>

        <Card title="Preview" noPadding className="overflow-hidden">
          <div className="flex items-center justify-center h-16" style={{ backgroundColor: form.sidebarColor || "#0b1220" }}>
            {logo ? (
              <img src={logo} alt={form.name} className="h-10 w-auto object-contain" />
            ) : (
              <div className="flex items-center gap-2.5">
                <span
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg font-bold text-white text-lg"
                  style={{ backgroundColor: form.primaryColor }}
                >
                  {initial}
                </span>
                <span className="font-semibold text-white truncate">{form.shortName || form.name}</span>
              </div>
            )}
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
            <div className="pt-3 border-t border-gray-100 text-sm space-y-1">
              <p className="text-xs uppercase tracking-wide text-gray-400">Amounts look like</p>
              <p className="text-gray-800">Basic salary {previewMoney(25000)}</p>
              <p className="text-gray-800">Net pay {previewMoney(1234567.5)}</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
