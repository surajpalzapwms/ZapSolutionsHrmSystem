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

// A TIME IN written without AM/PM with an hour below this is treated as PM
// (nobody signs in at 1–6 AM; "2:15" means 2:15 PM, e.g. a half-day start).
const EARLIEST_REAL_LOGIN_HOUR = 7;

const pad2 = (n) => String(n).padStart(2, "0");

// Excel stores dates/times as serial numbers: the integer part is days
// since 1899-12-30, the fractional part is time-of-day as a fraction of 24h.
// 25569 is the day-count offset between Excel's day-0 and the JS epoch
// (1970-01-01), so this converts an Excel serial straight to a UTC instant
// with no dependency on any timezone.
//
// We deliberately do NOT let SheetJS's `cellDates: true` do this conversion
// (see AttendanceExcelImport.jsx) — in IST it shifts every date one day
// early. Doing the serial math ourselves, anchored to UTC, avoids that.
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
  return { h, m, hasMeridiem: true }; // Excel time is already 24h — exact
};

const toDateStringUTC = (d) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

// Back-compat only (if cellDates ever gets re-enabled upstream).
const timeFromDateObj = (d) => ({
  h: d.getUTCHours(),
  m: d.getUTCMinutes(),
  hasMeridiem: true,
});

// Removes hidden characters Excel/copy-paste often leaves in cells
// (non-breaking space, zero-width space, BOM, ...).
const cleanText = (str) =>
  String(str)
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Parses a text time. Accepts:
 *   "09:25", "9:25", "09:25:00", "9.25", "0925", "925"   (no AM/PM)
 *   "9:25 AM", "06:30PM", "6:30 p.m.", "6 pm"             (with AM/PM)
 *   "0.3923611"                                           (Excel fraction as text)
 * Returns { h, m, hasMeridiem } or null.
 * `hasMeridiem: false` means the hour is as written and may still need an
 * AM/PM decision — see resolveTimeIn / resolveTimeOut below.
 */
const parseTimeString = (str) => {
  let s = cleanText(str);
  if (!s) return null;

  // Excel time fraction stored as text
  if (/^0?\.\d+$/.test(s)) return excelSerialToTime(Number(s));

  // AM / PM suffix
  let meridiem = null;
  const mer = s.match(/\s*([ap])\.?\s?m\.?$/);
  if (mer) {
    meridiem = mer[1];
    s = s.slice(0, mer.index).trim();
  }

  let h;
  let min;
  let match;
  if ((match = s.match(/^(\d{1,2})[.:](\d{2})(?:[.:]\d{2})?$/))) {
    h = parseInt(match[1], 10);
    min = parseInt(match[2], 10);
  } else if ((match = s.match(/^(\d{3,4})$/))) {
    const digits = match[1].padStart(4, "0");
    h = parseInt(digits.slice(0, 2), 10);
    min = parseInt(digits.slice(2), 10);
  } else if ((match = s.match(/^(\d{1,2})$/)) && meridiem) {
    h = parseInt(match[1], 10);
    min = 0;
  } else {
    return null;
  }

  if (min > 59) return null;

  if (meridiem) {
    if (h < 1 || h > 12) return null;
    if (meridiem === "p" && h !== 12) h += 12;
    if (meridiem === "a" && h === 12) h = 0;
    return { h, m: min, hasMeridiem: true };
  }

  if (h > 23) return null;
  // 13:00–23:59 is clearly 24-hour already.
  return { h, m: min, hasMeridiem: h >= 13 };
};

const readTime = (cell) => {
  if (typeof cell === "number") return excelSerialToTime(cell);
  if (cell instanceof Date) return timeFromDateObj(cell);
  if (typeof cell === "string") return parseTimeString(cell);
  return null;
};

const toMinutes = (t) => t.h * 60 + t.m;

// TIME IN without AM/PM: "09:25" stays 09:25; "2:15" becomes 14:15.
const resolveTimeIn = (t) => {
  if (!t) return null;
  if (t.hasMeridiem) return { h: t.h, m: t.m };
  if (t.h >= 1 && t.h < EARLIEST_REAL_LOGIN_HOUR) return { h: t.h + 12, m: t.m };
  return { h: t.h, m: t.m };
};

// TIME OUT without AM/PM: "06:30" after a 09:25 login becomes 18:30.
// Any out-time that would be at/before the login gets +12h if that fixes it.
const resolveTimeOut = (t, inTime) => {
  if (!t) return null;
  let out = { h: t.h, m: t.m };
  if (!t.hasMeridiem && inTime && toMinutes(out) <= toMinutes(inTime) && out.h < 12) {
    out = { h: out.h + 12, m: out.m };
  }
  return out;
};

const STATUS_PATTERNS = [
  { status: "half-day", re: /haf|half/i },
  { status: "absent", re: /absent|abs\b/i },
  { status: "skip", re: /sun|week.?off|w\/?o|holiday|off\b/i },
];

const isBlank = (cell) => cell == null || (typeof cell === "string" && cleanText(cell) === "");

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
    result.needsReview.push({
      rowNumber: 1,
      dateStr: null,
      reason: "Could not find a DATE(S) header row on this sheet",
    });
    return result;
  }
  const { headerRowIndex, cols } = header;

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const dateCell = row[cols.date];
    if (isBlank(dateCell)) continue; // blank spacer row

    let dateObj;
    if (typeof dateCell === "number") {
      dateObj = excelSerialToUTCDate(dateCell);
    } else if (dateCell instanceof Date) {
      dateObj = dateCell; // back-compat, see comment above
    } else {
      result.needsReview.push({
        rowNumber: r + 1,
        dateStr: String(dateCell),
        reason: "Date cell isn't a recognizable date",
      });
      continue;
    }
    const dateStr = toDateStringUTC(dateObj);
    const timeInCell = row[cols.timeIn];

    if (isBlank(timeInCell)) {
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
    const inTime = resolveTimeIn(readTime(timeInCell));
    let outTime = isBlank(outCell) ? null : resolveTimeOut(readTime(outCell), inTime);
    if (inTime && isBlank(outCell)) {
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

    if (toMinutes(outTime) <= toMinutes(inTime)) {
      result.needsReview.push({
        rowNumber: r + 1,
        dateStr,
        reason: `TIME OUT "${outCell ?? ""}" is not after TIME IN "${timeInCell}"`,
      });
      continue;
    }

    const loginTime = `${dateStr}T${pad2(inTime.h)}:${pad2(inTime.m)}:00`;
    const logoutTime = `${dateStr}T${pad2(outTime.h)}:${pad2(outTime.m)}:00`;
    result.present.push({ dateStr, loginTime, logoutTime });
  }

  return result;
};

export { DEFAULT_TIME_IN, DEFAULT_TIME_OUT };