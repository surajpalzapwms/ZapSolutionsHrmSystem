import React from "react";

const CurrentStaffToggle = ({
  checked,
  onChange,
  shownCount,
  totalCount,
  // Outer wrapper classes. Default: its own right-aligned row above a table.
  // Pass e.g. "ml-auto" to place it at the right end of an existing row.
  className = "flex justify-end mb-3",
}) => {
  const showCounts =
    typeof shownCount === "number" && typeof totalCount === "number";

  return (
    <div className={className}>
      <label className="inline-flex items-center gap-3 cursor-pointer select-none">
        <span className="text-sm text-gray-700">
          {checked ? "Current staff only" : "All staff (incl. left)"}
          {showCounts && (
            <span className="ml-1 text-xs text-gray-400">
              ({shownCount} of {totalCount})
            </span>
          )}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label="Show only current staff"
          title={
            checked
              ? "Showing only staff still working here — click to show everyone"
              : "Showing everyone, including staff who have left — click to show current staff only"
          }
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 ${
            checked ? "bg-blue-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              checked ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </label>
    </div>
  );
};

export default CurrentStaffToggle;