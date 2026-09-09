// src/components/staff/StaffForm.jsx
import React, { useEffect, useState } from "react";
import { Eye, EyeOff, RefreshCw, Copy, Check } from "lucide-react";
import { useForm } from "../../hooks/useForm";
import { staffService } from "../../services/staffService";
import InputField from "../common/InputField";
import DatePicker from "../common/DatePicker";
import Button from "../common/Button";
import { showToast } from "../../utils/toast";
import {
  validateRequired,
  validateEmail,
  validatePhone,
  validatePassword,
} from "../../utils/validation";

const validate = (form, isEdit) => {
  const errors = {};
  if (!validateRequired(form.firstName))
    errors.firstName = "First name is required";
  if (!validateRequired(form.lastName))
    errors.lastName = "Last name is required";
  if (!validatePhone(form.contactNo))
    errors.contactNo = "Enter a valid contact number";
  if (!validateEmail(form.email)) errors.email = "Enter a valid email";
  if (!isEdit && !validatePassword(form.password)) {
    errors.password = "Password must be at least 6 characters";
  }
  // Relieving Date stays optional — at the point a staff member joins (or
  // even the moment their status is first switched to "Relieving") the
  // admin often doesn't know the exact last working day yet, so it can be
  // filled in later rather than blocking the save. It's just never
  // auto-filled with today's date on its own.
  return errors;
};

// New staff IDs start at ZS010 and count up from there.
const STAFF_ID_PREFIX = "ZS";
const STAFF_ID_START = 10;

const STATUS_OPTIONS = ["Probation", "Confirmation", "Relieving"];

const EMPLOYMENT_TYPE_OPTIONS = ["Project Basic", "Outsource Base"];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Adds `months` calendar months to a "YYYY-MM-DD" string and returns the
// result in the same format. Used to auto-derive the Probation End Date
// and Confirmation Date from the Joining Date + No. of Months.
function addMonths(dateStr, months) {
  if (!dateStr) return "";
  const n = Number(months);
  if (!Number.isFinite(n)) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

// Add days to a date
function addDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const StaffForm = ({
  initialData = null,
  onSubmit,
  onCancel,
  isEdit = false,

  onStaffIdChange,
}) => {
  const {
    form,
    errors,
    isSubmitting,
    setIsSubmitting,
    handleChange,
    setFields,
    validate: runValidate,
  } = useForm(
    {
      staffId: "",
      firstName: "",
      lastName: "",
      contactNo: "",
      email: "",
      password: "",
      date: "", // Joining Date
      dateOfBirth: "",
      status: "Probation",
      probationMonths: 3,
      probationEndDate: "",
      confirmationMonths: 3,
      confirmationDate: "",
      relievingDate: "",
      // Independent of `status` — an optional employment type, chosen via
      // radio buttons, that adds its own start/end date pair.
      employmentType: "", // "" | "Project Basic" | "Outsource Base"
      projectStartDate: "",
      projectEndDate: "",
    },
    (f) => validate(f, isEdit),
  );

  const [showPassword, setShowPassword] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  // Cosmetic preview only — the backend assigns the real ID at save time,
  // so this can occasionally be off by one if staff are added concurrently.
  const [previewId, setPreviewId] = useState("");

  // Status and Employment Type are mutually exclusive for a staff member —
  // only one of the two cards is active/editable at a time. The toggle
  // switch sitting on the right of the card header flips between them.
  const [activeSection, setActiveSection] = useState("status"); // "status" | "employment"

  // Passwords are hashed one-way on the server (bcrypt) — there is no stored
  // plaintext to fetch back and display. The only safe way to show an admin
  // a real password is to generate a brand new one right here, reveal it
  // once so they can copy it, then let the normal save flow hash it.
  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let pwd = "";
    for (let i = 0; i < 10; i++) {
      pwd += chars[Math.floor(Math.random() * chars.length)];
    }
    handleChange({ target: { name: "password", value: pwd } });
    setShowPassword(true);
    setJustGenerated(true);
    setCopied(false);
  };

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(form.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast("error", "Couldn't copy — please copy it manually");
    }
  };

  // Flip between the Status card and the Employment Type card. Whichever
  // side you're leaving gets its own fields cleared so a staff record never
  // ends up submitting stale data for the mode that's no longer active.
  const handleSectionToggle = () => {
    setActiveSection((prev) => {
      const next = prev === "status" ? "employment" : "status";
      if (next === "employment") {
        setFields({ relievingDate: "" });
      } else {
        setFields({
          employmentType: "",
          projectStartDate: "",
          projectEndDate: "",
        });
      }
      return next;
    });
  };

  useEffect(() => {
    if (initialData) {
      // Staff records only store a single combined name — split it back
      // into first/last for the two edit fields. Single-word names leave
      // lastName blank rather than repeating the first name.
      const nameParts = (initialData.staffName || "").trim().split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

      setFields({
        staffId: initialData.staffId || "",
        firstName,
        lastName,
        contactNo: initialData.contactNo || "",
        email: initialData.email || "",
        password: "",
        date: initialData.date ? initialData.date.slice(0, 10) : "",
        dateOfBirth: initialData.dateOfBirth
          ? initialData.dateOfBirth.slice(0, 10)
          : "",
        status: initialData.status || "Probation",
        probationMonths: initialData.probationMonths ?? 3,
        probationEndDate: initialData.probationEndDate
          ? initialData.probationEndDate.slice(0, 10)
          : "",
        confirmationMonths: initialData.confirmationMonths ?? 3,
        confirmationDate: initialData.confirmationDate
          ? initialData.confirmationDate.slice(0, 10)
          : "",
        relievingDate: initialData.relievingDate
          ? initialData.relievingDate.slice(0, 10)
          : "",
        employmentType: initialData.employmentType || "",
        projectStartDate: initialData.projectStartDate
          ? initialData.projectStartDate.slice(0, 10)
          : "",
        projectEndDate: initialData.projectEndDate
          ? initialData.projectEndDate.slice(0, 10)
          : "",
      });

      // If the record being edited already has an employment type, open the
      // form on that card instead of defaulting to Status.
      setActiveSection(initialData.employmentType ? "employment" : "status");
    }
  }, [initialData, setFields]);

  useEffect(() => {
    if (isEdit) return;
    let mounted = true;
    staffService
      .getAll()
      .then((res) => {
        if (!mounted) return;
        const list = res.data?.data ?? res.data ?? [];
        const count = Array.isArray(list) ? list.length : 0;
        setPreviewId(
          `${STAFF_ID_PREFIX}${String(STAFF_ID_START + count).padStart(3, "0")}`,
        );
      })
      .catch(() => {
        if (mounted) setPreviewId("");
      });
    return () => {
      mounted = false;
    };
  }, [isEdit]);

  // Push the Staff ID to display up to whoever owns the header (see
  // `onStaffIdChange` above) — the real id while editing, otherwise the
  // generated preview for a new staff member.
  useEffect(() => {
    if (!onStaffIdChange) return;
    onStaffIdChange(isEdit ? form.staffId : previewId);
  }, [isEdit, form.staffId, previewId, onStaffIdChange]);

  // Calculate Probation End Date = Joining Date + No. of Months - 1 day
  // Example: Joining Date: 1 Nov 2025 + 3 months = 1 Feb 2026 - 1 day = 31 Jan 2026
  useEffect(() => {
    if (activeSection !== "status" || form.status !== "Probation") return;
    if (!form.date) {
      setFields({ probationEndDate: "" });
      return;
    }
    // Calculate date after adding months, then subtract 1 day
    const dateAfterMonths = addMonths(form.date, form.probationMonths);
    if (dateAfterMonths) {
      const endDate = addDays(dateAfterMonths, -1);
      if (endDate !== form.probationEndDate) {
        setFields({ probationEndDate: endDate });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date, form.probationMonths, form.status, activeSection]);

  // Calculate Confirmation Date = Joining Date + No. of Months
  // Example: Joining Date: 1 Nov 2025 + 3 months = 1 Feb 2026
  useEffect(() => {
    if (activeSection !== "status" || form.status !== "Confirmation") return;
    if (!form.date) {
      setFields({ confirmationDate: "" });
      return;
    }
    const computed = addMonths(form.date, form.confirmationMonths);
    if (computed !== form.confirmationDate) {
      setFields({ confirmationDate: computed });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date, form.confirmationMonths, form.status, activeSection]);

  // Relieving Date is left blank until the admin actually picks one — it
  // must never be silently defaulted to "today". validate() below requires
  // it before the form can be submitted while Relieving is selected.

  // Project Start Date defaults to the Joining Date the first time an
  // employment type is picked, but the user can change it afterwards —
  // this effect never overwrites a value that's already been set.
  useEffect(() => {
    if (activeSection === "employment" && form.employmentType && !form.projectStartDate) {
      setFields({ projectStartDate: form.date || todayStr() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.employmentType, form.date, activeSection]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!runValidate()) return;

    try {
      setIsSubmitting(true);
      const payload = { ...form };
      if (isEdit && !payload.password) delete payload.password;

      // Only the active section's data is meaningful — strip the other
      // side out of the payload rather than sending stale values.
      if (activeSection === "status") {
        payload.employmentType = "";
        payload.projectStartDate = "";
        payload.projectEndDate = "";
      } else {
        payload.relievingDate = "";
      }

      if (isEdit && initialData?._id) {
        await staffService.update(initialData._id, payload);
      } else {
        await staffService.create(payload);
      }
      onSubmit();
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to save staff member",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle status selection
  const handleStatusSelect = (status) => {
    setFields({ status });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* First Name / Last Name */}
      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="First Name"
          name="firstName"
          value={form.firstName}
          onChange={handleChange}
          error={errors.firstName}
          required
        />
        <InputField
          label="Last Name"
          name="lastName"
          value={form.lastName}
          onChange={handleChange}
          error={errors.lastName}
          required
        />
      </div>

      {/* Contact Number / Joining Date */}
      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="Contact Number"
          name="contactNo"
          value={form.contactNo}
          onChange={handleChange}
          error={errors.contactNo}
          required
        />
        <DatePicker
          label="Joining Date"
          name="date"
          value={form.date}
          onChange={handleChange}
        />
      </div>

      {/* Date of Birth */}
      <div className="grid grid-cols-2 gap-4">
        <DatePicker
          label="Date of Birth"
          name="dateOfBirth"
          value={form.dateOfBirth}
          onChange={handleChange}
        />
      </div>

      {/* Email / Password */}
      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="Email"
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          error={errors.email}
          required
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {isEdit ? "New Password (optional)" : "Password"}
            {!isEdit && <span className="text-red-500"> *</span>}
          </label>
          <div className="relative">
            <InputField
              name="password"
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(e) => {
                setJustGenerated(false);
                handleChange(e);
              }}
              error={errors.password}
              placeholder={
                isEdit ? "Leave blank to keep current password" : ""
              }
              className={isEdit ? "pr-20" : "pr-10"}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {isEdit && justGenerated && form.password && (
                <button
                  type="button"
                  onClick={copyPassword}
                  title="Copy password"
                  className="text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {copied ? (
                    <Check size={16} className="text-green-600" />
                  ) : (
                    <Copy size={16} />
                  )}
                </button>
              )}
              {isEdit && (
                <button
                  type="button"
                  onClick={generatePassword}
                  title="Generate a new password"
                  className="text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  <RefreshCw size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? "Hide password" : "Show password"}
                className="text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          {isEdit && justGenerated && form.password && (
            <p className="text-xs text-amber-600 mt-1">
              Copy this now — it won't be shown again once you save.
            </p>
          )}
        </div>
      </div>

      {/* Status / Employment Type — mutually exclusive, switched with the
          toggle on the right of the card header. */}
      <div className="rounded-lg border border-gray-200 p-4 bg-gray-50">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium text-gray-700">
            {activeSection === "status" ? "Status" : "Employment Type"}
          </label>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs ${
                activeSection === "status"
                  ? "text-blue-600 font-medium"
                  : "text-gray-400"
              }`}
            >
              Status
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={activeSection === "employment"}
              onClick={handleSectionToggle}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                activeSection === "employment" ? "bg-blue-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  activeSection === "employment"
                    ? "translate-x-6"
                    : "translate-x-1"
                }`}
              />
            </button>
            <span
              className={`text-xs ${
                activeSection === "employment"
                  ? "text-blue-600 font-medium"
                  : "text-gray-400"
              }`}
            >
              Employment Type
            </span>
          </div>
        </div>

        {activeSection === "status" ? (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {STATUS_OPTIONS.map((status) => (
                <div
                  key={status}
                  onClick={() => handleStatusSelect(status)}
                  className={`cursor-pointer rounded-lg border-2 p-3 text-center transition-all ${
                    form.status === status
                      ? "border-blue-500 bg-blue-50 shadow-sm"
                      : "border-gray-200 hover:border-gray-300 hover:bg-white"
                  }`}
                >
                  <span
                    className={`text-sm font-medium ${
                      form.status === status
                        ? "text-blue-700"
                        : "text-gray-700"
                    }`}
                  >
                    {status}
                  </span>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-gray-200 p-4 bg-white">
              {form.status === "Probation" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        No. of Months
                      </label>
                      <input
                        type="number"
                        min={1}
                        name="probationMonths"
                        value={form.probationMonths}
                        onChange={handleChange}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Probation End Date
                      </label>
                      <div className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-600">
                        {formatDisplayDate(form.probationEndDate)}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 bg-blue-50 p-2 rounded border border-blue-100">
                    <p className="font-medium text-blue-700">
                      How it's calculated:
                    </p>
                    <p>
                      Probation End Date = Joining Date +{" "}
                      {form.probationMonths} months - 1 day
                    </p>
                    {form.date && form.probationEndDate && (
                      <p className="mt-1">
                        Example: {formatDisplayDate(form.date)} +{" "}
                        {form.probationMonths} months ={" "}
                        {formatDisplayDate(
                          addMonths(form.date, form.probationMonths),
                        )}{" "}
                        - 1 day = {formatDisplayDate(form.probationEndDate)}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {form.status === "Confirmation" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        No. of Months
                      </label>
                      <input
                        type="number"
                        min={1}
                        name="confirmationMonths"
                        value={form.confirmationMonths}
                        onChange={handleChange}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Confirmation Date
                      </label>
                      <div className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-600">
                        {formatDisplayDate(form.confirmationDate)}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 bg-green-50 p-2 rounded border border-green-100">
                    <p className="font-medium text-green-700">
                      How it's calculated:
                    </p>
                    <p>
                      Confirmation Date = Joining Date +{" "}
                      {form.confirmationMonths} months
                    </p>
                    {form.date && form.confirmationDate && (
                      <p className="mt-1">
                        Example: {formatDisplayDate(form.date)} +{" "}
                        {form.confirmationMonths} months ={" "}
                        {formatDisplayDate(form.confirmationDate)}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {form.status === "Relieving" && (
                <div className="space-y-3">
                  <DatePicker
                    label="Relieving Date"
                    name="relievingDate"
                    value={form.relievingDate}
                    onChange={handleChange}
                  />
                  <div className="text-xs text-gray-500 bg-orange-50 p-2 rounded border border-orange-100">
                    <p className="font-medium text-orange-700">
                      Information:
                    </p>
                    <p>
                      Select the leaving date for this staff member once
                      it's known — it won't be filled in automatically, and
                      you can leave it blank for now and add it later. This
                      marks their last working day.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-gray-200 p-4 bg-white">
            <div className="flex items-center gap-6 mb-3">
              {EMPLOYMENT_TYPE_OPTIONS.map((opt) => (
                <label
                  key={opt}
                  className="flex items-center gap-2 text-sm text-gray-700"
                >
                  <input
                    type="radio"
                    name="employmentType"
                    value={opt}
                    checked={form.employmentType === opt}
                    onChange={handleChange}
                    className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  {opt}
                </label>
              ))}
            </div>

            {form.employmentType && (
              <div className="grid grid-cols-2 gap-4">
                <DatePicker
                  label="Start Date"
                  name="projectStartDate"
                  value={form.projectStartDate}
                  onChange={handleChange}
                />
                <DatePicker
                  label="End Date"
                  name="projectEndDate"
                  value={form.projectEndDate}
                  onChange={handleChange}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={isSubmitting}>
          {isEdit ? "Update Staff" : "Add Staff"}
        </Button>
      </div>
    </form>
  );
};

export default StaffForm;