// src/components/holidays/HolidayImport.jsx
import React from "react";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, Download } from "lucide-react";
import { useImport } from "../../hooks/useImport";
import { holidayService } from "../../services/holidayService";
import Button from "../common/Button";

// Sample rows show the expected shape, including how a multi-day holiday
// like Diwali should be entered as one row per day so the import step can
// merge them into a single date range.
const TEMPLATE_ROWS = [
  {
    "Holiday Name": "Diwali",
    Date: new Date(2026, 10, 7),
    Remarks: "Festival of lights",
  },
  { "Holiday Name": "Diwali", Date: new Date(2026, 10, 8), Remarks: "" },
  { "Holiday Name": "Christmas", Date: new Date(2026, 11, 25), Remarks: "" },
];

const downloadHolidayTemplate = () => {
  const ws = XLSX.utils.json_to_sheet(TEMPLATE_ROWS);
  ws["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Holidays");
  XLSX.writeFile(wb, "holiday_import_template.xlsx");
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Normalizes a header cell value into a real Date (or null if it can't be
// parsed). Handles JS Date objects (the normal case now that useImport reads
// with cellDates: true), Excel serial numbers, and text dates typed directly
// into a cell (which Excel stores as plain strings, not date values).
//
// IMPORTANT: text dates are parsed as day-first (DD/MM/YYYY), matching how
// this org enters dates everywhere else. JS's native `new Date("21/03/2026")`
// assumes US month/day/year order instead - for a day > 12 that's an
// Invalid Date (silently dropped), and for a day <= 12 it silently swaps day
// and month (e.g. "04/09/2026" becomes 9 Apr instead of 4 Sep). Both failure
// modes matched what showed up on the Holidays screen, so the explicit
// day-first parsing below is handled before ever falling back to `new Date`.
const parseCellDate = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === "number") {
    // Excel serial date: days since 1899-12-30
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const asDate = new Date(epoch.getTime() + value * ONE_DAY_MS);
    return Number.isNaN(asDate.getTime()) ? null : asDate;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    // ISO / year-first: 2026-11-07 or 2026/11/07
    let m = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (m) {
      const [, y, mo, d] = m;
      const date = new Date(Number(y), Number(mo) - 1, Number(d));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    // Day-first: 07/11/2026 or 07-11-2026
    m = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) {
      const [, d, mo, y] = m;
      const day = Number(d);
      const month = Number(mo);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      const date = new Date(Number(y), month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    // Fallback for anything else (e.g. "7 Nov 2026") - unambiguous formats
    // like this are safe to hand to the native parser.
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
};

const atDayStart = (date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const firstDefined = (row, keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return "";
};

// Flattens every row into one entry per calendar day. Supports both the new
// "Holiday Name / Date / Remarks" format (one row per day) and the older
// "name / startDate / endDate / description" export format (one row per
// range) so a previously exported file can still be re-imported.
const toDailyEntries = (rawRows) => {
  const entries = [];

  rawRows.forEach((row) => {
    const name = String(
      firstDefined(row, ["Holiday Name", "name", "Name"]),
    ).trim();
    const description = String(
      firstDefined(row, ["Remarks", "remarks", "Description", "description"]),
    ).trim();

    const singleDateRaw = firstDefined(row, ["Date", "date"]);
    if (singleDateRaw !== "") {
      entries.push({ name, date: parseCellDate(singleDateRaw), description });
      return;
    }

    const startRaw = firstDefined(row, ["Start Date", "startDate"]);
    if (startRaw !== "") {
      const endRaw = firstDefined(row, ["End Date", "endDate"]) || startRaw;
      const start = parseCellDate(startRaw);
      const end = parseCellDate(endRaw) || start;
      if (start && end && start <= end) {
        const cursor = new Date(start);
        while (cursor <= end) {
          entries.push({ name, date: new Date(cursor), description });
          cursor.setDate(cursor.getDate() + 1);
        }
      } else {
        entries.push({ name, date: null, description });
      }
      return;
    }

    // No recognizable date column - keep it as an invalid entry so the
    // backend's per-row validation reports it instead of silently dropping it.
    entries.push({ name, date: null, description });
  });

  return entries;
};

// Groups same-name daily entries and merges any that fall on consecutive
// calendar days into a single startDate/endDate range, e.g. Diwali on
// 7 Nov 2026 and 8 Nov 2026 becomes one holiday spanning both days.
const mergeConsecutiveHolidays = (rawRows) => {
  const daily = toDailyEntries(rawRows);

  const groups = new Map();
  daily.forEach((entry) => {
    const key = entry.name.toLowerCase();
    if (!groups.has(key))
      groups.set(key, { displayName: entry.name, entries: [] });
    groups.get(key).entries.push(entry);
  });

  const merged = [];

  groups.forEach(({ displayName, entries }) => {
    // Rows that never resolved to a valid date are passed through as-is so
    // the backend still reports "invalid date format" for that row.
    entries
      .filter((e) => !e.date)
      .forEach((e) => {
        merged.push({
          name: displayName,
          startDate: "",
          endDate: "",
          description: e.description,
        });
      });

    const validEntries = entries
      .filter((e) => e.date)
      .sort((a, b) => a.date - b.date);

    let rangeStart = null;
    let rangeEnd = null;
    let rangeDescription = "";

    const flushRange = () => {
      if (!rangeStart) return;
      merged.push({
        name: displayName,
        startDate: rangeStart.toISOString(),
        endDate: rangeEnd.toISOString(),
        description: rangeDescription,
      });
    };

    validEntries.forEach((entry) => {
      const day = atDayStart(entry.date);
      if (!rangeStart) {
        rangeStart = day;
        rangeEnd = day;
        rangeDescription = entry.description;
        return;
      }
      const diffDays = Math.round((day - rangeEnd) / ONE_DAY_MS);
      if (diffDays <= 1) {
        // consecutive day (diffDays === 1) or a duplicate row for the same
        // day (diffDays === 0) both extend/hold the current range
        if (diffDays === 1) rangeEnd = day;
        if (!rangeDescription && entry.description)
          rangeDescription = entry.description;
      } else {
        flushRange();
        rangeStart = day;
        rangeEnd = day;
        rangeDescription = entry.description;
      }
    });
    flushRange();
  });

  return merged;
};

const formatShortDate = (isoString) =>
  new Date(isoString).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const HolidayImport = ({ onSuccess, onCancel }) => {
  const { parsedData, uploading, handleFileUpload, importData } = useImport(
    holidayService.import,
    { transform: mergeConsecutiveHolidays },
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
      <div className="flex justify-end">
        <button
          type="button"
          onClick={downloadHolidayTemplate}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          <Download size={14} />
          Download Template
        </button>
      </div>

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
        <FileSpreadsheet className="mx-auto text-gray-400 mb-2" size={32} />
        <p className="text-sm text-gray-600 mb-3">
          Upload an Excel/CSV file with columns: Holiday Name, Date, Remarks.
          Consecutive rows with the same holiday name (e.g. Diwali on 7 Nov and
          8 Nov) are automatically combined into a single multi-day holiday.
        </p>
        <label className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer text-sm font-medium text-gray-700">
          <Upload size={16} />
          Choose File
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileUpload}
          />
        </label>
      </div>

      {parsedData.length > 0 && (
        <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto">
          <p className="font-medium text-gray-700">
            {parsedData.length} holiday{parsedData.length === 1 ? "" : "s"}{" "}
            ready to import:
          </p>
          {parsedData.map((h, idx) => (
            <div key={idx} className="flex justify-between gap-2">
              <span className="truncate">{h.name || "(missing name)"}</span>
              <span className="text-gray-400 shrink-0">
                {h.startDate
                  ? h.startDate === h.endDate
                    ? formatShortDate(h.startDate)
                    : `${formatShortDate(h.startDate)} - ${formatShortDate(h.endDate)}`
                  : "invalid date"}
              </span>
            </div>
          ))}
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

export default HolidayImport;
