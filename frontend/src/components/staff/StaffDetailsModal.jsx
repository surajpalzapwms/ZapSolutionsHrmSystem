// src/components/staff/StaffDetailsModal.jsx

import React, { useState, useEffect } from "react";
import {
  CalendarClock,
  CalendarCheck,
  CalendarX,
  CalendarDays,
  Cake,
  Briefcase,
  Phone,
  KeyRound,
  Eye,
  EyeOff,
  Copy,
} from "lucide-react";

import Modal from "../common/Modal";
import StaffAvatar from "../common/StaffAvatar";
import StaffDocumentsSection from "./StaffDocumentsSection";
import StaffReferralSection from "./StaffReferralSection";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";
import { staffService } from "../../services/staffService";
import { getDisplayStatus, leftBeforeConfirmation } from "../../utils/staffStatus";

const STATUS_COLORS = {
  Internship: "bg-purple-100 text-purple-700",
  Probation: "bg-blue-100 text-blue-700",
  Confirmation: "bg-green-100 text-green-700",
  Relieved: "bg-orange-100 text-orange-700",
};

// Reusable date/info row
const DateRow = ({
  icon: Icon,
  label,
  value,
  tone = "text-gray-700",
  hint,
  emptyText = "Not set",
  compact = false,
}) => (
  <div
    className={`flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 ${
      compact ? "px-3 py-2.5 h-full" : "px-3 py-2.5"
    }`}
  >
    <Icon
      size={18}
      className={`mt-0.5 flex-shrink-0 ${tone}`}
    />

    <div className="min-w-0">
      <p className="text-xs font-medium text-gray-500">
        {label}
      </p>

      <p
        className={`text-sm font-semibold ${
          value ? "text-gray-800" : "text-gray-400"
        }`}
      >
        {value ? formatDateToDDMMMYYYY(value) : emptyText}
      </p>

      {hint && (
        <p className="text-xs text-gray-400 mt-0.5">
          {hint}
        </p>
      )}
    </div>
  </div>
);

const StaffDetailsModal = ({
  isOpen,
  onClose,
  staff,
  onPhotoChanged,
}) => {
  // Login password (as originally entered) — fetched from the admin-only
  // endpoint each time a staff member's details are opened.
  const [loginInfo, setLoginInfo] = useState(null); // { email, password }
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdVisible, setPwdVisible] = useState(true);
  const [copied, setCopied] = useState(false);
  // A failed request must NOT look like "no password stored" — keep the
  // reason so it can be shown (and retried) instead.
  const [pwdError, setPwdError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const staffDbId = staff?._id;
  const hasLogin = !!staff?.email;

  useEffect(() => {
    if (!isOpen || !staffDbId || !hasLogin) {
      setLoginInfo(null);
      return;
    }
    let cancelled = false;
    setPwdLoading(true);
    setPwdError("");
    setPwdVisible(true);
    staffService
      .getPassword(staffDbId)
      .then((res) => {
        if (!cancelled) setLoginInfo(res.data?.data || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoginInfo(null);
        const status = err.response?.status;
        setPwdError(
          err.response?.data?.message ||
            (status ? `Request failed (${status})` : "Could not reach server"),
        );
      })
      .finally(() => {
        if (!cancelled) setPwdLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, staffDbId, hasLogin, reloadKey]);

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(loginInfo.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (!staff) return null;

  // Internship comes before probation. When a staff member had one,
  // probation starts the day after it ends; otherwise it starts on the
  // joining date.
  const hasInternship = !!staff.internshipEndDate;
  const probationStart = hasInternship
    ? new Date(
        new Date(staff.internshipEndDate).getTime() + 24 * 60 * 60 * 1000,
      ).toISOString()
    : staff.date;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Staff Details"
      size="max-w-lg"
      headerRight={
        staff.staffId && (
          <span className="text-sm text-gray-500">
            Staff ID:{" "}
            <span className="font-medium text-gray-700">
              {staff.staffId}
            </span>
          </span>
        )
      }
    >
      <div className="space-y-5">

        {/* Staff Basic Information */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <StaffAvatar name={staff.staffName} photoUrl={staff.photoUrl} size={56} />
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-gray-800">
                {staff.staffName}
              </h3>

              <p className="text-sm text-gray-500">
                {staff.email || "No email on file"}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                STATUS_COLORS[getDisplayStatus(staff)] ||
                "bg-gray-100 text-gray-700"
              }`}
            >
              {getDisplayStatus(staff)}
            </span>

            {/* Login password — always shown under the status badge */}
            {hasLogin && (
              <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1">
                <KeyRound size={14} className="text-indigo-500 flex-shrink-0" />
                <span className="text-xs text-gray-500">Password</span>

                {pwdLoading ? (
                  <span className="text-sm text-gray-400">…</span>
                ) : loginInfo?.password ? (
                  <>
                    <span className="text-sm font-semibold font-mono text-gray-800">
                      {pwdVisible
                        ? loginInfo.password
                        : "•".repeat(loginInfo.password.length)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPwdVisible((v) => !v)}
                      title={pwdVisible ? "Hide password" : "Show password"}
                      className="text-gray-500 hover:text-gray-800"
                    >
                      {pwdVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={copyPassword}
                      title="Copy password"
                      className="text-gray-500 hover:text-gray-800"
                    >
                      {copied ? (
                        <span className="text-xs text-green-600">Copied</span>
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </>
                ) : pwdError ? (
                  <>
                    <span className="text-xs text-red-600">{pwdError}</span>
                    <button
                      type="button"
                      onClick={() => setReloadKey((k) => k + 1)}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                    >
                      Retry
                    </button>
                  </>
                ) : (
                  <>
                    {loginInfo?.status === "key-mismatch" ? (
                      <span
                        className="text-xs text-amber-600"
                        title="A password is saved, but it was encrypted with an older key. Add the old PASSWORD_VIEW_KEY / JWT_SECRET value as PASSWORD_VIEW_KEY_OLD in the backend .env and restart the server to show it."
                      >
                        Saved with old key
                      </span>
                    ) : (
                      <span
                        className="text-sm text-gray-400"
                        title="This login was created before passwords were saved for History, so only a one-way hash exists and the old password can't be shown. It appears automatically the next time this person logs in."
                      >
                        Shows after their next login
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Employment Timeline */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Employment Timeline
          </p>

          <div className="space-y-2">

            {/* Internship row — only for staff who had an internship */}
            {hasInternship && (
              <div className="grid grid-cols-2 gap-2">

                <DateRow
                  icon={CalendarDays}
                  label="Joining Date (Internship Started)"
                  value={staff.date}
                  tone="text-purple-500"
                  compact
                />

                <DateRow
                  icon={CalendarClock}
                  label="Internship End Date"
                  value={staff.internshipEndDate}
                  tone="text-purple-500"
                  hint={
                    staff.internshipMonths
                      ? `${staff.internshipMonths} month internship period`
                      : undefined
                  }
                  compact
                />

              </div>
            )}

            {/* Row 1: Probation Start + Probation End Date */}
            <div className="grid grid-cols-2 gap-2">

              <DateRow
                icon={CalendarDays}
                label={
                  hasInternship
                    ? "Probation Started"
                    : "Joining Date (Probation Started)"
                }
                value={probationStart}
                tone="text-blue-500"
                compact
              />

              <DateRow
                icon={CalendarClock}
                label="Probation End Date"
                value={staff.probationEndDate}
                tone="text-blue-500"
                hint={
                  staff.probationMonths
                    ? `${staff.probationMonths} month probation period`
                    : undefined
                }
                compact
              />

            </div>

            {/* Row 2: Confirmation Started + Leaving Date */}
            <div className="grid grid-cols-2 gap-2">

              {/* Left before the confirmation date = never confirmed, so
                  the date is not shown. */}
              <DateRow
                icon={CalendarCheck}
                label="Confirmation Started"
                value={leftBeforeConfirmation(staff) ? null : staff.confirmationDate}
                emptyText={leftBeforeConfirmation(staff) ? "Not confirmed" : "Not set"}
                hint={
                  leftBeforeConfirmation(staff)
                    ? "Left before the confirmation date"
                    : undefined
                }
                tone="text-green-600"
                compact
              />

              <DateRow
                icon={CalendarX}
                label="Leaving Date"
                value={staff.relievingDate}
                tone="text-orange-500"
                compact
              />

            </div>

            {/* Row 3: Date of Birth + Contact No. */}
            <div className="grid grid-cols-2 gap-2">

              {/* Date of Birth */}
              <DateRow
                icon={Cake}
                label="Date of Birth"
                value={staff.dateOfBirth}
                tone="text-pink-500"
                compact
              />

              {/* Contact Number */}
              <div className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 h-full">

                <Phone
                  size={18}
                  className="mt-0.5 flex-shrink-0 text-blue-500"
                />

                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-500">
                    Contact No.
                  </p>

                  <p
                    className={`text-sm font-semibold ${
                      staff.contactNo
                        ? "text-gray-800"
                        : "text-gray-400"
                    }`}
                  >
                    {staff.contactNo || "Not set"}
                  </p>
                </div>

              </div>

            </div>

          </div>
        </div>

        {/* Employment Type */}
        {staff.employmentType && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
              Employment Type
            </p>

            <div className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">

              <Briefcase
                size={18}
                className="mt-0.5 flex-shrink-0 text-indigo-500"
              />

              <div>
                <p className="text-sm font-semibold text-gray-800">
                  {staff.employmentType}
                </p>

                <p className="text-xs text-gray-500">
                  {formatDateToDDMMMYYYY(
                    staff.projectStartDate
                  ) || "—"}{" "}
                  to{" "}
                  {formatDateToDDMMMYYYY(
                    staff.projectEndDate
                  ) || "—"}
                </p>
              </div>

            </div>
          </div>
        )}

        {/* Referral organisation + first-month commission */}
        {staff._id && <StaffReferralSection staff={staff} />}

        {/* Profile photo + Aadhaar / PAN / light bill */}
        {staff._id && (
          <StaffDocumentsSection
            staffId={staff._id}
            staffName={staff.staffName}
            onPhotoChanged={onPhotoChanged}
          />
        )}

      </div>
    </Modal>
  );
};

export default StaffDetailsModal;