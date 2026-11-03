// src/components/settings/Settings.jsx
//
// COMPANY PROFILE (white label) — the company in use:
//   • the company's own admin (with the "Settings" tab), or
//   • the super admin, for the company opened on the Companies page.
//
// Sections: Branding · Address & contact · Registration & tax (fields depend
// on the country: GSTIN / PAN in India, CR / VAT in Saudi Arabia, CR / TIN in
// Qatar) · Country & payroll (currency, time zone) · Work week & hours
// (weekly off days, office hours, short Saturday) ·
// Letters & payslips (signatory, signature, stamp).
// Saved on the server, so the website, PDFs and the mobile app all use it.
import React, { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Palette,
  MapPin,
  FileBadge,
  Globe2,
  PenLine,
  Upload,
  Trash2,
  Save,
  AlertTriangle,
  Lock,
  Clock,
} from "lucide-react";
import "flag-icons/css/flag-icons.min.css";
import Spinner from "../common/Spinner";
import { companyService } from "../../services/companyService";
import { setBrand, DAY_NAMES, formatHM } from "../../utils/brand";
import { CURRENCIES, NUMBER_FORMATS, findCurrency } from "../../utils/currencies";
import { mergeCountries } from "../../utils/countries";
import { fileToPngDataUrl } from "../../utils/imageFiles";
import { getSelectedCompany, setSelectedCompany } from "../../utils/company";
import { isSuperAdminUser } from "../../utils/authUser";
import { showToast } from "../../utils/toast";

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] disabled:bg-gray-50 disabled:text-gray-500";

const TIME_ZONES = [
  "Asia/Kolkata",
  "Asia/Riyadh",
  "Asia/Qatar",
  "Asia/Dubai",
  "Asia/Kuwait",
  "Asia/Bahrain",
  "Asia/Muscat",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Asia/Colombo",
  "Asia/Singapore",
  "Africa/Cairo",
  "Europe/London",
  "UTC",
];

// Text fields of the profile (everything except images / ids / days).
const TEXT_FIELDS = [
  "name", "legalName", "nameAr", "shortName", "tagline",
  "primaryColor", "sidebarColor", "loginTitle", "loginSubtitle",
  "address", "city", "state", "postalCode", "phone", "email", "website",
  "country", "currencyCode", "numberLocale", "timeZone",
  "financeTitle", "signatoryName", "signatoryTitle",
];

const SECTIONS = [
  { key: "branding", label: "Branding", icon: Palette },
  { key: "contact", label: "Address & contact", icon: MapPin },
  { key: "legal", label: "Registration & tax", icon: FileBadge },
  { key: "locale", label: "Country & payroll", icon: Globe2 },
  { key: "work", label: "Work week & hours", icon: Clock },
  { key: "documents", label: "Letters & payslips", icon: PenLine },
];

const Field = ({ label, hint, children, error }) => (
  <label className="block">
    <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
    {children}
    {error ? (
      <span className="block text-xs text-red-600 mt-1">{error}</span>
    ) : (
      hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>
    )}
  </label>
);

const Text = ({ label, hint, value, onChange, maxLength, disabled, dir, placeholder, type = "text" }) => (
  <Field label={label} hint={hint}>
    <input
      type={type}
      dir={dir}
      className={inputCls}
      value={value || ""}
      maxLength={maxLength}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  </Field>
);

const Color = ({ label, value, onChange, disabled }) => (
  <Field label={label}>
    <div className="flex items-center gap-2">
      <input
        type="color"
        disabled={disabled}
        value={/^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-14 rounded border border-gray-300 cursor-pointer bg-white"
      />
      <input className={inputCls} disabled={disabled} value={value || ""} maxLength={7} placeholder="Default" onChange={(e) => onChange(e.target.value)} />
      {!disabled && value && (
        <button type="button" onClick={() => onChange("")} className="text-xs text-gray-500 hover:text-gray-800 whitespace-nowrap">
          Use default
        </button>
      )}
    </div>
  </Field>
);

// Logo / signature / stamp upload box.
function ImageBox({ label, hint, src, onPick, onRemove, disabled, maxW, maxH, tall }) {
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      onPick(await fileToPngDataUrl(file, { maxW, maxH }));
    } catch (err) {
      showToast("error", err.message || "Could not use this image");
    }
  };
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`${tall ? "h-24 w-24" : "h-16 min-w-[8rem]"} px-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center`}>
          {src === "saved" ? (
            <span className="text-xs font-medium text-emerald-600 text-center">Saved ✓</span>
          ) : src ? (
            <img src={src} alt="" className="max-h-full max-w-[10rem] object-contain" />
          ) : (
            <span className="text-xs text-gray-400">None</span>
          )}
        </div>
        {!disabled && (
          <>
            <span className="relative inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-sm cursor-pointer hover:bg-gray-50">
              <Upload size={16} /> Upload
              <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={pick} />
            </span>
            {src && (
              <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline">
                <Trash2 size={14} /> Remove
              </button>
            )}
          </>
        )}
      </div>
    </Field>
  );
}

// Working time fields (Settings → Work week & hours).
const WORK_FIELDS = ["workStartTime", "workEndTime", "shortSaturday", "saturdayStartTime", "saturdayEndTime"];
const pickWork = (p) => ({
  workStartTime: p?.workStartTime || "10:00",
  workEndTime: p?.workEndTime || "18:30",
  shortSaturday: p?.shortSaturday !== false,
  saturdayStartTime: p?.saturdayStartTime || "10:00",
  saturdayEndTime: p?.saturdayEndTime || "16:00",
});
const toMin = (hm) => {
  const [h, m] = String(hm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};
// Net hours of a shift after the 1:30–2:15 PM lunch break (same as the server).
const netHours = (start, end) => {
  const a = toMin(start);
  const b = toMin(end);
  if (!(b > a)) return "";
  const lunch = Math.max(0, Math.min(b, 855) - Math.max(a, 810));
  const net = b - a - lunch;
  return `${Math.floor(net / 60)}h ${String(net % 60).padStart(2, "0")}m`;
};

const pickText = (raw) => Object.fromEntries(TEXT_FIELDS.map((k) => [k, raw?.[k] ?? ""]));

export default function Settings() {
  const [profile, setProfile] = useState(null); // server answer
  const [countries, setCountries] = useState([]);
  const [form, setForm] = useState(null);
  const [legalIds, setLegalIds] = useState({});
  const [weeklyOff, setWeeklyOff] = useState([]);
  const [work, setWork] = useState(pickWork(null));
  const [images, setImages] = useState({}); // { logoUrl?, signatureData?, stampData? } changed only
  const [section, setSection] = useState("branding");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [p, c] = await Promise.all([companyService.getProfile(), companyService.countries()]);
      const data = p.data.data;
      setProfile(data);
      setCountries(mergeCountries(c.data?.data || []));
      setForm(pickText({ ...data.raw, country: data.country }));
      setLegalIds(data.legalIds || {});
      setWeeklyOff(data.weeklyOffDays || []);
      setWork(pickWork(data));
      setImages({});
    } catch (err) {
      showToast("error", err.response?.data?.message || "Could not load the company profile");
    }
  };
  useEffect(() => {
    load();
  }, []);

  const country = useMemo(
    () => countries.find((c) => c.code === form?.country) || null,
    [countries, form?.country],
  );
  const legalDefs = country?.legalIds || profile?.legalIdFields || [];
  const canEdit = !!profile?.canEdit;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  // Client-side check of the registration numbers (same rules as the server).
  const legalErrors = useMemo(() => {
    const out = {};
    for (const d of legalDefs) {
      const v = String(legalIds[d.key] || "").trim().toUpperCase().replace(/\s+/g, "");
      if (v && d.pattern && !new RegExp(d.pattern).test(v)) out[d.key] = `Should look like ${d.hint || "a valid number"}`;
    }
    return out;
  }, [legalDefs, legalIds]);

  if (!form || !profile) {
    return (
      <div className="flex justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  const changedText = TEXT_FIELDS.filter((k) => (form[k] || "") !== ((k === "country" ? profile.country : profile.raw?.[k]) || ""));
  const idsChanged = JSON.stringify(Object.fromEntries(Object.entries(legalIds).filter(([, v]) => v))) !==
    JSON.stringify(Object.fromEntries(Object.entries(profile.legalIds || {}).filter(([, v]) => v)));
  const daysChanged = [...weeklyOff].sort().join() !== [...(profile.weeklyOffDays || [])].sort().join();
  const savedWork = pickWork(profile);
  const changedWork = WORK_FIELDS.filter((k) => work[k] !== savedWork[k]);
  const workErrors = {};
  if (!(toMin(work.workEndTime) - toMin(work.workStartTime) >= 60)) workErrors.work = "End time must be at least 1 hour after start time";
  if (work.shortSaturday && !(toMin(work.saturdayEndTime) - toMin(work.saturdayStartTime) >= 60)) {
    workErrors.saturday = "End time must be at least 1 hour after start time";
  }
  const dirty =
    changedText.length > 0 || idsChanged || daysChanged || changedWork.length > 0 || Object.keys(images).length > 0;
  const countryChanged = form.country !== profile.country;

  const onCountry = (code) => {
    const c = countries.find((x) => x.code === code);
    setForm((f) => ({
      ...f,
      country: code,
      // Preset values for the new country (still editable).
      currencyCode: c?.currencyCode || f.currencyCode,
      // Only the number formats the server accepts (en-IN / en-US / de-DE / fr-FR).
      numberLocale: NUMBER_FORMATS.some((n) => n.locale === c?.numberLocale)
        ? c.numberLocale
        : c
          ? "en-US"
          : f.numberLocale,
      timeZone: c?.timeZone || f.timeZone,
    }));
    if (c) setWeeklyOff(c.weeklyOffDays);
  };

  const toggleDay = (d) =>
    setWeeklyOff((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()));

  const save = async () => {
    if (!form.name.trim()) {
      setSection("branding");
      return showToast("error", "Company name is required");
    }
    if (Object.keys(legalErrors).length) {
      setSection("legal");
      return showToast("error", "Please check the registration numbers");
    }
    if (Object.keys(workErrors).length) {
      setSection("work");
      return showToast("error", "Please check the working hours");
    }
    if (!weeklyOff.length && !window.confirm("No weekly off day is selected. Every day will be a working day. Continue?")) return;
    const body = {};
    changedText.forEach((k) => (body[k] = form[k]));
    if (idsChanged || countryChanged) body.legalIds = legalIds;
    if (daysChanged || countryChanged) body.weeklyOffDays = weeklyOff;
    if (changedWork.length) {
      // Times are always sent in pairs (the server checks start < end).
      body.workStartTime = work.workStartTime;
      body.workEndTime = work.workEndTime;
      body.shortSaturday = work.shortSaturday;
      body.saturdayStartTime = work.saturdayStartTime;
      body.saturdayEndTime = work.saturdayEndTime;
    }
    Object.assign(body, images);
    setSaving(true);
    try {
      const res = await companyService.updateProfile(body);
      const saved = res.data.data;
      setBrand(saved); // logo / colours / currency everywhere, right away
      if (isSuperAdminUser()) {
        const sel = getSelectedCompany();
        if (sel) setSelectedCompany({ ...sel, name: saved.name, logoUrl: saved.logoUrl, country: saved.country, primaryColor: saved.primaryColor });
      }
      showToast("success", "Company profile saved");
      await load();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Could not save the company profile");
    } finally {
      setSaving(false);
    }
  };

  const logoSrc = images.logoUrl !== undefined ? images.logoUrl : profile.raw?.logoUrl || (profile.logoUrl && /\/api\/company\/logo\//.test(profile.logoUrl) ? profile.logoUrl : "");
  const previewMoney = (v) => {
    const cur = findCurrency(form.currencyCode) || findCurrency("INR");
    try {
      return new Intl.NumberFormat(form.numberLocale || cur.locale, { style: "currency", currency: cur.code, currencyDisplay: "narrowSymbol" }).format(v);
    } catch {
      return `${cur.code} ${v}`;
    }
  };
  const zones = TIME_ZONES.includes(form.timeZone) || !form.timeZone ? TIME_ZONES : [form.timeZone, ...TIME_ZONES];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {logoSrc ? (
            <img src={logoSrc} alt="" className="h-12 w-16 object-contain rounded-lg border border-gray-200 bg-white p-1" />
          ) : (
            <span className="h-12 w-12 rounded-xl flex items-center justify-center text-white font-bold text-lg" style={{ backgroundColor: form.primaryColor || "#2563eb" }}>
              {(form.shortName || form.name || "?").charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-800 truncate flex items-center gap-2">
              {form.name || "Company profile"}
              {country && country.code !== "OTHER" && <span className={`fi fi-${country.code.toLowerCase()} rounded-sm`} />}
            </h1>
            <p className="text-sm text-gray-500">
              Company profile — used on the website, payslips, letters and the mobile app.
            </p>
          </div>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-[var(--brand-primary)] disabled:opacity-50"
          >
            <Save size={16} /> {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        ) : (
          <span className="inline-flex items-center gap-2 text-sm text-gray-500">
            <Lock size={14} /> View only
          </span>
        )}
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {SECTIONS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSection(t.key)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              section === t.key ? "border-[var(--brand-primary)] text-[var(--brand-primary)]" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <t.icon size={16} /> {t.label}
            {t.key === "legal" && Object.keys(legalErrors).length > 0 && <span className="h-2 w-2 rounded-full bg-red-500" />}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          {section === "branding" && (
            <>
              <ImageBox
                label="Logo"
                hint="PNG with a transparent background works best. Resized automatically."
                src={logoSrc}
                disabled={!canEdit}
                maxW={360}
                maxH={140}
                onPick={(v) => setImages((i) => ({ ...i, logoUrl: v }))}
                onRemove={() => setImages((i) => ({ ...i, logoUrl: "" }))}
              />
              <div className="grid sm:grid-cols-2 gap-4">
                <Text label="Company name" value={form.name} onChange={set("name")} maxLength={80} disabled={!canEdit} hint="Sidebar, login page, browser tab, PDFs" />
                <Text label="Short name" value={form.shortName} onChange={set("shortName")} maxLength={30} disabled={!canEdit} hint="Used where space is tight" />
                <Text label="Registered / legal name" value={form.legalName} onChange={set("legalName")} maxLength={160} disabled={!canEdit} placeholder="e.g. Acme Trading Co. LLC" />
                <Text label="Arabic name" value={form.nameAr} onChange={set("nameAr")} maxLength={160} disabled={!canEdit} dir="rtl" placeholder="الاسم بالعربية" hint="Shown on the login page (GCC companies)" />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Color label="Primary colour (buttons, links)" value={form.primaryColor} onChange={set("primaryColor")} disabled={!canEdit} />
                <Color label="Sidebar / letterhead colour" value={form.sidebarColor} onChange={set("sidebarColor")} disabled={!canEdit} />
              </div>
              <Text label="Login page title" value={form.loginTitle} onChange={set("loginTitle")} maxLength={80} disabled={!canEdit} />
              <Text label="Tagline" value={form.tagline} onChange={set("tagline")} maxLength={160} disabled={!canEdit} />
              <Text label="Login page notice" value={form.loginSubtitle} onChange={set("loginSubtitle")} maxLength={200} disabled={!canEdit} />
            </>
          )}

          {section === "contact" && (
            <>
              <Field label="Street address">
                <textarea rows={2} className={inputCls} value={form.address} maxLength={300} disabled={!canEdit} onChange={(e) => set("address")(e.target.value)} />
              </Field>
              <div className="grid sm:grid-cols-3 gap-4">
                <Text label="City" value={form.city} onChange={set("city")} maxLength={80} disabled={!canEdit} />
                <Text label={form.country === "IN" ? "State" : "Region / Province"} value={form.state} onChange={set("state")} maxLength={80} disabled={!canEdit} />
                <Text label={form.country === "IN" ? "PIN code" : "Postal code"} value={form.postalCode} onChange={set("postalCode")} maxLength={20} disabled={!canEdit} />
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <Text label="Phone" value={form.phone} onChange={set("phone")} maxLength={40} disabled={!canEdit} placeholder={country?.phoneCode ? `${country.phoneCode} …` : ""} />
                <Text label="E-mail" type="email" value={form.email} onChange={set("email")} maxLength={120} disabled={!canEdit} hint="Printed on letters" />
                <Text label="Website" value={form.website} onChange={set("website")} maxLength={120} disabled={!canEdit} />
              </div>
            </>
          )}

          {section === "legal" && (
            <>
              <p className="text-sm text-gray-500">
                Registration and tax numbers for <b>{country?.name || form.country}</b>. Numbers marked “printed” appear in the footer of letters and payslips.
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                {legalDefs.map((d) => (
                  <Field
                    key={d.key}
                    label={
                      <span className="flex items-center gap-2">
                        {d.label}
                        {d.print && <span className="text-[10px] font-semibold uppercase text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">printed</span>}
                      </span>
                    }
                    hint={d.hint}
                    error={legalErrors[d.key]}
                  >
                    <input
                      className={`${inputCls} font-mono uppercase ${legalErrors[d.key] ? "border-red-400" : ""}`}
                      value={legalIds[d.key] || ""}
                      maxLength={40}
                      disabled={!canEdit}
                      onChange={(e) => setLegalIds((ids) => ({ ...ids, [d.key]: e.target.value.toUpperCase() }))}
                    />
                  </Field>
                ))}
              </div>
            </>
          )}

          {section === "locale" && (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Country" hint="Sets the registration numbers, staff ID documents (Aadhaar / Iqama / QID) and default currency">
                  <select className={inputCls} value={form.country} disabled={!canEdit} onChange={(e) => onCountry(e.target.value)}>
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Time zone" hint="Attendance days, late marks and letter dates follow this">
                  <select className={inputCls} value={form.timeZone} disabled={!canEdit} onChange={(e) => set("timeZone")(e.target.value)}>
                    {zones.map((z) => (
                      <option key={z} value={z}>
                        {z.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Payroll currency">
                  <select className={inputCls} value={form.currencyCode} disabled={!canEdit} onChange={(e) => set("currencyCode")(e.target.value)}>
                    {/* The company's own currency is always in the list, even when it is
                        not one of the common ones (e.g. Yemeni rial). */}
                    {(CURRENCIES.some((c) => c.code === form.currencyCode) || !findCurrency(form.currencyCode)
                      ? CURRENCIES
                      : [findCurrency(form.currencyCode), ...CURRENCIES]
                    ).map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Number format" hint={`Example: ${previewMoney(123456.5)}`}>
                  <select className={inputCls} value={form.numberLocale} disabled={!canEdit} onChange={(e) => set("numberLocale")(e.target.value)}>
                    <option value="">Currency default</option>
                    {NUMBER_FORMATS.map((n) => (
                      <option key={n.locale} value={n.locale}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="text-sm text-gray-500">
                Weekly off days and office hours are in <b>Work week &amp; hours</b>.
              </p>
              {(countryChanged || form.timeZone !== profile.timeZone || daysChanged) && (
                <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertTriangle size={18} className="shrink-0" />
                  Changing the country, time zone or weekly off days changes how attendance, leave and payroll are calculated from now on. Past payroll already saved is not changed.
                </div>
              )}
            </>
          )}

          {section === "work" && (
            <>
              {/* A div, not <label>: a click on the title must not toggle the first day button. */}
              <div>
                <span className="block text-sm font-medium text-gray-700 mb-1">Weekly off days</span>
                <div className="flex flex-wrap gap-2">
                  {DAY_NAMES.map((name, d) => (
                    <button
                      key={name}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => toggleDay(d)}
                      className={`px-3 py-1.5 rounded-full text-sm border ${
                        weeklyOff.includes(d) ? "bg-[var(--brand-primary)] text-white border-transparent" : "bg-white text-gray-700 border-gray-300"
                      }`}
                    >
                      {name.slice(0, 3)}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {[
                    ["Sunday only", [0]],
                    ["Saturday + Sunday", [0, 6]],
                    ["Friday + Saturday", [5, 6]],
                    ["Friday only", [5]],
                  ].map(([label, days]) => (
                    <button
                      key={label}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setWeeklyOff(days)}
                      className="px-2.5 py-1 rounded-md text-xs border border-dashed border-gray-300 text-gray-600 hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] disabled:opacity-50"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="block text-xs text-gray-500 mt-1">
                  Tick every day the office is closed. For example India: Sunday (or Saturday + Sunday) · Saudi Arabia &amp;
                  Qatar: Friday + Saturday (Sunday is a working day). Used for attendance, leave and payroll.
                </span>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Office start time" error={workErrors.work}>
                  <input
                    type="time"
                    className={inputCls}
                    value={work.workStartTime}
                    disabled={!canEdit}
                    onChange={(e) => setWork((w) => ({ ...w, workStartTime: e.target.value }))}
                  />
                </Field>
                <Field
                  label="Office end time"
                  hint={netHours(work.workStartTime, work.workEndTime) ? `${netHours(work.workStartTime, work.workEndTime)} of work after the 1:30–2:15 PM lunch break` : ""}
                >
                  <input
                    type="time"
                    className={inputCls}
                    value={work.workEndTime}
                    disabled={!canEdit}
                    onChange={(e) => setWork((w) => ({ ...w, workEndTime: e.target.value }))}
                  />
                </Field>
              </div>
              <p className="text-xs text-gray-500 -mt-2">
                Every staff member's shift (unless you gave them their own shift), the late-coming check, the time
                needed before Sign Out, and the Login / Logout times filled in when attendance is marked or edited.
              </p>

              <div className={`rounded-lg border p-4 space-y-3 ${weeklyOff.includes(6) ? "bg-gray-50 border-gray-200" : "border-gray-200"}`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={work.shortSaturday && !weeklyOff.includes(6)}
                    disabled={!canEdit || weeklyOff.includes(6)}
                    onChange={(e) => setWork((w) => ({ ...w, shortSaturday: e.target.checked }))}
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-700">Short Saturday</span>
                    <span className="block text-xs text-gray-500">
                      {weeklyOff.includes(6)
                        ? "Saturday is a weekly off day, so this does not apply."
                        : "Saturday has its own (shorter) hours and any attendance on it counts as a full day. Untick to make Saturday a normal working day with the office hours above."}
                    </span>
                  </span>
                </label>
                {work.shortSaturday && !weeklyOff.includes(6) && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Saturday start time" error={workErrors.saturday}>
                      <input
                        type="time"
                        className={inputCls}
                        value={work.saturdayStartTime}
                        disabled={!canEdit}
                        onChange={(e) => setWork((w) => ({ ...w, saturdayStartTime: e.target.value }))}
                      />
                    </Field>
                    <Field label="Saturday end time">
                      <input
                        type="time"
                        className={inputCls}
                        value={work.saturdayEndTime}
                        disabled={!canEdit}
                        onChange={(e) => setWork((w) => ({ ...w, saturdayEndTime: e.target.value }))}
                      />
                    </Field>
                  </div>
                )}
              </div>

              {(daysChanged || changedWork.length > 0) && (
                <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertTriangle size={18} className="shrink-0" />
                  Changing weekly off days or office hours changes how attendance, late coming, leave and payroll are
                  calculated from now on. Past payroll already saved is not changed.
                </div>
              )}
            </>
          )}

          {section === "documents" && (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <Text label="Signatory name" value={form.signatoryName} onChange={set("signatoryName")} maxLength={80} disabled={!canEdit} placeholder="e.g. Faisal Al-Harbi" />
                <Text label="Signatory title" value={form.signatoryTitle} onChange={set("signatoryTitle")} maxLength={80} disabled={!canEdit} placeholder="e.g. HR Director" />
                <Text label="Payslip authoriser title" value={form.financeTitle} onChange={set("financeTitle")} maxLength={60} disabled={!canEdit} hint='Printed on payslips, e.g. "Finance Manager"' />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <ImageBox
                  label="Signature"
                  hint="PNG on a white / transparent background"
                  tall
                  src={images.signatureData !== undefined ? images.signatureData : profile.hasSignature ? "saved" : ""}
                  disabled={!canEdit}
                  maxW={420}
                  maxH={160}
                  onPick={(v) => setImages((i) => ({ ...i, signatureData: v }))}
                  onRemove={() => setImages((i) => ({ ...i, signatureData: "" }))}
                />
                <ImageBox
                  label="Company stamp / seal"
                  hint="Printed next to the signature on letters"
                  tall
                  src={images.stampData !== undefined ? images.stampData : profile.hasStamp ? "saved" : ""}
                  disabled={!canEdit}
                  maxW={300}
                  maxH={300}
                  onPick={(v) => setImages((i) => ({ ...i, stampData: v }))}
                  onRemove={() => setImages((i) => ({ ...i, stampData: "" }))}
                />
              </div>
            </>
          )}
        </div>

        {/* Live preview */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100">Preview</div>
            <div className="flex">
              <div className="w-24 p-3 space-y-2" style={{ backgroundColor: form.sidebarColor || "#0b1220" }}>
                <div className="h-6 rounded bg-white/90 flex items-center justify-center overflow-hidden">
                  {logoSrc ? <img src={logoSrc} alt="" className="max-h-5" /> : <span className="text-[10px] font-bold">{(form.shortName || form.name).slice(0, 8)}</span>}
                </div>
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className={`h-2 rounded ${i === 1 ? "bg-white/40" : "bg-white/15"}`} />
                ))}
              </div>
              <div className="flex-1 p-3 space-y-2">
                <div className="text-xs font-semibold text-gray-700 truncate">{form.name}</div>
                {form.nameAr && <div dir="rtl" className="text-xs text-gray-500 truncate">{form.nameAr}</div>}
                <div className="text-lg font-bold text-gray-800">{previewMoney(25000)}</div>
                <button type="button" className="text-[11px] px-2 py-1 rounded text-white" style={{ backgroundColor: form.primaryColor || "#2563eb" }}>
                  Button
                </button>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-gray-500">Country</span><span>{country?.name}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Currency</span><span>{form.currencyCode}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Time zone</span><span>{form.timeZone}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Weekly off</span><span>{weeklyOff.map((d) => DAY_NAMES[d].slice(0, 3)).join(" + ") || "None"}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Office hours</span><span>{formatHM(work.workStartTime)}–{formatHM(work.workEndTime)}</span></div>
            {work.shortSaturday && !weeklyOff.includes(6) && (
              <div className="flex justify-between"><span className="text-gray-500">Saturday</span><span>{formatHM(work.saturdayStartTime)}–{formatHM(work.saturdayEndTime)}</span></div>
            )}
            {profile.slug && (
              <div className="flex justify-between gap-2"><span className="text-gray-500">Login link</span><span className="truncate">/login?company={profile.slug}</span></div>
            )}
            {profile.maxStaff ? (
              <div className="flex justify-between"><span className="text-gray-500">Staff limit</span><span>{profile.maxStaff}</span></div>
            ) : null}
          </div>
          {!profile.isSuperAdmin && (
            <p className="text-xs text-gray-400 flex items-start gap-1.5">
              <Building2 size={14} className="shrink-0 mt-0.5" />
              Link name, tabs and staff limit are managed by your service provider.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}