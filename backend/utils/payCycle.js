// utils/payCycle.js
//
// Works out WHICH DATES a payroll period ("YYYY-MM") actually covers for a
// given staff member.
//
// RULES
//   Internship + Probation → salary runs on the JOINING-DATE cycle.
//     Joined 20 Mar 2026:
//       "2026-03" = 20 Mar – 19 Apr
//       "2026-04" = 20 Apr – 19 May
//       "2026-05" = 20 May – 19 Jun   ← last probation cycle (3 months)
//     Each cycle uses the salary in effect on/before the cycle's last day,
//     so a new salary set for a cycle applies to that cycle; otherwise the
//     previous salary carries on. Internship and probation share the same
//     cycle because probation starts the day after internship ends.
//
//   Confirmation month → a short "transition" period that joins the
//     anniversary cycle back to calendar months, paid pro-rata at the LAST
//     probation salary (carry forward):
//       "2026-06" = 20 Jun – 30 Jun  (11/30 of the last salary)
//
//   After confirmation → normal calendar months with the new salary:
//       "2026-07" = 1 Jul – 31 Jul
//
//   Staff who were never on Internship/Probation (no probation dates and
//   status Confirmation) stay on calendar months exactly as before.
//
// All dates are returned as UTC-midnight Date objects for the IST calendar
// day, which is what the payroll leave/attendance maths already uses.

const DAY_MS = 86400000;
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

// Any stored date (saved at UTC midnight OR IST midnight) -> UTC midnight
// of its IST calendar day. Returns null for missing/invalid values.
export const toIstDay = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const key = new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  return new Date(`${key}T00:00:00Z`);
};

// Last instant of an IST calendar day (the Date from toIstDay / a window).
// Use this as the "effective on or before" cutoff, so a salary saved at
// IST midnight for the NEXT day (e.g. 20 Apr = 19 Apr 18:30 UTC) is not
// pulled back into the cycle that ends on 19 Apr.
export const endOfIstDay = (day) =>
  new Date(day.getTime() + DAY_MS - IST_OFFSET_MS - 1);

const daysInMonth = (year, monthIndex) =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

// Month index counted from year 0 (so months compare/subtract easily).
const monthIndexOf = (d) => d.getUTCFullYear() * 12 + d.getUTCMonth();

// The anchor day (e.g. 20th) inside absolute month `idx`, clamped to the
// month length (a 31st anchor becomes 28/29 Feb, 30 Apr, ...).
const anchorDateIn = (idx, anchorDay) => {
  const year = Math.floor(idx / 12);
  const month = idx % 12;
  return new Date(
    Date.UTC(year, month, Math.min(anchorDay, daysInMonth(year, month))),
  );
};

const daysBetweenInclusive = (start, end) =>
  Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;

// First day of "confirmed" employment, i.e. when the joining-date cycle
// stops. Returns:
//   Date     — cycle stops on this day
//   Infinity — still on Internship/Probation with no end date yet
//   null     — never on a joining-date cycle (use calendar months)
export const getConfirmationStart = (staff) => {
  const probationEnd = toIstDay(staff?.probationEndDate);
  const confirmation = toIstDay(staff?.confirmationDate);
  const candidates = [];
  if (probationEnd) candidates.push(new Date(probationEnd.getTime() + DAY_MS));
  if (confirmation) candidates.push(confirmation);
  if (candidates.length > 0) {
    // Whichever comes first ends the probation pay cycle.
    return new Date(Math.min(...candidates.map((d) => d.getTime())));
  }
  if (staff?.status === "Internship" || staff?.status === "Probation") {
    return Infinity;
  }
  return null;
};

// period "YYYY-MM" -> {
//   kind:         "calendar" | "cycle" | "transition"
//   start, end:   Date (UTC midnight, inclusive) — the dates this period pays
//   divisorDays:  days the monthly salary is divided by (per-day rate)
//   salaryAsOf:   Date — use the salary in effect on/before this day
// }
export const getPayWindow = (staff, period) => {
  const [year, month] = String(period).split("-").map(Number);
  const monthIdx = year * 12 + (month - 1);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const monthDays = daysInMonth(year, month - 1);

  const calendar = {
    kind: "calendar",
    start: monthStart,
    end: monthEnd,
    divisorDays: monthDays,
    salaryAsOf: monthEnd,
  };

  const join = toIstDay(staff?.date);
  if (!join) return calendar;

  const confirmStart = getConfirmationStart(staff);
  if (confirmStart === null) return calendar;
  if (confirmStart !== Infinity && confirmStart <= join) return calendar;

  const joinIdx = monthIndexOf(join);
  if (monthIdx < joinIdx) return calendar; // before joining — nothing payable

  const confirmIdx =
    confirmStart === Infinity ? Infinity : monthIndexOf(confirmStart);
  if (monthIdx > confirmIdx) return calendar; // fully confirmed month

  const anchorDay = join.getUTCDate();
  const cycleStart = anchorDateIn(monthIdx, anchorDay);
  const dayBeforeConfirm =
    confirmStart === Infinity
      ? null
      : new Date(confirmStart.getTime() - DAY_MS);

  if (monthIdx === confirmIdx) {
    // Confirmation starts on the 1st → just a normal calendar month.
    if (confirmStart.getTime() === monthStart.getTime()) return calendar;
    // Transition period up to month end, paid at the last probation salary.
    const start = cycleStart < confirmStart ? cycleStart : confirmStart;
    return {
      kind: "transition",
      start,
      end: monthEnd,
      divisorDays: monthDays,
      salaryAsOf: dayBeforeConfirm,
    };
  }

  // A joining-date cycle: anchor day this month → day before next anchor,
  // cut short if probation ends first.
  const nextCycleStart = anchorDateIn(monthIdx + 1, anchorDay);
  const fullEnd = new Date(nextCycleStart.getTime() - DAY_MS);
  const end =
    dayBeforeConfirm && dayBeforeConfirm < fullEnd ? dayBeforeConfirm : fullEnd;
  return {
    kind: "cycle",
    start: cycleStart,
    end,
    divisorDays: daysBetweenInclusive(cycleStart, fullEnd),
    salaryAsOf: end,
  };
};

// "20 Mar 2026 – 19 Apr 2026"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const formatDay = (d) =>
  `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const formatPayWindow = (window) =>
  `${formatDay(window.start)} – ${formatDay(window.end)}`;
