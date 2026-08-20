// EXAMPLE — adapt this into your actual modal/dialog wrapper component
// (the one that currently renders the "Add Staff Member" title + X you
// circled). This is not a real file in your project — I don't have that
// component, so I can't edit it directly. Copy the relevant bits in.

import React, { useState } from "react";
import { X } from "lucide-react";
import StaffForm from "./StaffForm";

const StaffFormModal = ({ isOpen, onClose, isEdit, initialData, onSubmit }) => {
  // Populated by StaffForm's onStaffIdChange callback — the generated
  // preview ID for a new staff member, or the real staffId when editing.
  const [staffId, setStaffId] = useState("");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header — title, Staff ID, then the X, in that order */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">
            {isEdit ? "Edit Staff Member" : "Add Staff Member"}
          </h2>
          <div className="flex items-center gap-4">
            {staffId && (
              <span className="text-sm text-gray-500">
                Staff ID:{" "}
                <span className="font-medium text-gray-700">{staffId}</span>
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6">
          <StaffForm
            isEdit={isEdit}
            initialData={initialData}
            onSubmit={onSubmit}
            onCancel={onClose}
            onStaffIdChange={setStaffId}
          />
        </div>
      </div>
    </div>
  );
};

export default StaffFormModal;