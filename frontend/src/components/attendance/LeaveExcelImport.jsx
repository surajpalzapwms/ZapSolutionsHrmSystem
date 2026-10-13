// src/components/attendance/LeaveExcelImport.jsx
import React, { useState } from "react";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, Download, AlertTriangle } from "lucide-react";
import Modal from "../common/Modal";
import Dropdown from "../common/Dropdown";
import Button from "../common/Button";
import { attendanceService } from "../../services/attendanceService";
import { showToast } from "../../utils/toast";

const pad2 = (n) => String(n).padStart(2, "0");
// UTC, not local: every Date this file builds is deliberately constructed
// via Date.UTC (see the Excel-serial branch below), so it must be read
// back the same way. Reading it with local getters is what caused the
// "leave lands on the wrong day" bug for anyone west of UTC (imports read
// one day early) — see the comment on parseFlexibleDate for how a genuine
// JS Date object made it worse.
const toDateString = (d) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const addDays = (base, n) => {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
};

// Whether "11/20/2025" means 20 Nov or is nonsense (no 20th month) depends
// entirely on the reader's Excel locale — that's exactly why mixing date
// formats in one sheet made rows vanish: "2025-08-12" is unambiguous ISO
// and always survives, but a slash-date typed on an Indian-locale Excel
// (day/month/year) either silently mis-reads or fails to convert to a real
// date cell at all, so it arrived here as plain text and got dropped.
// This normalizes every date — an Excel serial number, or common typed
// text — down to one canonical YYYY-MM-DD, and only when a slash/dash date
// is genuinely ambiguous (both parts could be day or month) does it get
// reported instead of silently guessed wrong.
//
// Deliberately does NOT handle `raw instanceof Date`: that would mean the
// workbook was read with SheetJS's `cellDates: true`, which we no longer
// pass (see handleFileUpload) — SheetJS builds those Date objects using
// the *browser's local timezone* to interpret a value that has no
// timezone at all, and for any host east of UTC that silently lands the
// Date object itself on the wrong day (a cell meant to be 12 Aug decoded
// as 11 Aug in IST — confirmed by direct test) before this function ever
// gets to read it, so no getter choice here could recover it. Reading the
// raw Excel serial number instead sidesteps that conversion entirely.
const parseFlexibleDate = (raw) => {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Excel serial date (days since 1899-12-30) — can show up when a
    // date-formatted cell comes through as a raw number.
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + raw * 86400000);
    if (!isNaN(d.getTime())) return { dateStr: toDateString(d) };
    return { error: `unreadable date value "${raw}"` };
  }
  const str = String(raw ?? "").trim();
  if (!str) return { error: "empty date" };

  // ISO-style: YYYY-MM-DD or YYYY/MM/DD (1- or 2-digit month/day too).
  let m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const [, y, mo, da] = m;
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(da) >= 1 && Number(da) <= 31) {
      return { dateStr: `${y}-${pad2(mo)}-${pad2(da)}` };
    }
    return { error: `invalid date "${str}"` };
  }

  // DD/MM/YYYY, DD-MM-YYYY, MM/DD/YYYY, MM-DD-YYYY — only resolved when
  // unambiguous (one side can't possibly be a month).
  m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3];
    let day, month;
    if (a > 12 && b <= 12) {
      day = a;
      month = b; // only valid read as DD/MM/YYYY
    } else if (b > 12 && a <= 12) {
      day = b;
      month = a; // only valid read as MM/DD/YYYY
    } else {
      return {
        error: `ambiguous date "${str}" (could be DD/MM/YYYY or MM/DD/YYYY) — re-enter as YYYY-MM-DD`,
      };
    }
    return { dateStr: `${y}-${pad2(month)}-${pad2(day)}` };
  }

  return { error: `unrecognized date format "${str}" — use YYYY-MM-DD` };
};

// The staff member is already chosen once, up front, via the dropdown below
// — there's no need for a "Staff Email" column repeating it on every row.
// Likewise every row imported by an admin is a settled record, so "Status"
// always defaults to "approved" instead of asking for a column too.
const LEAVE_TEMPLATE_HEADERS = ["Date", "Reason", "Type"];
const LEAVE_TYPE_OPTIONS = ["paid", "unpaid", "sick", "casual", "swapleave"];
// Comma-joined and quoted the way Excel's in-cell "List" data validation
// expects its formula: "paid,unpaid,sick,casual,swapleave".
const LEAVE_TYPE_LIST_FORMULA = `"${LEAVE_TYPE_OPTIONS.join(",")}"`;
// How many blank rows below the examples also get the dropdown, so an
// admin adding more rows still gets the picker instead of free-typing.
const TEMPLATE_DROPDOWN_ROWS = 200;

// A blank template with headers only doesn't show what the "Type" column
// actually expects, and free-typing it invites typos ("Casaul leave") that
// silently fail to import. This uses ExcelJS (unlike the plain `xlsx`
// library used elsewhere, it can write real in-cell dropdown data
// validation) so every Type cell — including blank rows below the
// examples — is a pick-from-list dropdown restricted to the exact values
// the importer accepts.
const downloadLeaveTemplate = async ({ onError } = {}) => {
  try {
    // ExcelJS is ~950 KB — only fetched when the template is downloaded.
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Leaves");
    ws.columns = LEAVE_TEMPLATE_HEADERS.map((header) => ({ header, width: 22 }));
    ws.getRow(1).font = { bold: true };

    const today = new Date();
    const isoText = (d) => toDateString(d); // "YYYY-MM-DD" as plain text
    const sampleRows = [
      [isoText(today), "Family function", "casual"],
      [isoText(addDays(today, 1)), "Fever", "sick"],
      [isoText(addDays(today, 2)), "Planned personal leave", "paid"],
      [isoText(addDays(today, 3)), "Personal work", "unpaid"],
    ];
    sampleRows.forEach((row) => ws.addRow(row));

    // The Date column is fixed as Text (not Excel's "Date" cell type) so a
    // typed value like "11/20/2025" is kept exactly as-is rather than being
    // silently auto-converted (or silently rejected) based on the local
    // Excel install's date locale — that locale-dependent conversion is
    // exactly what made rows disappear when formats were mixed in one
    // sheet. Sample values above are plain "YYYY-MM-DD" text for the same
    // reason. A custom validation formula then enforces that exact shape
    // for every row, sample or new, so one format is used throughout.
    const dateValidationFormula =
      `AND(LEN(A2)=10,MID(A2,5,1)="-",MID(A2,8,1)="-",` +
      `ISNUMBER(VALUE(LEFT(A2,4))),ISNUMBER(VALUE(MID(A2,6,2))),ISNUMBER(VALUE(RIGHT(A2,2))))`;

    // Dropdown on Type, and a format guard on Date, for the sample rows
    // plus a generous run of blank rows underneath — so rows an admin adds
    // later still get the same guardrails instead of silently reverting to
    // free text/mixed formats.
    for (let r = 2; r <= TEMPLATE_DROPDOWN_ROWS; r++) {
      ws.getCell(`A${r}`).numFmt = "@"; // Text format, not Date
      ws.getCell(`A${r}`).dataValidation = {
        type: "custom",
        allowBlank: true,
        formulae: [dateValidationFormula.replace(/A2/g, `A${r}`)],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Invalid Date Format",
        error: "Enter the date as YYYY-MM-DD (e.g. 2025-08-12), as text.",
      };
      ws.getCell(`C${r}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [LEAVE_TYPE_LIST_FORMULA],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Invalid Leave Type",
        error: `Pick one of: ${LEAVE_TYPE_OPTIONS.join(", ")}`,
      };
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leave_import_template.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    onError?.(err);
  }
};

const HEADER_KEY = {
  date: /^(leave\s*)?date$/i,
  reason: /^reason$/i,
  leaveType: /^(leave\s*)?type$/i,
};

const mapHeaders = (headerRow) => {
  const cols = {};
  headerRow.forEach((cell, i) => {
    if (typeof cell !== "string") return;
    const trimmed = cell.trim();
    for (const [key, re] of Object.entries(HEADER_KEY)) {
      if (re.test(trimmed)) cols[key] = i;
    }
  });
  return cols;
};

// People naturally type "Casual Leave" / "Sick Leave" / "Paid Leave" rather
// than the bare backend enum values ("casual"/"sick"/"paid") — mapping those
// common labels here means the row still imports correctly (and therefore
// still shows up on the attendance calendar) instead of failing validation
// on the backend and being dropped without the admin noticing. The template
// above steers people to the exact dropdown values, so this is now mostly a
// safety net for older sheets or manual edits.
const LEAVE_TYPE_ALIASES = {
  paid: "paid",
  "paid leave": "paid",
  unpaid: "unpaid",
  "unpaid leave": "unpaid",
  sick: "sick",
  "sick leave": "sick",
  casual: "casual",
  "casual leave": "casual",
  swap: "swapleave",
  swapleave: "swapleave",
  "swap leave": "swapleave",
};
const VALID_LEAVE_TYPES = new Set(LEAVE_TYPE_OPTIONS);

const normalizeLeaveType = (raw) => {
  if (raw == null || raw === "") return "unpaid";
  const key = String(raw).trim().toLowerCase();
  return LEAVE_TYPE_ALIASES[key] || key;
};

// Every error string arrives as "Row N: <message>", and the message often
// (not always — e.g. "Missing leaveDate or reason" has no date) embeds the
// leaveDate as a plain YYYY-MM-DD. Splitting these out into Row / Date /
// Details columns instead of dumping the raw sentence makes a batch of
// failures scannable instead of a wall of near-identical text.
const ROW_PREFIX_RE = /^Row (\d+):\s*(.*)$/;
const EMBEDDED_DATE_RE = /\d{4}-\d{2}-\d{2}/;
const parseErrorEntry = (errStr) => {
  const m = String(errStr).match(ROW_PREFIX_RE);
  const row = m ? m[1] : "—";
  const detail = m ? m[2] : String(errStr);
  const dateMatch = detail.match(EMBEDDED_DATE_RE);
  return { row, date: dateMatch ? dateMatch[0] : "—", detail };
};

// Shared table for all three error lists below (bad dates, bad types, and
// import failures) — scrolls internally so a large batch of failures
// doesn't blow out the modal, with a sticky header so Row/Date/Details
// stay visible while scrolling.
const ErrorTable = ({ heading, errors }) => {
  if (errors.length === 0) return null;
  const parsed = errors.map(parseErrorEntry);
  return (
    <div className="text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
      <div className="flex items-start gap-2 text-xs font-medium mb-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>{heading}</span>
      </div>
      <div className="max-h-56 overflow-y-auto rounded border border-red-100">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-red-100 text-red-800">
            <tr>
              <th className="text-left px-2 py-1 font-medium w-14">Row</th>
              <th className="text-left px-2 py-1 font-medium w-24">Date</th>
              <th className="text-left px-2 py-1 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {parsed.map((p, i) => (
              <tr key={i} className="border-t border-red-100 odd:bg-white even:bg-red-50/60">
                <td className="px-2 py-1 align-top">{p.row}</td>
                <td className="px-2 py-1 align-top whitespace-nowrap">{p.date}</td>
                <td className="px-2 py-1 align-top">{p.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const LeaveExcelImport = ({ isOpen, onClose, staffOptions = [], onSuccess }) => {
  const [rows, setRows] = useState([]);
  const [skipped, setSkipped] = useState(0);
  const [invalidTypeRows, setInvalidTypeRows] = useState([]);
  const [invalidDateRows, setInvalidDateRows] = useState([]);
  const [userId, setUserId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState([]);

  const reset = () => {
    setRows([]);
    setSkipped(0);
    setInvalidTypeRows([]);
    setInvalidDateRows([]);
    setUserId("");
    setImportErrors([]);
  };
  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        // No `cellDates: true` here — see the comment on parseFlexibleDate
        // for why letting SheetJS pre-convert date cells to JS Date
        // objects is exactly what shifted imported leave dates back by a
        // day for users east of UTC (e.g. IST). Reading raw always gives
        // the Excel serial number instead, which is timezone-agnostic.
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
        const cols = mapHeaders(sheetRows[0] || []);
        if (cols.date == null || cols.reason == null) {
          showToast("error", "Couldn't find Date and Reason columns in the first row");
          return;
        }
        let skippedCount = 0;
        const parsedRows = [];
        const badTypeRows = [];
        const badDateRows = [];
        for (let r = 1; r < sheetRows.length; r++) {
          const row = sheetRows[r] || [];
          const dateCell = row[cols.date];
          const reason = row[cols.reason];
          if (dateCell == null || dateCell === "") continue; // blank row
          if (!reason) {
            skippedCount++;
            continue;
          }
          const parsedDate = parseFlexibleDate(dateCell);
          if (parsedDate.error) {
            badDateRows.push(`Row ${r + 1}: ${parsedDate.error}`);
            continue;
          }
          const leaveType = normalizeLeaveType(
            cols.leaveType != null ? row[cols.leaveType] : "unpaid",
          );
          // A type the importer can't recognize (typo, or a label not in
          // LEAVE_TYPE_ALIASES) would otherwise fail silently on the
          // backend and never reach the calendar — flag it here instead so
          // it's visible before the import is even sent.
          if (!VALID_LEAVE_TYPES.has(leaveType)) {
            badTypeRows.push(
              `Row ${r + 1}: unrecognized Type "${row[cols.leaveType]}" (use paid, unpaid, sick, casual or swapleave)`,
            );
            continue;
          }
          parsedRows.push({
            leaveDate: parsedDate.dateStr,
            reason: String(reason).trim(),
            leaveType,
            // Every row imported this way is a completed record for the
            // staff member picked below — always approved, never a column.
            status: "approved",
          });
        }
        setRows(parsedRows);
        setSkipped(skippedCount);
        setInvalidTypeRows(badTypeRows);
        setInvalidDateRows(badDateRows);
        setImportErrors([]);
      } catch {
        showToast("error", "Failed to read this file — is it a valid Excel workbook?");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const buildPayload = () =>
    userId ? rows.map((r) => ({ userId, ...r })) : [];

  const handleImport = async () => {
    if (!userId) {
      showToast("warning", "Pick a staff member first");
      return;
    }
    const payload = buildPayload();
    if (payload.length === 0) {
      showToast("warning", "No parsed rows to import — check the file has Date, Reason and Type columns");
      return;
    }
    try {
      setImporting(true);
      setImportErrors([]);
      const res = await attendanceService.importLeaves(payload);
      const errors = res.data?.errors || [];
      const warnings = res.data?.warnings || [];
      if (warnings.length > 0) {
        showToast(
          "info",
          `${warnings.length} day(s) saved as Unpaid because the leave balance was used up`,
        );
      }
      const successCount = res.data?.importedCount ?? payload.length - errors.length;
      if (errors.length > 0) {
        // Keep the modal open and show exactly which rows failed and why
        // (e.g. a duplicate date, or a holiday) instead of only logging to
        // the console — a partial import silently swallowed here is
        // exactly why leaves could "import" but never show on the calendar.
        setImportErrors(errors);
        if (successCount > 0) onSuccess?.();
        showToast(
          "warning",
          `Imported ${successCount} row(s), ${errors.length} failed — see details below`,
        );
      } else {
        showToast("success", res.data?.message || "Leaves imported");
        onSuccess?.();
        handleClose();
      }
    } catch (error) {
      showToast("error", error.response?.data?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Import Leaves from Excel" size="max-w-2xl">
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              downloadLeaveTemplate({
                onError: () => showToast("error", "Couldn't generate the sample file"),
              })
            }
          >
            <Download size={14} />
            Download Sample Excel
          </Button>
        </div>

        <Dropdown
          label="Staff"
          required
          value={userId}
          onChange={setUserId}
          options={staffOptions}
          placeholder="Select the staff member this file is for"
        />

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
          <FileSpreadsheet className="mx-auto text-gray-400 mb-2" size={32} />
          <p className="text-sm text-gray-600 mb-3">
            Upload a sheet with columns: Date, Reason, Type.{" "}
            <strong>Date</strong>: use <strong>YYYY-MM-DD</strong> (e.g. 2025-08-12) —
            stick to one format throughout the sheet, since mixing formats
            is exactly what causes rows to silently disappear.{" "}
            <strong>Type</strong> accepts <strong>paid</strong>,{" "}
            <strong>unpaid</strong>, <strong>sick</strong>, <strong>casual</strong> or{" "}
            <strong>swapleave</strong> (also understands "Casual Leave", "Sick
            Leave", "Paid Leave", etc.). Every row is imported for the staff
            member picked above and saved as approved.
          </p>
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer text-sm font-medium text-gray-700">
            <Upload size={16} />
            Choose File
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>

        {rows.length > 0 && (
          <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 space-y-1">
            <div>
              {rows.length} record(s) ready to import.
              {skipped > 0 && <span className="text-amber-600"> {skipped} row(s) skipped (missing/invalid date or reason).</span>}
            </div>
          </div>
        )}

        <ErrorTable
          heading={`${invalidDateRows.length} row(s) have an unrecognized or ambiguous Date and won't be imported:`}
          errors={invalidDateRows}
        />

        <ErrorTable
          heading={`${invalidTypeRows.length} row(s) have an unrecognized Type and won't be imported:`}
          errors={invalidTypeRows}
        />

        <ErrorTable
          heading={`${importErrors.length} row(s) didn't import:`}
          errors={importErrors}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="success"
            onClick={handleImport}
            disabled={buildPayload().length === 0}
            loading={importing}
          >
            Import {buildPayload().length > 0 ? `(${buildPayload().length})` : ""}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default LeaveExcelImport;