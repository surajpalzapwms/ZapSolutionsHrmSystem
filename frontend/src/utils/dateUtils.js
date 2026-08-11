// src/utils/dateUtils.js
export const formatDateToReadable = (dateString) => {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString || "--";
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateString || "--";
  }
};

export const formatDateToDDMMMYYYY = (dateString) => {
  if (!dateString) return "";
  try {
    let date;
    if (dateString instanceof Date) date = dateString;
    else if (typeof dateString === "string") {
      const m = dateString.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      date = m ? new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])) : new Date(dateString);
    } else date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString || "--";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  } catch {
    return dateString || "--";
  }
};

export const getTodayDate = () => new Date().toISOString().split("T")[0];

export const getCurrentMonth = () => new Date().toISOString().slice(0, 7);

export const getPreviousMonth = () => {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  return now.toISOString().slice(0, 7);
};

export const isFutureDate = (dateString) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const input = new Date(dateString);
  input.setHours(0, 0, 0, 0);
  return input > today;
};

export const isPastDate = (dateString) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const input = new Date(dateString);
  input.setHours(0, 0, 0, 0);
  return input < today;
};

export const isSunday = (date) => {
  if (!date) return false;
  const d = new Date(date);
  return d.getDay() === 0;
};

export const isSaturday = (date) => {
  if (!date) return false;
  const d = new Date(date);
  return d.getDay() === 6;
};

/**
 * Finds the holiday (if any) that covers a given date.
 * `holidays` is the raw array returned by the holidays API, each with
 * enabled / startDate / endDate. Only "enabled" holidays block the date.
 * Dates are compared using the plain Y-M-D value (no timezone math),
 * matching how the date pickers hand us "YYYY-MM-DD" strings.
 */
export const findHolidayForDate = (dateString, holidays = []) => {
  if (!dateString || !Array.isArray(holidays) || holidays.length === 0) return null;

  const target = new Date(dateString);
  target.setHours(0, 0, 0, 0);

  return (
    holidays.find((h) => {
      if (h.enabled === false) return false;
      const start = new Date(h.startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(h.endDate || h.startDate);
      end.setHours(0, 0, 0, 0);
      return target >= start && target <= end;
    }) || null
  );
};

/**
 * Combines the Sunday check and the holiday-calendar check into a single
 * helper so forms can show one consistent "why can't I pick this date"
 * message. Returns null when the date is a normal working day.
 */
export const getBlockedDayReason = (dateString, holidays = []) => {
  if (!dateString) return null;
  if (isSunday(dateString)) return "Sunday";
  const holiday = findHolidayForDate(dateString, holidays);
  return holiday ? holiday.name : null;
};

export const getDaysInMonth = (year, month) => {
  const days = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  for (let i = 0; i < firstDay.getDay(); i++) days.push(null);
  for (let i = 1; i <= lastDay.getDate(); i++) days.push(new Date(year, month, i));
  return days;
};

export const getMonthName = (monthIndex) => {
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return months[monthIndex] || "";
};

export const getShortMonthName = (monthIndex) => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[monthIndex] || "";
};

export const parseExcelDate = (dateValue) => {
  if (!dateValue) return null;
  if (typeof dateValue === "string") {
    if (dateValue.includes(" ")) return dateValue.split(" ")[0];
    return dateValue;
  }
  if (typeof dateValue === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const jsDate = new Date(excelEpoch.getTime() + dateValue * millisecondsPerDay);
    const year = jsDate.getUTCFullYear();
    const month = String(jsDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(jsDate.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
};