// utils/letterFields.js
//
// What the "Generate letter" form asks for, per letter (offer / joining /
// confirmation), and how the answers are stored.
//
// Every field gets its CURRENT value from (first match wins):
//   1. what was typed the last time this letter was generated
//      (Staff.issuedLetters[].details), then
//   2. the staff profile (name, gender, designation, department, dates,
//      mobile, address…), then
//   3. Staff Basic Payroll (salary) / My Documents (Aadhaar, PAN), then
//   4. a sensible default (letter date, trial days, work schedule…).
//
// A field is MISSING when it is needed for the letter and still has no
// value — only missing fields are shown in the form, so data that already
// exists for the staff member is never asked for again. (The form has a
// "Show all details" switch to correct anything else before generating.)
//
// On generate: profile fields that were EMPTY on the staff record are saved
// to the staff record (so they are known next time); every value is also
// kept with the issued letter, so the PDF always shows exactly what HR
// entered.

// ── Field catalogue ───────────────────────────────────────────────────────
// profile: true  → lives on the Staff record (filled in there if empty)
// ask: "required" → must have a value before the letter can be generated
//      "ifEmpty"  → asked when empty, but may be left blank
//      false      → never asked (has a default) — shown under "all details"
const FIELD_DEFS = {
  staffName: { label: "Full name (as on the letter)", kind: "text", profile: true, placeholder: "e.g. Mohammed Akram Idrisi" },
  gender: {
    label: "Gender (for Mr. / Ms.)",
    kind: "select",
    options: [
      { value: "Male", label: "Male — Mr." },
      { value: "Female", label: "Female — Ms." },
    ],
    profile: true,
  },
  designation: { label: "Designation / Post", kind: "text", profile: true, placeholder: "e.g. Full Stack developer & Software Engineer" },
  department: { label: "Department / Team", kind: "text", profile: true, placeholder: "e.g. Programming team" },
  date: { label: "Date of joining", kind: "date", profile: true },
  probationMonths: { label: "Probation (months)", kind: "number", profile: true, min: 1, max: 12 },
  confirmationDate: { label: "Confirmation / start date", kind: "date", profile: true },
  workSchedule: {
    label: "Work schedule",
    kind: "text",
    profile: true,
    placeholder: "e.g. Full time / Mon till Saturday / 10.00 AM till 6.30 PM",
  },
  contactNo: { label: "Mobile", kind: "text", profile: true, placeholder: "+91 91368 69647" },
  email: { label: "Email", kind: "text", profile: false },
  address: { label: "Permanent address", kind: "textarea", profile: true },
  currentAddress: { label: "Current address (blank = Same As Above)", kind: "textarea", profile: true },
  aadhaar: { label: "Aadhaar No.", kind: "text", profile: false, placeholder: "5742 7768 2776" },
  pan: { label: "PAN", kind: "text", profile: false, placeholder: "ANCPI2357P" },
  salaryRows: { label: "Monthly salary during probation", kind: "salaryRows", profile: false },
  salary: { label: "Monthly salary (₹)", kind: "number", profile: false, min: 0 },
  trialDays: { label: "Trial period (working days)", kind: "number", profile: false, min: 1, max: 60 },
  signatory: { label: "Signed by (name under Admin Team)", kind: "text", profile: false, placeholder: "e.g. Amit" },
  letterDate: { label: "Date on the letter", kind: "date", profile: false },
};

// Which fields each letter uses, and whether they are asked.
const LETTER_FIELDS = {
  offer: [
    ["staffName", "required"],
    ["gender", "required"],
    ["designation", "required"],
    ["department", "ifEmpty"],
    ["date", "required"],
    ["probationMonths", "required"],
    ["salaryRows", "required"],
    ["contactNo", "ifEmpty"],
    ["email", "ifEmpty"],
    ["aadhaar", "ifEmpty"],
    ["pan", "ifEmpty"],
    ["address", "ifEmpty"],
    ["currentAddress", false],
    ["workSchedule", false],
    ["letterDate", false],
  ],
  joining: [
    ["staffName", "required"],
    ["gender", "required"],
    ["designation", "required"],
    ["date", "required"],
    ["address", "ifEmpty"],
    ["trialDays", false],
    ["department", false],
    ["salary", false],
    ["signatory", false],
    ["letterDate", false],
  ],
  confirmation: [
    ["staffName", "required"],
    ["gender", "required"],
    ["designation", "required"],
    ["department", "ifEmpty"],
    ["confirmationDate", "required"],
    ["salary", "required"],
    ["contactNo", "ifEmpty"],
    ["email", "ifEmpty"],
    ["aadhaar", "ifEmpty"],
    ["pan", "ifEmpty"],
    ["address", "ifEmpty"],
    ["currentAddress", false],
    ["workSchedule", false],
    ["signatory", false],
    ["letterDate", false],
  ],
};

export const FORM_LETTERS = Object.keys(LETTER_FIELDS);

// ── Value helpers ─────────────────────────────────────────────────────────
/** Any date -> "YYYY-MM-DD" (India calendar day), or "". */
export const ymd = (v) => {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
};

const isEmpty = (v) =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && (v.length === 0 || v.every((x) => isEmpty(x))));

const normGender = (g) => {
  const s = String(g || "").trim().toLowerCase();
  if (s === "male" || s === "m" || s === "mr" || s === "mr.") return "Male";
  if (s === "female" || s === "f" || s === "ms" || s === "ms." || s === "mrs" || s === "mrs.") return "Female";
  return "";
};

const cleanNumber = (v) => {
  if (isEmpty(v)) return "";
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : "";
};

/** Normalise one submitted value by field kind. */
export const normaliseValue = (key, value) => {
  const def = FIELD_DEFS[key];
  if (!def) return undefined;
  if (key === "gender") return normGender(value);
  if (def.kind === "date") return ymd(value);
  if (def.kind === "number") return cleanNumber(value);
  if (def.kind === "salaryRows") {
    const arr = Array.isArray(value) ? value : [];
    return arr.slice(0, 12).map((x) => cleanNumber(x));
  }
  if (key === "aadhaar") {
    const digits = String(value || "").replace(/\s+/g, "");
    return /^\d{12}$/.test(digits) ? digits.replace(/(\d{4})(?=\d)/g, "$1 ") : String(value || "").trim();
  }
  if (key === "pan") return String(value || "").trim().toUpperCase();
  return String(value ?? "").trim();
};

// ── Current values for one staff member + letter ──────────────────────────
/**
 * ctx = { staff (lean), saved (details from the last issue of this letter),
 *         salaryAt(date) -> amount|null, ids: { aadhaar, pan }, company }
 */
export const currentValues = (type, ctx) => {
  const { staff = {}, saved = {}, salaryAt = () => null, ids = {}, company = {} } = ctx;
  const has = (k) => saved && !isEmpty(saved[k]);
  const pick = (k, fromProfile) => (has(k) ? saved[k] : fromProfile);

  const probationMonths = Number(pick("probationMonths", staff.probationMonths)) || 3;
  const joinYmd = ymd(pick("date", staff.date));

  // Salary rows: one amount per probation month, read from Staff Basic
  // Payroll at that point of the probation (blank when there's no payroll).
  let salaryRows = has("salaryRows") ? [...saved.salaryRows] : [];
  if (!salaryRows.length || salaryRows.every((x) => isEmpty(x))) {
    salaryRows = [];
    for (let i = 0; i < probationMonths; i++) {
      const at = joinYmd ? new Date(new Date(`${joinYmd}T06:30:00Z`).getTime() + i * 30 * 86400000) : null;
      const amt = at ? salaryAt(at) : null;
      salaryRows.push(amt ? Number(amt) : "");
    }
  }
  while (salaryRows.length < probationMonths) salaryRows.push(salaryRows[salaryRows.length - 1] ?? "");
  salaryRows = salaryRows.slice(0, probationMonths);

  const confYmd = ymd(pick("confirmationDate", staff.confirmationDate));
  const salaryDate = type === "confirmation" ? confYmd || ymd(new Date()) : joinYmd || ymd(new Date());
  const payrollSalary = salaryAt(new Date(`${salaryDate}T06:30:00Z`));

  const defaultLetterDate =
    type === "confirmation" ? confYmd || ymd(new Date()) : joinYmd || ymd(new Date());

  return {
    staffName: pick("staffName", staff.staffName || ""),
    gender: normGender(pick("gender", staff.gender)),
    designation: pick("designation", staff.designation || ""),
    department: pick("department", staff.department || ""),
    date: joinYmd,
    probationMonths,
    confirmationDate: confYmd,
    workSchedule: pick("workSchedule", staff.workSchedule || ""),
    contactNo: pick("contactNo", staff.contactNo || ""),
    email: pick("email", staff.email || ""),
    address: pick("address", staff.address || ""),
    currentAddress: pick("currentAddress", staff.currentAddress || ""),
    aadhaar: pick("aadhaar", ids.aadhaar || ""),
    pan: pick("pan", ids.pan || ""),
    salaryRows,
    salary: pick("salary", payrollSalary ? Number(payrollSalary) : ""),
    trialDays: Number(pick("trialDays", 10)) || 10,
    signatory: pick("signatory", company.signatory || ""),
    letterDate: ymd(pick("letterDate", defaultLetterDate)),
  };
};

/** Form description: [{ key, label, kind, required, missing, value, … }] */
export const describeFields = (type, values) =>
  (LETTER_FIELDS[type] || []).map(([key, ask]) => {
    const def = FIELD_DEFS[key];
    const value = values[key];
    return {
      key,
      label: def.label,
      kind: def.kind,
      options: def.options,
      placeholder: def.placeholder,
      min: def.min,
      max: def.max,
      profile: !!def.profile,
      required: ask === "required",
      // Shown in the form only when it has no value yet.
      missing: !!ask && isEmpty(value),
      value,
    };
  });

/**
 * Merge submitted answers over the current values.
 * Returns { values, errors[], profileUpdates } — profileUpdates only holds
 * profile fields that are EMPTY on the staff record today.
 */
export const applyAnswers = (type, current, answers = {}, staff = {}) => {
  const values = { ...current };
  for (const [key] of LETTER_FIELDS[type] || []) {
    if (!(key in answers)) continue;
    const v = normaliseValue(key, answers[key]);
    if (v !== undefined) values[key] = v;
  }
  // Keep the salary table in step with the probation length.
  if (type === "offer") {
    const n = Number(values.probationMonths) || 3;
    const rows = Array.isArray(values.salaryRows) ? [...values.salaryRows] : [];
    while (rows.length < n) rows.push(rows[rows.length - 1] ?? "");
    values.salaryRows = rows.slice(0, n);
  }

  const errors = [];
  for (const [key, ask] of LETTER_FIELDS[type] || []) {
    if (ask !== "required") continue;
    const v = values[key];
    const empty = FIELD_DEFS[key].kind === "salaryRows" ? !Array.isArray(v) || v.some((x) => isEmpty(x)) : isEmpty(v);
    if (empty) errors.push(`${FIELD_DEFS[key].label} is required`);
  }

  const profileUpdates = {};
  for (const [key] of LETTER_FIELDS[type] || []) {
    const def = FIELD_DEFS[key];
    if (!def.profile || isEmpty(values[key])) continue;
    const onRecord = key === "date" || key === "confirmationDate" ? ymd(staff[key]) : staff[key];
    if (!isEmpty(onRecord) && !(key === "gender" && !normGender(onRecord))) continue;
    if (def.kind === "date") profileUpdates[key] = new Date(`${values[key]}T00:00:00.000Z`);
    else if (def.kind === "number") profileUpdates[key] = Number(values[key]);
    else profileUpdates[key] = values[key];
  }
  return { values, errors, profileUpdates };
};

/** Staff object the PDF renderers expect, with the letter's values on top. */
export const staffForLetter = (staff, values) => ({
  ...staff,
  staffName: values.staffName || staff.staffName,
  gender: values.gender || staff.gender,
  designation: values.designation || staff.designation,
  department: values.department ?? staff.department,
  date: values.date ? new Date(`${values.date}T00:00:00.000Z`) : staff.date,
  probationMonths: Number(values.probationMonths) || staff.probationMonths,
  confirmationDate: values.confirmationDate ? new Date(`${values.confirmationDate}T00:00:00.000Z`) : staff.confirmationDate,
  workSchedule: values.workSchedule ?? staff.workSchedule,
  contactNo: values.contactNo ?? staff.contactNo,
  email: values.email || staff.email,
  address: values.address ?? staff.address,
  currentAddress: values.currentAddress ?? staff.currentAddress,
});
