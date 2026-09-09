const HEADER_MATCHERS = {
  date: /^date/i,
  timeIn: /time\s*in/i,
  timeOut: /time\s*out/i,
};

const findHeader = (rows) => {
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const row = rows[r] || [];
    const dateCol = row.findIndex(
      (cell) => typeof cell === "string" && HEADER_MATCHERS.date.test(cell.trim()),
    );
    if (dateCol === -1) continue;
    const cols = { date: dateCol };
    row.forEach((cell, i) => {
      if (typeof cell !== "string") return;
      const trimmed = cell.trim();
      for (const [key, re] of Object.entries(HEADER_MATCHERS)) {
        if (key !== "date" && re.test(trimmed)) cols[key] = i;
      }
    });
    return { headerRowIndex: r, cols };
  }
  return null;
};
const DEFAULT_TIME_IN = { h: 10, m: 0 };
const DEFAULT_TIME_OUT = { h: 18, m: 30 };

const pad2 = (n) => String(n).padStart(2, "0");

// Excel stores dates/times as serial numbers: the integer part is days
// since 1899-12-30, the fractional part is time-of-day as a fraction of 24h.
// 25569 is the day-count offset between Excel's day-0 and the JS epoch
// (1970-01-01), so this converts an Excel serial straight to a UTC instant
// with no dependency on any timezone.
//
// We deliberately do NOT let SheetJS's `cellDates: true` do this conversion
// for us (see AttendanceExcelImport.jsx). That option builds a JS Date from
// the serial in a way that depends on the machine's local timezone offset —
// tested directly against this sheet: in a UTC+5:30 (IST) environment, the
// "01 July 2025" cell (serial 45839) comes back as an instant of
// 2025-06-30T18:29:50Z, which reads as 30 June under BOTH local and UTC
// getters. The corruption happens to the underlying timestamp itself before
// we ever get a chance to read it, so no choice of getter downstream can
// fix it — every date in the sheet silently lands one day early. Doing the
// serial math ourselves, anchored purely to UTC, sidesteps that entirely.
const EXCEL_EPOCH_OFFSET_DAYS = 25569;

const excelSerialToUTCDate = (serial) =>
  new Date(Math.round((serial - EXCEL_EPOCH_OFFSET_DAYS) * 86400 * 1000));

const excelSerialToTime = (serial) => {
  // Keep just the time-of-day fraction, in case a full date+time serial
  // ends up in a TIME IN/OUT cell instead of a pure time.
  const frac = serial - Math.floor(serial);
  const totalSeconds = Math.round(frac * 86400);
  const h = Math.floor(totalSeconds / 3600) % 24;
  const m = Math.floor((totalSeconds % 3600) / 60);
  return { h, m };
};

const toDateStringUTC = (d) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

// Back-compat only: if a Date object ever does show up here (e.g. cellDates
// gets re-enabled upstream by mistake), read it with UTC getters — same
// TZ-safety reasoning as excelSerialToUTCDate. This does NOT undo the
// SheetJS timezone bug described above; it just avoids compounding it with
// a second, local-getter-based misread.
const timeFromDateObj = (d) => ({ h: d.getUTCHours(), m: d.getUTCMinutes() });

const parseTimeString = (str) => {
  const s = str.trim().toLowerCase();
  const m = s.match(/^(\d{1,2})[.:](\d{2})\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3];
  if (!ampm) return null; // ambiguous 24h vs 12h — flag for manual review instead
  if (ampm === "pm" && h !== 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
};

const readTime = (cell) => {
  if (typeof cell === "number") return excelSerialToTime(cell);
  if (cell instanceof Date) return timeFromDateObj(cell);
  if (typeof cell === "string") return parseTimeString(cell);
  return null;
};

const STATUS_PATTERNS = [
  { status: "half-day", re: /haf|half/i },
  { status: "absent", re: /absent|abs\b/i },
  { status: "skip", re: /sun|week.?off|w\/?o|holiday|off\b/i },
];

/**
 * @param {Array<Array<any>>} rows - sheet_to_json(ws, {header: 1, raw: true}) output.
 *   The workbook MUST be read WITHOUT `cellDates: true` (see
 *   AttendanceExcelImport.jsx) so date/time cells arrive as raw Excel serial
 *   numbers rather than timezone-corrupted Date objects.
 * @returns {{
 *   present: Array<{dateStr, loginTime, logoutTime}>,
 *   absent: Array<{dateStr}>,
 *   halfDay: Array<{dateStr}>,
 *   skipped: Array<{dateStr, reason}>,
 *   needsReview: Array<{rowNumber, dateStr, reason}>,
 * }}
 */
export const parseAttendanceSheet = (rows) => {
  const result = { present: [], absent: [], halfDay: [], skipped: [], needsReview: [] };
  const header = findHeader(rows);
  if (!header) {
    result.needsReview.push({ rowNumber: 1, dateStr: null, reason: "Could not find a DATE(S) header row on this sheet" });
    return result;
  }
  const { headerRowIndex, cols } = header;

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const dateCell = row[cols.date];
    if (dateCell == null || dateCell === "") continue; // blank spacer row

    let dateObj;
    if (typeof dateCell === "number") {
      dateObj = excelSerialToUTCDate(dateCell);
    } else if (dateCell instanceof Date) {
      dateObj = dateCell; // back-compat, see comment above
    } else {
      result.needsReview.push({ rowNumber: r + 1, dateStr: String(dateCell), reason: "Date cell isn't a recognizable date" });
      continue;
    }
    const dateStr = toDateStringUTC(dateObj);
    const timeInCell = row[cols.timeIn];

    if (timeInCell == null || timeInCell === "") {
      result.needsReview.push({ rowNumber: r + 1, dateStr, reason: "No TIME IN / status value" });
      continue;
    }

    if (typeof timeInCell === "string") {
      const matched = STATUS_PATTERNS.find((p) => p.re.test(timeInCell));
      if (matched) {
        if (matched.status === "absent") result.absent.push({ dateStr });
        else if (matched.status === "half-day") result.halfDay.push({ dateStr });
        else result.skipped.push({ dateStr, reason: timeInCell.trim() });
        continue;
      }
    }
    const outCell = row[cols.timeOut];
    const inTime = readTime(timeInCell);
    let outTime = readTime(outCell);
    if (inTime && !outTime && (outCell == null || outCell === "")) {
      outTime = DEFAULT_TIME_OUT;
    }

    if (!inTime || !outTime) {
      result.needsReview.push({
        rowNumber: r + 1,
        dateStr,
        reason: !inTime
          ? `Unrecognized TIME IN value: "${timeInCell}"`
          : `Unrecognized/missing TIME OUT value: "${outCell ?? ""}"`,
      });
      continue;
    }

    const loginTime = `${dateStr}T${pad2(inTime.h)}:${pad2(inTime.m)}:00`;

    const logoutTime = `${dateStr}T${pad2(outTime.h)}:${pad2(outTime.m)}:00`;
    result.present.push({ dateStr, loginTime, logoutTime });
  }

  return result;
};