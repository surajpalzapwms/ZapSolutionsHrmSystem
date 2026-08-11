// src/components/payroll/AllowanceManager.jsx
import React from "react";
import { Trash2 } from "lucide-react";
import Dropdown from "../common/Dropdown";
import InputField from "../common/InputField";
import Button from "../common/Button";
import { ALLOWANCE_TYPES } from "../../utils/constants";
import { formatCurrency } from "../../utils/numberUtils";

const typeOptions = ALLOWANCE_TYPES.map((t) => ({ value: t, label: t }));

const AllowanceManager = ({ allowances = [], onChange, total = 0 }) => {
  const addRow = () => {
    onChange([...allowances, { type: ALLOWANCE_TYPES[0], amount: 0 }]);
  };

  const updateRow = (index, field, value) => {
    const updated = allowances.map((a, i) =>
      i === index ? { ...a, [field]: value } : a,
    );
    onChange(updated);
  };

  const removeRow = (index) => {
    onChange(allowances.filter((_, i) => i !== index));
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-700">Allowances</h4>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          Add
        </Button>
      </div>

      {allowances.length === 0 ? (
        <p className="text-sm text-gray-400">No allowances added</p>
      ) : (
        <div className="space-y-2">
          {allowances.map((a, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[1fr_1fr_auto] gap-2 items-start"
            >
              <Dropdown
                value={a.type}
                onChange={(val) => updateRow(idx, "type", val)}
                options={typeOptions}
              />
              <InputField
                type="number"
                value={a.amount}
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
        Total Allowances: {formatCurrency(total)}
      </div>
    </div>
  );
};

export default AllowanceManager;
