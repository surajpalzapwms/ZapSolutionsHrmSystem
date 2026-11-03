// src/components/payroll/DeductionManager.jsx
import React from "react";
import { Trash2 } from "lucide-react";
import Dropdown from "../common/Dropdown";
import InputField from "../common/InputField";
import Button from "../common/Button";
import { payrollTypesFor } from "../../utils/constants";
import { getBrand } from "../../utils/brand";
import { formatCurrency } from "../../utils/numberUtils";

// The company's country decides the usual lines (PF / ESI in India, GOSI in
// Saudi Arabia, …). A type saved earlier that is not in the list still shows.
const typesNow = () => payrollTypesFor(getBrand().country).deductions;

const DeductionManager = ({ deductions = [], onChange, total = 0 }) => {
  const addRow = () => {
    onChange([...deductions, { type: typesNow()[0], amount: 0 }]);
  };

  const updateRow = (index, field, value) => {
    const updated = deductions.map((d, i) =>
      i === index ? { ...d, [field]: value } : d,
    );
    onChange(updated);
  };

  const removeRow = (index) => {
    onChange(deductions.filter((_, i) => i !== index));
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-700">Deductions</h4>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          Add
        </Button>
      </div>

      {deductions.length === 0 ? (
        <p className="text-sm text-gray-400">No deductions added</p>
      ) : (
        <div className="space-y-2">
          {deductions.map((d, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[1fr_1fr_auto] gap-2 items-start"
            >
              <Dropdown
                value={d.type}
                onChange={(val) => updateRow(idx, "type", val)}
                options={[...new Set([...typesNow(), d.type].filter(Boolean))].map((t) => ({ value: t, label: t }))}
              />
              <InputField
                type="number"
                value={d.amount}
                onChange={(e) => updateRow(idx, "amount", e.target.value)}
                placeholder="Amount"
              />
              <button
                type="button"
                onClick={() => removeRow(idx)}
                className="text-red-600 mt-2"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end text-sm font-medium text-gray-700 border-t pt-2">
        Total Deductions: {formatCurrency(total)}
      </div>
    </div>
  );
};

export default DeductionManager;