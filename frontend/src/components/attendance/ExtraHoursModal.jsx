// src/components/attendance/ExtraHoursModal.jsx
import React, { useEffect } from "react";
import { Clock } from "lucide-react";
import { useExtraHours } from "./hooks/useExtraHours";
import Modal from "../common/Modal";
import Spinner from "../common/Spinner";
import Button from "../common/Button";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";

const formatMinutes = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
};

const ExtraHoursModal = ({ isOpen, onClose, userId }) => {
  const { extraHours, totalMinutes, loading, fetchExtraHours, reset } = useExtraHours();

  useEffect(() => {
    if (isOpen && userId) {
      fetchExtraHours(userId);
    }
    if (!isOpen) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, userId]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Extra Hours" size="max-w-lg">
      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-indigo-50 rounded-lg p-4">
            <Clock className="text-indigo-600" size={24} />
            <div>
              <p className="text-xs text-gray-500">Total Extra Hours</p>
              <p className="text-lg font-bold text-gray-800">{formatMinutes(totalMinutes)}</p>
            </div>
          </div>

          {extraHours.length === 0 ? (
            <p className="text-center text-gray-500 py-6">No extra hours recorded</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {extraHours.map((record) => (
                <div key={record._id} className="flex justify-between items-center border rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-700">{formatDateToDDMMMYYYY(record.createdAt)}</span>
                  <span className="text-sm font-medium text-gray-800">
                    {formatMinutes(record.extraHoursInMinutes || 0)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default ExtraHoursModal;
