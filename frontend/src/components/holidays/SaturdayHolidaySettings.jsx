// src/components/holidays/SaturdayHolidaySettings.jsx
//
// Lets an admin decide, month by month, which Saturdays count as a
// holiday - e.g. 2nd & 4th Saturday for most months, but 3rd & 4th
// Saturday for a month that needs a different pattern. Non-admins see
// the same grid in read-only mode so they know which Saturdays are off.
import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Button from "../common/Button";
import Spinner from "../common/Spinner";
import { useSaturdayHolidays } from "./hooks/useSaturdayHolidays";
import { MONTHS } from "../../utils/constants";

const OCCURRENCES = [1, 2, 3, 4, 5];
const ORDINAL_LABEL = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };

const SaturdayHolidaySettings = ({ admin = false, onSaved }) => {
  const {
    year,
    setYear,
    rules,
    loading,
    saving,
    toggleOccurrence,
    applyToAllMonths,
    clearAllMonths,
    saveRules,
  } = useSaturdayHolidays();

  const handleSave = async () => {
    const ok = await saveRules();
    if (ok && onSaved) onSaved();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setYear((y) => y - 1)}
            className="p-2 rounded-full hover:bg-gray-100"
            aria-label="Previous year"
          >
            <ChevronLeft size={18} />
          </button>
          <h3 className="text-lg font-semibold text-gray-800 w-16 text-center">{year}</h3>
          <button
            type="button"
            onClick={() => setYear((y) => y + 1)}
            className="p-2 rounded-full hover:bg-gray-100"
            aria-label="Next year"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {admin && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => applyToAllMonths([2, 4])}>
              Apply 2nd & 4th to all
            </Button>
            <Button variant="outline" size="sm" onClick={() => applyToAllMonths([3, 4])}>
              Apply 3rd & 4th to all
            </Button>
            <Button variant="secondary" size="sm" onClick={clearAllMonths}>
              Clear all
            </Button>
          </div>
        )}
      </div>

      <p className="text-sm text-gray-500">
        Tick which Saturday(s) of each month are holidays. Different months can use a different
        pattern - e.g. 2nd &amp; 4th Saturday most months, 3rd &amp; 4th Saturday for another.
      </p>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left font-semibold text-gray-600 px-4 py-2">Month</th>
                {OCCURRENCES.map((o) => (
                  <th key={o} className="text-center font-semibold text-gray-600 px-3 py-2">
                    {ORDINAL_LABEL[o]} Sat
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules.map((rule) => (
                <tr key={rule.month} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-700">{MONTHS[rule.month - 1]}</td>
                  {OCCURRENCES.map((occurrence) => (
                    <td key={occurrence} className="text-center px-3 py-2">
                      <input
                        type="checkbox"
                        checked={rule.occurrences.includes(occurrence)}
                        onChange={() => admin && toggleOccurrence(rule.month, occurrence)}
                        disabled={!admin}
                        className="w-4 h-4 accent-blue-600 disabled:opacity-50"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {admin && (
        <div className="flex justify-end pt-2">
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save Saturday Holidays
          </Button>
        </div>
      )}
    </div>
  );
};

export default SaturdayHolidaySettings;
