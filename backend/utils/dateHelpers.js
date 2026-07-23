// utils/dateHelpers.js
// Timezone-safe date helpers shared by Holiday + Attendance modules.
// Keeping these in one place avoids the "date boundary" class of bugs
// (00:00:00 vs 23:59:59 truncation) that shows up whenever each router
// rolls its own date-range logic.

/**
 * Parse a "YYYY-MM-DD" string into numeric parts without going through
 * the Date constructor (which applies local-timezone shifting and is a
 * common source of off-by-one-day bugs).
 */
export const parseDateString = (str) => {
  const [year, month, day] = str.split("-").map(Number);
  return { year, month, day };
};

/**
 * Returns the UTC start/end boundaries (00:00:00.000 -> 23:59:59.999)
 * for a given day. Accepts either a "YYYY-MM-DD" string or a Date/ISO input.
 */
export const getDayRange = (dateInput) => {
  let y, mo, d;

  if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    ({ year: y, month: mo, day: d } = parseDateString(dateInput));
    mo -= 1;
  } else {
    const dt = new Date(dateInput);
    if (Number.isNaN(dt.getTime())) {
      throw new Error(`Invalid date input: ${dateInput}`);
    }
    y = dt.getUTCFullYear();
    mo = dt.getUTCMonth();
    d = dt.getUTCDate();
  }

  return {
    start: new Date(Date.UTC(y, mo, d, 0, 0, 0, 0)),
    end: new Date(Date.UTC(y, mo, d, 23, 59, 59, 999)),
  };
};

/**
 * Normalizes any date input to a "YYYY-MM-DD" string using UTC fields,
 * so the same calendar day always produces the same key regardless of
 * what time-of-day the input carried.
 */
export const toDateOnlyString = (dateInput) => {
  const dt = new Date(dateInput);
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`Invalid date input: ${dateInput}`);
  }
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
};

/** Formats a whole number of minutes as "HH:MM:00". */
export const formatMinutesToTimeString = (minutes) => {
  const safeMinutes = Math.max(0, Math.floor(minutes || 0));
  const h = Math.floor(safeMinutes / 60);
  const m = safeMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
};

/** Classifies a shift by minutes worked into full / half / short. */
export const classifyAttendance = (totalMinutesWorked) => {
  if (totalMinutesWorked >= 7 * 60) return { type: "full", expectedMinutes: 8 * 60 };
  if (totalMinutesWorked >= 4 * 60) return { type: "half", expectedMinutes: 4 * 60 };
  return { type: "short", expectedMinutes: 8 * 60 };
};

export const toTitleCase = (str) => {
  if (!str) return "";
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
};
