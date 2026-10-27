// src/components/staff/MySettlementCard.jsx
// Staff dashboard card for someone who has LEFT the organization — replaces
// Sign in / out, the same as the mobile app's Home "Full & Final Settlement"
// card. "View Final Settlement" opens the same statement the super admin
// sees from Staff Details (with View details per month + PDF download).
import React, { useState } from "react";
import { FileText } from "lucide-react";
import Button from "../common/Button";
import StaffSettlementModal from "./StaffSettlementModal";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";

const MySettlementCard = ({ staff }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="h-full bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
          <FileText size={20} />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-800">Full &amp; Final Settlement</h3>
          <p className="text-xs text-gray-500">
            Relieved on {formatDateToDDMMMYYYY(staff?.relievingDate) || "—"}
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm text-gray-600 flex-1">
        Your month-wise salary, deductions and the final balance payable.
      </p>
      <div className="mt-3">
        <Button variant="primary" onClick={() => setOpen(true)}>
          View Final Settlement
        </Button>
      </div>
      <StaffSettlementModal isOpen={open} onClose={() => setOpen(false)} staff={staff} />
    </div>
  );
};

export default MySettlementCard;
