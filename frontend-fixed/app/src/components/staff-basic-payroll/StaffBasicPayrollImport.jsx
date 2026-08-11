// src/components/staff-basic-payroll/StaffBasicPayrollImport.jsx
import React from "react";
import { Upload, FileSpreadsheet } from "lucide-react";
import { useImport } from "../../hooks/useImport";
import { staffBasicPayrollService } from "../../services/staffBasicPayrollService";
import Button from "../common/Button";

const StaffBasicPayrollImport = ({ onSuccess, onCancel }) => {
  const { parsedData, uploading, handleFileUpload, importData } = useImport(
    staffBasicPayrollService.import
  );

  const handleImport = async () => {
    try {
      await importData();
      onSuccess();
      onCancel();
    } catch {
      // error already toasted by useImport
    }
  };

  return (
    <div className="space-y-4">
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
        <FileSpreadsheet className="mx-auto text-gray-400 mb-2" size={32} />
        <p className="text-sm text-gray-600 mb-3">
          Upload an Excel/CSV file with columns: staffId, staffName, currentBasicSalary, currentEffectiveFrom, remarks
        </p>
        <label className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer text-sm font-medium text-gray-700">
          <Upload size={16} />
          Choose File
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />
        </label>
      </div>

      {parsedData.length > 0 && (
        <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
          {parsedData.length} record(s) ready to import.
        </div>
      )}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="success"
          onClick={handleImport}
          disabled={parsedData.length === 0}
          loading={uploading}
        >
          Import {parsedData.length > 0 ? `(${parsedData.length})` : ""}
        </Button>
      </div>
    </div>
  );
};

export default StaffBasicPayrollImport;
