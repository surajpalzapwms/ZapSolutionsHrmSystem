// src/components/staff/StaffSettlementModal.jsx
import React, { useState } from "react";
import { Download } from "lucide-react";

import Modal from "../common/Modal";
import Button from "../common/Button";
import { generateSettlementPDF } from "../../utils/settlementGenerator";
import { showToast } from "../../utils/toast";
import { SettlementStatementView } from "./SettlementStatement";
import { useSettlementStatement } from "./hooks/useSettlementStatement";

const StaffSettlementModal = ({ isOpen, onClose, staff }) => {
  const [downloading, setDownloading] = useState(false);
  const { loading, error, data } = useSettlementStatement(staff, isOpen);

  const handleDownload = async () => {
    if (!data) return;
    setDownloading(true);
    try {
      await generateSettlementPDF(data);
    } catch {
      showToast("error", "Couldn't generate the PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Full & Final Settlement Statement"
      size="max-w-4xl"
      headerRight={
        staff?.staffId && (
          <span className="text-sm text-gray-500">
            Staff ID:{" "}
            <span className="font-medium text-gray-700">{staff.staffId}</span>
          </span>
        )
      }
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={handleDownload}
            disabled={!data || loading}
            loading={downloading}
          >
            {!downloading && <Download size={16} />}
            Download PDF
          </Button>
        </>
      }
    >
      <SettlementStatementView
        staff={staff}
        loading={loading}
        error={error}
        data={data}
      />
    </Modal>
  );
};

export default StaffSettlementModal;
