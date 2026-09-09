// src/components/staff/StaffDetailsModal.jsx

import React from "react";
import {
  CalendarClock,
  CalendarCheck,
  CalendarX,
  CalendarDays,
  Cake,
  Briefcase,
  Phone,
} from "lucide-react";

import Modal from "../common/Modal";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";

const STATUS_COLORS = {
  Probation: "bg-blue-100 text-blue-700",
  Confirmation: "bg-green-100 text-green-700",
  Relieving: "bg-orange-100 text-orange-700",
};

// Reusable date/info row
const DateRow = ({
  icon: Icon,
  label,
  value,
  tone = "text-gray-700",
  hint,
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
        {value ? formatDateToDDMMMYYYY(value) : "Not set"}
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
}) => {
  if (!staff) return null;

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
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-800">
              {staff.staffName}
            </h3>

            <p className="text-sm text-gray-500">
              {staff.email || "No email on file"}
            </p>
          </div>

          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
              STATUS_COLORS[staff.status] ||
              "bg-gray-100 text-gray-700"
            }`}
          >
            {staff.status || "Probation"}
          </span>
        </div>

        {/* Employment Timeline */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Employment Timeline
          </p>

          <div className="space-y-2">

            {/* Row 1: Joining Date + Probation End Date */}
            <div className="grid grid-cols-2 gap-2">

              <DateRow
                icon={CalendarDays}
                label="Joining Date (Probation Started)"
                value={staff.date}
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

              <DateRow
                icon={CalendarCheck}
                label="Confirmation Started"
                value={staff.confirmationDate}
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

      </div>
    </Modal>
  );
};

export default StaffDetailsModal;