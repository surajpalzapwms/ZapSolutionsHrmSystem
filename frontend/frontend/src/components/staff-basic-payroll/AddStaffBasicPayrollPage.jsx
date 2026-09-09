// src/components/staff-basic-payroll/AddStaffBasicPayrollModal.jsx
import React, { useState } from "react";
import Modal from "../common/Modal";
import Select from "../common/Select";

const AddStaffBasicPayrollModal = ({
  isOpen,
  onClose,
  onAdd,
  availableStaff,
}) => {
  const [formData, setFormData] = useState({
    staffId: "",
    basicSalary: "",
    effectiveFrom: "",
    remarks: "",
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear error when user types
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.staffId) newErrors.staffId = "Please select a staff member";
    if (!formData.basicSalary || parseFloat(formData.basicSalary) <= 0) {
      newErrors.basicSalary =
        "Please enter a valid salary amount greater than 0";
    }
    if (!formData.effectiveFrom)
      newErrors.effectiveFrom = "Please select effective date";

    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    try {
      await onAdd({
        staffId: formData.staffId,
        basicSalary: parseFloat(formData.basicSalary),
        effectiveFrom: formData.effectiveFrom,
        remarks: formData.remarks,
      });

      // Reset form
      setFormData({
        staffId: "",
        basicSalary: "",
        effectiveFrom: "",
        remarks: "",
      });
      setErrors({});
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting) {
      setFormData({
        staffId: "",
        basicSalary: "",
        effectiveFrom: "",
        remarks: "",
      });
      setErrors({});
      onClose();
    }
  };

  // Sort staff by name
  const sortedStaff = [...availableStaff].sort((a, b) =>
    a.staffName.localeCompare(b.staffName),
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Staff Basic Payroll"
    >
      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          {/* Staff Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Staff *
            </label>
            <select
              name="staffId"
              value={formData.staffId}
              onChange={handleChange}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.staffId ? "border-red-500" : "border-gray-300"
              }`}
              disabled={submitting || sortedStaff.length === 0}
            >
              <option value="">Select a staff</option>
              {sortedStaff.map((staff) => (
                <option key={staff.staffId} value={staff.staffId}>
                  {staff.staffName} ({staff.staffId})
                </option>
              ))}
            </select>
            {errors.staffId && (
              <p className="text-red-500 text-xs mt-1">{errors.staffId}</p>
            )}
            {sortedStaff.length === 0 && !submitting && (
              <p className="text-yellow-600 text-xs mt-1">
                No staff available. All staff already have basic payroll
                records.
              </p>
            )}
          </div>

          {/* Basic Salary */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Basic Salary *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-600">₹</span>
              <input
                type="number"
                name="basicSalary"
                value={formData.basicSalary}
                onChange={handleChange}
                className={`w-full pl-8 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.basicSalary ? "border-red-500" : "border-gray-300"
                }`}
                placeholder="Enter basic salary"
                step="100"
                min="0"
                disabled={submitting}
              />
            </div>
            {errors.basicSalary && (
              <p className="text-red-500 text-xs mt-1">{errors.basicSalary}</p>
            )}
          </div>

          {/* Effective From */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Effective From *
            </label>
            <input
              type="date"
              name="effectiveFrom"
              value={formData.effectiveFrom}
              onChange={handleChange}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.effectiveFrom ? "border-red-500" : "border-gray-300"
              }`}
              disabled={submitting}
            />
            {errors.effectiveFrom && (
              <p className="text-red-500 text-xs mt-1">
                {errors.effectiveFrom}
              </p>
            )}
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Remarks
            </label>
            <textarea
              name="remarks"
              value={formData.remarks}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter remarks (optional)"
              rows="2"
              disabled={submitting}
            />
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={submitting || sortedStaff.length === 0}
            >
              {submitting ? "Adding..." : "Add Record"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default AddStaffBasicPayrollModal;
