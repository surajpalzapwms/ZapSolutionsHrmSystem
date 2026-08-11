// src/components/attendance/DeleteModal.jsx
import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";

const DeleteModal = ({ isOpen, onClose, record, onDeleteRecord, onDeleteByDate }) => {
  const [deleting, setDeleting] = useState(false);

  if (!record) return null;

  const handleDeleteRecord = async () => {
    setDeleting(true);
    await onDeleteRecord(record._id);
    setDeleting(false);
    onClose();
  };

  const handleDeleteByDate = async () => {
    setDeleting(true);
    await onDeleteByDate(record.userId, record.date || record.createdAt);
    setDeleting(false);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Delete Attendance" size="max-w-md">
      <div className="space-y-4">
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
          <p className="text-sm text-red-700">
            Delete the attendance record for staff <b>{record.userId}</b> on{" "}
            <b>{formatDateToDDMMMYYYY(record.date || record.createdAt)}</b>? This cannot be undone.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button variant="danger" onClick={handleDeleteRecord} loading={deleting} fullWidth>
            Delete This Record
          </Button>
          <Button variant="outline" onClick={handleDeleteByDate} loading={deleting} fullWidth>
            Delete All Records For This Date
          </Button>
          <Button variant="secondary" onClick={onClose} fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default DeleteModal;
