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
  return errors;
};

const StaffForm = ({
  initialData = null,
  onSubmit,
  onCancel,
  isEdit = false,
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
      projectName: "",
      contactNo: "",
      email: "",
      password: "",
      date: "",
      status: "Trial",
      relievingDate: "",
    },
    (f) => validate(f, isEdit),
  );

  const [showPassword, setShowPassword] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  // Cosmetic preview only — the backend assigns the real ID at save time,
  // so this can occasionally be off by one if staff are added concurrently.
  const [previewId, setPreviewId] = useState("");

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
        projectName: initialData.projectName || "",
        contactNo: initialData.contactNo || "",
        email: initialData.email || "",
        password: "",
        date: initialData.date ? initialData.date.slice(0, 10) : "",
        status: initialData.status || "Trial",
        relievingDate: initialData.relievingDate
          ? initialData.relievingDate.slice(0, 10)
          : "",
      });
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
        setPreviewId(`ZAP${String(count + 1).padStart(4, "0")}`);
      })
      .catch(() => {
        if (mounted) setPreviewId("");
      });
    return () => {
      mounted = false;
    };
  }, [isEdit]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!runValidate()) return;

    try {
      setIsSubmitting(true);
      const payload = { ...form };
      if (isEdit && !payload.password) delete payload.password;

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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Staff ID
          </label>
          <input
            type="text"
            value={isEdit ? form.staffId : previewId || "Generating..."}
            disabled
            readOnly
            className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed"
          />
        </div>
        <InputField
          label="First Name"
          name="firstName"
          value={form.firstName}
          onChange={handleChange}
          error={errors.firstName}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="Last Name"
          name="lastName"
          value={form.lastName}
          onChange={handleChange}
          error={errors.lastName}
          required
        />
        <InputField
          label="Project (optional)"
          name="projectName"
          value={form.projectName}
          onChange={handleChange}
          error={errors.projectName}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="Contact Number"
          name="contactNo"
          value={form.contactNo}
          onChange={handleChange}
          error={errors.contactNo}
          required
        />
        <InputField
          label="Email"
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          error={errors.email}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
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
        <DatePicker
          label="Joining Date"
          name="date"
          value={form.date}
          onChange={handleChange}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Status
          </label>
          <select
            name="status"
            value={form.status}
            onChange={handleChange}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="Trial">Trial</option>
            <option value="Confirmed">Confirmed</option>
          </select>
        </div>
        <DatePicker
          label="Relieving Date (if leaving)"
          name="relievingDate"
          value={form.relievingDate}
          onChange={handleChange}
        />
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
