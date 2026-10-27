// src/components/staff/StaffForm.jsx
import React, { useEffect, useState } from "react";
import { Eye, EyeOff, RefreshCw, Copy, Check, RotateCcw } from "lucide-react";
import { useForm } from "../../hooks/useForm";
import { staffService } from "../../services/staffService";
import InputField from "../common/InputField";
import PhoneInput from "../common/PhoneInput";
import DatePicker from "../common/DatePicker";
import Select from "../common/Select";
import Button from "../common/Button";
import { showToast } from "../../utils/toast";
import { leftBeforeConfirmation } from "../../utils/staffStatus";
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
  // Confirmation can never be before the joining date.
  if (form.date && form.confirmationDate && form.confirmationDate < form.date) {
    errors.confirmationDate = "Confirmation Date can't be before Joining Date";
  }
  if (form.date && form.probationEndDate && form.probationEndDate < form.date) {
    errors.probationEndDate = "Probation End Date can't be before Joining Date";
  }
  // Internship (optional — only when the "has internship" box is ticked).
  // Joining Date -> Internship End -> Probation End.
  if (form.hasInternship && form.status === "Internship" && !form.internshipEndDate) {
    errors.internshipEndDate = "Internship End Date is required";
  }
  if (form.date && form.internshipEndDate && form.internshipEndDate < form.date) {
    errors.internshipEndDate = "Internship End Date can't be before Joining Date";
  }
  if (
    form.internshipEndDate &&
    form.probationEndDate &&
    form.probationEndDate < form.internshipEndDate
  ) {
    errors.probationEndDate =
      "Probation End Date can't be before Internship End Date";
  }
  // Relieved Date stays optional — it can be filled in later.
  return errors;
};

// New staff IDs start at ZS010 and count up from there.
const STAFF_ID_PREFIX = "ZS";
const STAFF_ID_START = 10;
const STATUS_OPTIONS = ["Internship", "Probation", "Confirmation", "Relieved"];

const EMPLOYMENT_TYPE_OPTIONS = ["Project Basic", "Outsource Base"];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// All date math below is done in UTC on "YYYY-MM-DD" strings so the result
// never shifts by a day because of the browser's timezone (e.g. IST).
function parseYMD(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return null;
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

function toYMD(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

// Adds `months` calendar months. 26 Jun 2025 + 3 = 26 Sep 2025.
// If the target month is shorter (31 Jan + 1), it clamps to the month end.
function addMonths(dateStr, months) {
  const p = parseYMD(dateStr);
  const n = Number(months);
  if (!p || !Number.isFinite(n)) return "";
  const targetMonthIndex = p.m - 1 + n;
  const lastDay = new Date(Date.UTC(p.y, targetMonthIndex + 1, 0)).getUTCDate();
  return toYMD(
    new Date(Date.UTC(p.y, targetMonthIndex, Math.min(p.d, lastDay))),
  );
}

function addDays(dateStr, days) {
  const p = parseYMD(dateStr);
  if (!p) return "";
  return toYMD(new Date(Date.UTC(p.y, p.m - 1, p.d + days)));
}

function formatDisplayDate(dateStr) {
  const p = parseYMD(dateStr);
  if (!p) return "—";
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// A date "has passed" if it's strictly before today. Today itself counts
// as NOT passed — the status change is treated as happening right now.
function isDatePassed(dateStr) {
  if (!dateStr) return false;
  return dateStr.slice(0, 10) < todayStr();
}

// Internship starts on the joining date. Probation then starts the day AFTER
// the internship ends. With no internship, probation starts on the joining
// date (the original behaviour).
const probationBase = (joinDate, internshipEndDate) =>
  internshipEndDate ? addDays(internshipEndDate, 1) : joinDate;

// Default (auto) dates. `startDate` for probation/confirmation is the
// probation start date — see probationBase().
const autoInternshipEndDate = (joinDate, months) => {
  const afterMonths = addMonths(joinDate, months);
  return afterMonths ? addDays(afterMonths, -1) : "";
};
const autoConfirmationDate = (startDate, months) => addMonths(startDate, months);
const autoProbationEndDate = (startDate, months) => {
  const afterMonths = addMonths(startDate, months);
  return afterMonths ? addDays(afterMonths, -1) : "";
};

// Random 10-char login password (no look-alike characters such as 0/O, 1/l).
const makePassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
};

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
      // New staff get a password generated up front (admin can still
      // change it); it is saved with the record and shown in History.
      password: isEdit ? "" : makePassword(),
      date: "", // Joining Date
      dateOfBirth: "",
      gender: "", // Male -> "Mr.", Female -> "Ms."
      designation: "",
      department: "",
      address: "",
      currentAddress: "",
      workSchedule: "",
      status: "Probation",
      hasInternship: false, // checkbox: does this staff member have an internship?
      internshipMonths: 3,
      internshipEndDate: "",
      probationMonths: 3,
      probationEndDate: "",
      confirmationMonths: 3,
      confirmationDate: "",
      relievingDate: "",
      employmentType: "", // "" | "Project Basic" | "Outsource Base"
      projectStartDate: "",
      projectEndDate: "",
    },
    (f) => validate(f, isEdit),
  );

  const [showPassword, setShowPassword] = useState(!isEdit);
  const [justGenerated, setJustGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewId, setPreviewId] = useState("");
  const [activeSection, setActiveSection] = useState("status"); // "status" | "employment"

  // true = admin picked the date on the calendar, so it must NOT be
  // recalculated when the joining date or months change.
  // Example: joined 26 Jun 2025, auto confirmation 26 Sep 2025, but the
  // admin actually confirmed on 1 Oct 2025 → stays 1 Oct 2025.
  const [confirmationManual, setConfirmationManual] = useState(false);
  const [probationEndManual, setProbationEndManual] = useState(false);
  const [internshipEndManual, setInternshipEndManual] = useState(false);

  const generatePassword = () => {
    handleChange({ target: { name: "password", value: makePassword() } });
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

  // ── Load existing record (edit mode) ────────────────────────────────────
  // Saved dates are shown exactly as stored — nothing is recalculated on
  // load. If a saved date differs from the auto value, it was set by hand,
  // so it is marked as manual and kept on future joining-date edits.
  useEffect(() => {
    if (!initialData) return;
    const nameParts = (initialData.staffName || "").trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

    const joinDate = initialData.date ? initialData.date.slice(0, 10) : "";
    const internshipMonths = initialData.internshipMonths ?? 3;
    const probationMonths = initialData.probationMonths ?? 3;
    const confirmationMonths = initialData.confirmationMonths ?? 3;
    // Ticked for anyone who has/had an internship — an end date on file, or
    // currently in the Internship status.
    const hasInternship =
      !!initialData.internshipEndDate || initialData.status === "Internship";
    const savedInternshipEnd = initialData.internshipEndDate
      ? initialData.internshipEndDate.slice(0, 10)
      : hasInternship
        ? autoInternshipEndDate(joinDate, internshipMonths)
        : "";
    // Probation / confirmation count from the day after the internship.
    const startDate = probationBase(joinDate, savedInternshipEnd);
    const savedProbationEnd = initialData.probationEndDate
      ? initialData.probationEndDate.slice(0, 10)
      : "";
    const savedConfirmation = initialData.confirmationDate
      ? initialData.confirmationDate.slice(0, 10)
      : "";

    setFields({
      staffId: initialData.staffId || "",
      firstName,
      lastName,
      contactNo: initialData.contactNo || "",
      email: initialData.email || "",
      password: "",
      date: joinDate,
      dateOfBirth: initialData.dateOfBirth
        ? initialData.dateOfBirth.slice(0, 10)
        : "",
      gender: initialData.gender || "",
      designation: initialData.designation || "",
      department: initialData.department || "",
      address: initialData.address || "",
      currentAddress: initialData.currentAddress || "",
      workSchedule: initialData.workSchedule || "",
      status: initialData.status || "Probation",
      hasInternship,
      internshipMonths,
      internshipEndDate: savedInternshipEnd,
      probationMonths,
      probationEndDate: savedProbationEnd,
      confirmationMonths,
      confirmationDate: savedConfirmation,
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

    setInternshipEndManual(
      !!savedInternshipEnd &&
        savedInternshipEnd !== autoInternshipEndDate(joinDate, internshipMonths),
    );
    setConfirmationManual(
      !!savedConfirmation &&
        savedConfirmation !== autoConfirmationDate(startDate, confirmationMonths),
    );
    setProbationEndManual(
      !!savedProbationEnd &&
        savedProbationEnd !== autoProbationEndDate(startDate, probationMonths),
    );

    setActiveSection(initialData.employmentType ? "employment" : "status");
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

  useEffect(() => {
    if (!onStaffIdChange) return;
    onStaffIdChange(isEdit ? form.staffId : previewId);
  }, [isEdit, form.staffId, previewId, onStaffIdChange]);

  // ── Date handlers (recalculate only on a real user change) ──────────────

  // Date on which probation starts: the day after the internship ends, or
  // the joining date if there is no internship.
  const hasInternship = !!form.hasInternship;
  const startDate = probationBase(
    form.date,
    hasInternship ? form.internshipEndDate : "",
  );

  // Probation End / Confirmation dates that follow from a (new) internship
  // end date — only the ones the admin hasn't set by hand.
  const dependentDates = (internshipEnd, joinDate = form.date) => {
    const base = probationBase(joinDate, internshipEnd);
    const updates = {};
    if (!probationEndManual) {
      updates.probationEndDate = autoProbationEndDate(
        base,
        form.probationMonths,
      );
    }
    if (!confirmationManual) {
      updates.confirmationDate = autoConfirmationDate(
        base,
        form.confirmationMonths,
      );
    }
    return updates;
  };

  const handleJoiningDateChange = (e) => {
    const joinDate = e.target.value;
    const updates = { date: joinDate };
    // Internship (when there is one) starts on the joining date.
    const internshipEnd =
      internshipEndManual || !hasInternship
        ? form.internshipEndDate
        : autoInternshipEndDate(joinDate, form.internshipMonths);
    updates.internshipEndDate = internshipEnd;
    const base = probationBase(joinDate, internshipEnd);
    if (!confirmationManual) {
      updates.confirmationDate = autoConfirmationDate(
        base,
        form.confirmationMonths,
      );
    }
    if (!probationEndManual) {
      updates.probationEndDate = confirmationManual
        ? form.probationEndDate
        : autoProbationEndDate(base, form.probationMonths);
    }
    setFields(updates);
  };

  const handleInternshipMonthsChange = (e) => {
    const months = e.target.value;
    setInternshipEndManual(false);
    const internshipEnd = autoInternshipEndDate(form.date, months);
    setFields({
      internshipMonths: months,
      internshipEndDate: internshipEnd,
      ...dependentDates(internshipEnd),
    });
  };

  const handleInternshipEndPick = (e) => {
    const picked = e.target.value;
    setInternshipEndManual(!!picked);
    setFields({
      internshipEndDate: picked,
      ...dependentDates(picked),
    });
  };

  const resetInternshipEndToAuto = () => {
    setInternshipEndManual(false);
    const internshipEnd = autoInternshipEndDate(
      form.date,
      form.internshipMonths,
    );
    setFields({
      internshipEndDate: internshipEnd,
      ...dependentDates(internshipEnd),
    });
  };

  // "Has internship" checkbox. Ticked: internship dates are set up and
  // probation/confirmation move to start after it. Unticked: internship is
  // dropped and probation counts from the joining date again.
  const handleInternshipToggle = (e) => {
    const checked = e.target.checked;
    setInternshipEndManual(false);
    if (checked) {
      const internshipEnd = form.date
        ? autoInternshipEndDate(form.date, form.internshipMonths)
        : "";
      const updates = {
        hasInternship: true,
        internshipEndDate: internshipEnd,
        ...dependentDates(internshipEnd),
      };
      // Only a staff member still at the start of their lifecycle becomes an
      // intern — an already Confirmed/Relieved staff keeps their status.
      if (form.status === "Probation") updates.status = "Internship";
      setFields(updates);
    } else {
      const updates = {
        hasInternship: false,
        internshipEndDate: "",
        ...dependentDates(""),
      };
      if (form.status === "Internship") updates.status = "Probation";
      setFields(updates);
    }
  };

  const handleProbationMonthsChange = (e) => {
    const months = e.target.value;
    setProbationEndManual(false);
    setFields({
      probationMonths: months,
      probationEndDate: autoProbationEndDate(startDate, months),
    });
  };

  const handleConfirmationMonthsChange = (e) => {
    const months = e.target.value;
    setConfirmationManual(false);
    setFields({
      confirmationMonths: months,
      confirmationDate: autoConfirmationDate(startDate, months),
    });
  };

  // Admin picks the actual confirmation date on the calendar. Probation
  // then ends the day before it (e.g. confirmed 1 Oct → probation ends
  // 30 Sep), unless the probation end date was also set by hand.
  //
  // If the picked date is still in the future (or today), the confirmation
  // is treated as happening now, so status is promoted to "Confirmation"
  // along with it. If the picked date is already in the past — e.g.
  // backfilling history — only the date itself is changed; the current
  // status is left as-is.
  const handleConfirmationDatePick = (e) => {
    const picked = e.target.value;
    setConfirmationManual(!!picked);
    const updates = { confirmationDate: picked };
    if (!probationEndManual && picked) {
      updates.probationEndDate = addDays(picked, -1);
    }
    if (picked && !isDatePassed(picked)) {
      updates.status = "Confirmation";
    }
    setFields(updates);
  };

  const handleProbationEndPick = (e) => {
    const picked = e.target.value;
    setProbationEndManual(!!picked);
    setFields({ probationEndDate: picked });
  };

  // Same passed-vs-not-passed rule as the Confirmation Date picker above:
  // a future/today Relieved Date means the change is effective now, so
  // status is promoted to "Relieved" alongside it. A past Relieved Date
  // (backfilling history) only updates the date and leaves status as-is.
  const handleRelievingDatePick = (e) => {
    const picked = e.target.value;
    const updates = { relievingDate: picked };
    if (picked && !isDatePassed(picked)) {
      updates.status = "Relieved";
    }
    setFields(updates);
  };

  const resetConfirmationToAuto = () => {
    setConfirmationManual(false);
    const updates = {
      confirmationDate: autoConfirmationDate(startDate, form.confirmationMonths),
    };
    if (!probationEndManual) {
      updates.probationEndDate = autoProbationEndDate(
        startDate,
        form.probationMonths,
      );
    }
    setFields(updates);
  };

  const resetProbationEndToAuto = () => {
    setProbationEndManual(false);
    setFields({
      probationEndDate: autoProbationEndDate(startDate, form.probationMonths),
    });
  };

  // Fill empty dates once when a new staff member's joining date exists.
  useEffect(() => {
    if (isEdit || !form.date) return;
    const updates = {};
    // New intern: fill the internship end date first — probation and
    // confirmation dates below count from the day after it.
    let internshipEnd = form.internshipEndDate;
    if (!internshipEnd && form.hasInternship && !internshipEndManual) {
      internshipEnd = autoInternshipEndDate(form.date, form.internshipMonths);
      updates.internshipEndDate = internshipEnd;
    }
    const base = probationBase(form.date, internshipEnd);
    if (!form.confirmationDate && !confirmationManual) {
      updates.confirmationDate = autoConfirmationDate(
        base,
        form.confirmationMonths,
      );
    }
    if (!form.probationEndDate && !probationEndManual) {
      updates.probationEndDate = autoProbationEndDate(
        base,
        form.probationMonths,
      );
    }
    if (Object.keys(updates).length) setFields(updates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date, isEdit]);

  useEffect(() => {
    if (
      activeSection === "employment" &&
      form.employmentType &&
      !form.projectStartDate
    ) {
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

      // No internship for this staff member: make sure none is saved (this
      // also clears an internship that was removed while editing).
      if (!payload.hasInternship) {
        payload.internshipEndDate = "";
        if (payload.status === "Internship") payload.status = "Probation";
      }
      delete payload.hasInternship; // UI-only flag

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

  const handleStatusSelect = (status) => {
    const updates = { status };
    // Switching to Internship: make sure it has an end date (and that the
    // probation / confirmation dates follow from it).
    if (status === "Internship" && form.date && !form.internshipEndDate) {
      const internshipEnd = autoInternshipEndDate(
        form.date,
        form.internshipMonths,
      );
      setInternshipEndManual(false);
      Object.assign(updates, {
        internshipEndDate: internshipEnd,
        ...dependentDates(internshipEnd),
      });
    }
    setFields(updates);
  };

  // ── Reusable date blocks ────────────────────────────────────────────────

  const ResetLink = ({ onClick, label }) => (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
    >
      <RotateCcw size={12} />
      {label}
    </button>
  );

  const confirmationDateBlock = (
    <div>
      <DatePicker
        label="Confirmation Date"
        name="confirmationDate"
        value={form.confirmationDate}
        onChange={handleConfirmationDatePick}
      />
      {errors.confirmationDate && (
        <p className="text-xs text-red-600 mt-1">{errors.confirmationDate}</p>
      )}
      {confirmationManual ? (
        <div className="flex items-center justify-between">
          <p className="text-xs text-amber-600 mt-1">
            Set by admin (auto date:{" "}
            {formatDisplayDate(
              autoConfirmationDate(startDate, form.confirmationMonths),
            )}
            )
          </p>
          <ResetLink onClick={resetConfirmationToAuto} label="Use auto date" />
        </div>
      ) : (
        <p className="text-xs text-gray-500 mt-1">
          Auto: {hasInternship ? "Probation Start Date" : "Joining Date"} +{" "}
          {form.confirmationMonths} months. Pick a date to change it.
        </p>
      )}
    </div>
  );

  const internshipEndBlock = (
    <div>
      <DatePicker
        label="Internship End Date"
        name="internshipEndDate"
        value={form.internshipEndDate}
        onChange={handleInternshipEndPick}
      />
      {errors.internshipEndDate && (
        <p className="text-xs text-red-600 mt-1">{errors.internshipEndDate}</p>
      )}
      {internshipEndManual && (
        <ResetLink onClick={resetInternshipEndToAuto} label="Use auto date" />
      )}
    </div>
  );

  const probationEndBlock = (
    <div>
      <DatePicker
        label="Probation End Date"
        name="probationEndDate"
        value={form.probationEndDate}
        onChange={handleProbationEndPick}
      />
      {errors.probationEndDate && (
        <p className="text-xs text-red-600 mt-1">{errors.probationEndDate}</p>
      )}
      {probationEndManual && (
        <ResetLink onClick={resetProbationEndToAuto} label="Use auto date" />
      )}
    </div>
  );

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
        <PhoneInput
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
          onChange={handleJoiningDateChange}
        />
      </div>

      {/* Date of Birth / Gender */}
      <div className="grid grid-cols-2 gap-4">
        <DatePicker
          label="Date of Birth"
          name="dateOfBirth"
          value={form.dateOfBirth}
          onChange={handleChange}
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Gender <span className="text-xs text-gray-400">(Mr. / Ms. on letters)</span>
          </label>
          <Select
            name="gender"
            value={form.gender}
            onChange={handleChange}
            placeholder="Select gender"
            options={[
              { value: "Male", label: "Male (Mr.)" },
              { value: "Female", label: "Female (Ms.)" },
            ]}
          />
        </div>
      </div>

      {/* Letter details: designation / department */}
      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="Designation (Job Title)"
          name="designation"
          value={form.designation}
          onChange={handleChange}
          placeholder="e.g. Full Stack developer"
        />
        <InputField
          label="Department / Team"
          name="department"
          value={form.department}
          onChange={handleChange}
          placeholder="e.g. CRM & app development department"
        />
      </div>

      {/* Permanent / current address */}
      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="Address (Permanent)"
          name="address"
          value={form.address}
          onChange={handleChange}
          placeholder="e.g. Flat B-3, New Sanjay chawl, Dharavi, Mumbai 400 017"
        />
        <InputField
          label="Address (Current)"
          name="currentAddress"
          value={form.currentAddress}
          onChange={handleChange}
          placeholder="Leave blank if same as permanent"
        />
      </div>

      {/* Work schedule */}
      <div className="grid grid-cols-1 gap-4">
        <InputField
          label="Work Schedule"
          name="workSchedule"
          value={form.workSchedule}
          onChange={handleChange}
          placeholder="e.g. Full time / Mon till Saturday / 10.00 AM till 6.30 PM"
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
              placeholder={isEdit ? "Leave blank to keep current password" : ""}
              className="pr-20"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {(!isEdit || justGenerated) && form.password && (
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
              <button
                type="button"
                onClick={generatePassword}
                title="Generate a new password"
                className="text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                <RefreshCw size={16} />
              </button>
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
          {form.password && (!isEdit || justGenerated) && (
            <p className="text-xs text-gray-500 mt-1">
              Saved with this staff member — view it any time from History.
            </p>
          )}
        </div>
      </div>

      {/* Status / Employment Type */}
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
            <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                name="hasInternship"
                checked={hasInternship}
                onChange={handleInternshipToggle}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              This staff member has an internship period
            </label>

            <div
              className={`grid grid-cols-2 gap-3 mb-4 ${
                hasInternship ? "sm:grid-cols-4" : "sm:grid-cols-3"
              }`}
            >
              {STATUS_OPTIONS.filter(
                (status) => hasInternship || status !== "Internship",
              ).map((status) => (
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
                      form.status === status ? "text-blue-700" : "text-gray-700"
                    }`}
                  >
                    {status}
                  </span>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-gray-200 p-4 bg-white">
              {form.status === "Internship" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        No. of Months
                      </label>
                      <input
                        type="number"
                        min={1}
                        name="internshipMonths"
                        value={form.internshipMonths}
                        onChange={handleInternshipMonthsChange}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                    {internshipEndBlock}
                  </div>
                  <div className="text-xs text-gray-500 bg-purple-50 p-2 rounded border border-purple-100">
                    <p className="font-medium text-purple-700">
                      How it's calculated:
                    </p>
                    <p>
                      Internship End Date = Joining Date +{" "}
                      {form.internshipMonths} months - 1 day. Probation then
                      starts the next day. You can also pick a different date.
                    </p>
                    {form.date && (
                      <p className="mt-1">
                        Example: {formatDisplayDate(form.date)} +{" "}
                        {form.internshipMonths} months - 1 day ={" "}
                        {formatDisplayDate(
                          autoInternshipEndDate(
                            form.date,
                            form.internshipMonths,
                          ),
                        )}
                        {form.internshipEndDate &&
                          ` → Probation starts ${formatDisplayDate(
                            addDays(form.internshipEndDate, 1),
                          )}`}
                      </p>
                    )}
                  </div>
                </div>
              )}

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
                        onChange={handleProbationMonthsChange}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                    {probationEndBlock}
                  </div>
                  <div className="text-xs text-gray-500 bg-blue-50 p-2 rounded border border-blue-100">
                    <p className="font-medium text-blue-700">
                      How it's calculated:
                    </p>
                    <p>
                      Probation End Date ={" "}
                      {hasInternship ? "Probation Start Date" : "Joining Date"}{" "}
                      + {form.probationMonths} months - 1 day. You can also
                      pick a different date.
                    </p>
                    {startDate && (
                      <p className="mt-1">
                        Example: {formatDisplayDate(startDate)} +{" "}
                        {form.probationMonths} months - 1 day ={" "}
                        {formatDisplayDate(
                          autoProbationEndDate(startDate, form.probationMonths),
                        )}
                      </p>
                    )}
                    {hasInternship && (
                      <p className="mt-1">
                        Internship: {formatDisplayDate(form.date)} –{" "}
                        {formatDisplayDate(form.internshipEndDate)}. Probation
                        starts {formatDisplayDate(startDate)}.
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
                        onChange={handleConfirmationMonthsChange}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                    {confirmationDateBlock}
                  </div>
                  <div className="text-xs text-gray-500 bg-green-50 p-2 rounded border border-green-100">
                    <p className="font-medium text-green-700">
                      How it's calculated:
                    </p>
                    <p>
                      Confirmation Date ={" "}
                      {hasInternship ? "Probation Start Date" : "Joining Date"}{" "}
                      + {form.confirmationMonths} months. If the staff member was
                      confirmed on a different day, pick that date instead.
                    </p>
                    {form.date && (
                      <p className="mt-1">
                        Example: {formatDisplayDate(startDate)} +{" "}
                        {form.confirmationMonths} months ={" "}
                        {formatDisplayDate(
                          autoConfirmationDate(
                            startDate,
                            form.confirmationMonths,
                          ),
                        )}
                        {confirmationManual &&
                          ` → changed to ${formatDisplayDate(form.confirmationDate)}`}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {form.status === "Relieved" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Relieved before the confirmation date = never
                        confirmed, so no Confirmation Date is shown. */}
                    {!leftBeforeConfirmation(form) && confirmationDateBlock}
                    <DatePicker
                      label="Relieved Date"
                      name="relievingDate"
                      value={form.relievingDate}
                      onChange={handleRelievingDatePick}
                    />
                  </div>
                  <div className="text-xs text-gray-500 bg-orange-50 p-2 rounded border border-orange-100">
                    <p className="font-medium text-orange-700">Information:</p>
                    <p>
                      Relieved Date is the last working day. You can leave it
                      blank and add it later.{" "}
                      {leftBeforeConfirmation(form)
                        ? "Relieved before the confirmation date, so this staff member is treated as not confirmed."
                        : "Confirmation Date controls when leave balance starts."}
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