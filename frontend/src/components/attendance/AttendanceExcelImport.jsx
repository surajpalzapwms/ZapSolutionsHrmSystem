// src/components/attendance/AttendanceExcelImport.jsx
import React, { useState } from "react";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, AlertTriangle, Download } from "lucide-react";
import Modal from "../common/Modal";
import Dropdown from "../common/Dropdown";
import Button from "../common/Button";
import { attendanceService } from "../../services/attendanceService";
import { parseAttendanceSheet } from "../../utils/parseAttendanceSheet";
import { showToast } from "../../utils/toast";

// Header-only template — matches the columns parseAttendanceSheet.js looks
// for (DATE(S) / TIME IN / TIME OUT). The whole file is imported for
// whichever staff member is picked in the dropdown below, so there's no
// per-row staff column. No sample rows, just the headers.
const ATTENDANCE_TEMPLATE_HEADERS = [
  "DATE(S)",
  "TIME IN",
  "TIME OUT",
];

const downloadAttendanceTemplate = () => {
  const ws = XLSX.utils.aoa_to_sheet([ATTENDANCE_TEMPLATE_HEADERS]);
  ws["!cols"] = ATTENDANCE_TEMPLATE_HEADERS.map(() => ({ wch: 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Attendance");
  XLSX.writeFile(wb, "attendance_import_template.xlsx");
};

// staffOptions here must be keyed by the linked login (attendance) user id,
// same as ConvertExtraHoursModal — that's what Attendance.userId points at.
const AttendanceExcelImport = ({ isOpen, onClose, staffOptions = [], onSuccess }) => {
  const [workbook, setWorkbook] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [userId, setUserId] = useState("");
  const [parsed, setParsed] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState([]);

  const reset = () => {
    setWorkbook(null);
    setSheetNames([]);
    setSelectedSheet("");
    setUserId("");
    setParsed(null);
    setImportErrors([]);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const runParse = (wb, sheetName) => {
    if (!wb || !sheetName) return;
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    setParsed(parseAttendanceSheet(rows));
    setImportErrors([]);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        // No `cellDates: true` here on purpose. SheetJS's date-cell-to-Date
        // conversion is timezone-dependent — verified directly against real
        // attendance sheets: in a UTC+5:30 (IST) browser/environment, a
        // date cell for "01 July" comes back as an instant that reads as
        // "30 June" under both local AND UTC getters, so every date in the
        // file silently lands one day early. Reading `raw: true` below
        // keeps date/time cells as their original Excel serial numbers;
        // parseAttendanceSheet.js converts those to calendar dates itself
        // using timezone-independent UTC math instead of trusting the Date
        // objects SheetJS would otherwise construct.
        const wb = XLSX.read(data, { type: "array" });
        // "final"/"summary" sheets are hand-kept running totals, not a
        // per-day sheet this importer can parse — offer everything else.
        const names = wb.SheetNames.filter((n) => !/^final$|summary/i.test(n.trim()));
        setWorkbook(wb);
        setSheetNames(names);
        const first = names[0] || "";
        setSelectedSheet(first);
        runParse(wb, first);
      } catch {
        showToast("error", "Failed to read this file — is it a valid Excel workbook?");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSheetChange = (name) => {
    setSelectedSheet(name);
    runParse(workbook, name);
  };

  // The whole file belongs to whichever staff member is selected below —
  // every row is imported for that one person.
  const buildRows = () => {
    if (!parsed || !userId) return [];
    const present = parsed.present.map((p) => ({
      userId,
      loginTime: p.loginTime,
      logoutTime: p.logoutTime,
    }));
    const absent = parsed.absent.map((a) => ({
      userId,
      status: "absent",
      date: a.dateStr,
    }));
    const halfDay = parsed.halfDay.map((h) => ({
      userId,
      status: "half-day",
      date: h.dateStr,
    }));
    return [...present, ...absent, ...halfDay];
  };

  const handleImport = async () => {
    if (!userId) {
      showToast("warning", "Select a staff member first");
      return;
    }
    const rows = buildRows();
    if (rows.length === 0) {
      showToast("warning", "Nothing to import — check the sheet has parsed rows");
      return;
    }
    try {
      setImporting(true);
      setImportErrors([]);
      const res = await attendanceService.importAttendance(rows);
      const errors = res.data?.errors || [];
      const successCount = res.data?.success ?? rows.length - errors.length;
      if (errors.length > 0) {
        // Keep the modal open and show exactly which rows failed and why —
        // e.g. one date already existed — instead of only logging to the
        // console, so a partial import (fewer days than expected) isn't a
        // silent mystery.
        setImportErrors(errors);
        if (successCount > 0) onSuccess?.();
        showToast(
          "warning",
          `Imported ${successCount} row(s), ${errors.length} failed — see details below`,
        );
      } else {
        showToast("success", res.data?.message || "Attendance imported");
        onSuccess?.();
        handleClose();
      }
    } catch (error) {
      showToast("error", error.response?.data?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const counts = parsed
    ? {
        present: parsed.present.length,
        absent: parsed.absent.length,
        halfDay: parsed.halfDay.length,
        skipped: parsed.skipped.length,
        needsReview: parsed.needsReview.length,
      }
    : null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Import Attendance from Excel" size="max-w-2xl">
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={downloadAttendanceTemplate}
          >
            <Download size={14} />
            Download Sample Excel
          </Button>
        </div>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
          <FileSpreadsheet className="mx-auto text-gray-400 mb-2" size={32} />
          <p className="text-sm text-gray-600 mb-3">
            Upload the monthly attendance workbook (DATE(S) / TIME IN / TIME OUT, with
            absent / sunday / half-day marked in the TIME IN column). A row with TIME IN but no TIME OUT
            defaults to the standard shift end (6:30 PM). Pick the staff member below — the whole file is
            imported for that one person.
          </p>
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer text-sm font-medium text-gray-700">
            <Upload size={16} />
            Choose File
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>

        {sheetNames.length > 0 && (
          <Dropdown
            label="Month sheet"
            value={selectedSheet}
            onChange={handleSheetChange}
            options={sheetNames.map((n) => ({ value: n, label: n }))}
          />
        )}

        <Dropdown
          label="Staff"
          value={userId}
          onChange={setUserId}
          options={staffOptions}
          placeholder="Select staff member"
        />

        {counts && (
          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 space-y-2">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>Present: <b>{counts.present}</b></span>
              <span>Absent: <b>{counts.absent}</b></span>
              <span>Half day: <b>{counts.halfDay}</b></span>
              <span className="text-gray-400">Skipped (Sunday/holiday): {counts.skipped}</span>
              {counts.needsReview > 0 && (
                <span className="text-amber-600 font-medium">Needs review: {counts.needsReview}</span>
              )}
            </div>
            {!userId && (
              <div className="text-xs text-red-600">
                Select a staff member above before importing.
              </div>
            )}
            {counts.needsReview > 0 && (
              <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div className="text-xs space-y-0.5">
                  {parsed.needsReview.slice(0, 8).map((r, i) => (
                    <div key={i}>
                      Row {r.rowNumber}{r.dateStr ? ` (${r.dateStr})` : ""}: {r.reason}
                    </div>
                  ))}
                  {parsed.needsReview.length > 8 && (
                    <div>...and {parsed.needsReview.length - 8} more. These rows won't be imported — fix them in the sheet or add manually.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {importErrors.length > 0 && (
          <div className="flex items-start gap-2 text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="text-xs space-y-0.5">
              <div className="font-medium">
                {importErrors.length} row(s) didn't import:
              </div>
              {importErrors.slice(0, 8).map((err, i) => (
                <div key={i}>{err}</div>
              ))}
              {importErrors.length > 8 && (
                <div>...and {importErrors.length - 8} more.</div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="success"
            onClick={handleImport}
            disabled={!parsed || !userId || buildRows().length === 0}
            loading={importing}
          >
            Import {parsed ? `(${buildRows().length})` : ""}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default AttendanceExcelImport;