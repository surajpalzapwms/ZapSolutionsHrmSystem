// src/components/staff/LetterDetailsModal.jsx
// Opens when HR clicks "Generate" for any of the six letters (Offer /
// Joining / Confirmation / Termination / Leaving / Experience). The backend says which details the letter needs and which of them
// are still MISSING for this staff member (GET …/:type/form) — only those
// are asked. Anything already on the staff profile, in Staff Basic Payroll
// or My Documents, or typed the last time this letter was generated, is not
// asked again ("Show all details" lets HR correct it anyway).
//
// e.g. Offer Letter for a new joiner: Full name "Mohammed Akram Idrisi",
// Gender → Mr. / Ms., Designation "Full Stack developer & Software
// Engineer", salary for each probation month, Aadhaar, PAN, address.
import React, { useEffect, useMemo, useState } from "react";
import { FilePlus2 } from "lucide-react";
import Modal from "../common/Modal";
import Spinner from "../common/Spinner";
import PhoneInput from "../common/PhoneInput";
import { letterService } from "../../services/letterService";
import { showToast } from "../../utils/toast";

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

const ROW_LABELS = (n) =>
  Array.from({ length: n }, (_, i) => (i === 0 ? "Days 1 – 30/31" : `Days ${i === 1 ? "31/32" : i * 30 + 1} – ${(i + 1) * 30}`));

const isBlank = (v) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.some((x) => x === "" || x === null || x === undefined));

const Field = ({ field, value, onChange, probationMonths }) => {
  const label = (
    <span className="block text-xs font-medium text-gray-600 mb-1">
      {field.label}
      {field.required && <span className="text-red-500"> *</span>}
    </span>
  );
  const hint = field.hint ? <span className="block text-[11px] text-blue-600 mt-1">{field.hint}</span> : null;

  if (field.kind === "select") {
    return (
      <label className="block">
        {label}
        <select className={inputCls} value={value || ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(field.options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.kind === "phone") {
    return (
      <div className="block">
        {label}
        <PhoneInput
          name={field.key || "phone"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || "Phone number"}
        />
        {hint}
      </div>
    );
  }

  if (field.kind === "textarea") {
    return (
      <label className="block sm:col-span-2">
        {label}
        <textarea className={inputCls} rows={2} value={value || ""} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
        {hint}
      </label>
    );
  }

  if (field.kind === "salaryRows") {
    const n = Math.max(1, Math.min(12, Number(probationMonths) || 3));
    const rows = Array.from({ length: n }, (_, i) => (Array.isArray(value) ? value[i] ?? "" : ""));
    const labels = ROW_LABELS(n);
    return (
      <div className="sm:col-span-2">
        {label}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {rows.map((v, i) => (
            <label key={i} className="block">
              <span className="block text-[11px] text-gray-500 mb-0.5">{labels[i]}</span>
              <input
                className={inputCls}
                inputMode="numeric"
                value={v}
                placeholder="e.g. 20000"
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = e.target.value;
                  onChange(next);
                }}
              />
            </label>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-1">
          Printed in the salary table; "{n * 30 + 1} onwards" stays T.B.D. [Subject to appraisal].
        </p>
      </div>
    );
  }

  // Dates: no min / max — any past, current or future date can be chosen.
  return (
    <label className={`block ${field.hint ? "sm:col-span-2" : ""}`}>
      {label}
      <input
        className={inputCls}
        type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"}
        min={field.kind === "date" ? undefined : field.min}
        max={field.kind === "date" ? undefined : field.max}
        value={value ?? ""}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint}
    </label>
  );
};

/**
 * Props: isOpen, onClose, staff, letter ({ type, title }), onGenerated(rows)
 * `form` (optional) — the form already fetched by the caller.
 */
const LetterDetailsModal = ({ isOpen, onClose, staff, letter, form: initialForm = null, onGenerated }) => {
  const [form, setForm] = useState(initialForm);
  const [values, setValues] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !letter || !staff?._id) return;
    let cancelled = false;
    const apply = (f) => {
      setForm(f);
      setValues(Object.fromEntries((f?.fields || []).map((x) => [x.key, x.value])));
      setShowAll(!f?.missingCount);
    };
    if (initialForm) {
      apply(initialForm);
      return undefined;
    }
    setLoading(true);
    letterService
      .getForm(staff._id, letter.type)
      .then((res) => !cancelled && apply(res.data?.data))
      .catch((err) => !cancelled && showToast("error", err.response?.data?.message || "Failed to load letter details"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isOpen, letter, staff, initialForm]);

  const fields = form?.fields || [];
  // The last working day is always shown on Termination / Leaving /
  // Experience letters, so HR can see (and change) the date being printed.
  const shown = useMemo(
    () => (showAll ? fields : fields.filter((f) => f.missing || f.key === "lastWorkingDay")),
    [fields, showAll],
  );
  const hiddenCount = fields.length - fields.filter((f) => f.missing).length;

  const title = values.gender === "Female" ? "Ms." : values.gender === "Male" ? "Mr." : "";
  const preview = [title, values.staffName].filter(Boolean).join(" ");

  const submit = async (e) => {
    e?.preventDefault();
    const missingRequired = fields.filter((f) => f.required && isBlank(values[f.key]));
    if (missingRequired.length) {
      showToast("error", `Please fill in: ${missingRequired.map((f) => f.label).join(", ")}`);
      return;
    }
    try {
      setSaving(true);
      const res = await letterService.issue(staff._id, letter.type, values);
      showToast("success", `${letter.title} generated — now enabled for ${values.staffName || staff.staffName}`);
      onGenerated?.(res.data?.data || []);
      onClose();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to generate letter");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={letter ? `${letter.title} — details` : "Letter details"}
      size="max-w-2xl"
      actions={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || loading || !form}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <FilePlus2 size={16} /> {saving ? "Generating…" : "Generate letter"}
          </button>
        </>
      }
    >
      {loading || !form ? (
        <Spinner />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {form.missingCount ? (
            <p className="text-sm text-gray-600">
              {form.missingCount} detail{form.missingCount === 1 ? " is" : "s are"} missing for this letter. Details
              already saved for {staff.staffName} are filled in automatically.
            </p>
          ) : (
            <p className="text-sm text-green-700">All details are already saved — check them and generate.</p>
          )}

          {preview && (
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
              Letter will say: <b>Dear {preview},</b>
              {values.designation ? (
                <>
                  {" "}· post <b>{values.designation}</b>
                </>
              ) : null}
              {values.lastWorkingDay ? (
                <>
                  {" "}· last working day{" "}
                  <b>
                    {new Date(`${values.lastWorkingDay}T00:00:00`).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </b>
                </>
              ) : null}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {shown.map((f) => (
              <Field
                key={f.key}
                field={f}
                value={values[f.key]}
                probationMonths={values.probationMonths}
                onChange={(v) => setValues((cur) => ({ ...cur, [f.key]: v }))}
              />
            ))}
          </div>

          {hiddenCount > 0 && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="text-xs font-medium text-blue-600 hover:underline">
              {showAll ? "Show only missing details" : `Show all details (${hiddenCount} already filled)`}
            </button>
          )}
          <p className="text-[11px] text-gray-400">
            Empty profile details you enter here (gender, designation, department, address…) are also saved to the staff
            profile.
          </p>
        </form>
      )}
    </Modal>
  );
};

export default LetterDetailsModal;
