// src/utils/holidayHelpers.js

// Local "YYYY-MM-DD" key for a Date / ISO string. Local (not UTC) on purpose:
// the holiday calendar draws days using local getters, so comparing with the
// same local day keeps what is filtered identical to what is on screen.
const localDayKey = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

/**
 * Drops holidays that were already over before the staff member joined.
 * e.g. someone who joined on 10 Jun 2025 should not see 1 Jan 2025.
 *
 * A holiday that is still running on the joining day (multi-day holiday that
 * ends on/after the joining date) is kept. If there is no valid joining date
 * (admins, or a profile without one) the list is returned unchanged.
 */
export const filterHolidaysFromJoiningDate = (holidays, joiningDate) => {
  const list = Array.isArray(holidays) ? holidays : [];
  const joinKey = localDayKey(joiningDate);
  if (!joinKey) return list;

  return list.filter((h) => {
    const endKey = localDayKey(h.endDate || h.startDate);
    // If a holiday has no usable date, don't hide it by accident.
    return !endKey || endKey >= joinKey;
  });
};
