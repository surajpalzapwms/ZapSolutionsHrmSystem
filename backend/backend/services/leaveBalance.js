import Leave from "../models/Leave.js";
import LeavePolicy from "../models/LeavePolicy.js";

// ═══════════════════════════════════════════════════════════════════════════
// Leave balance calculation (single source of truth)
//
//   paid   – accrues month-by-month through the year (see accruedMonths
//            below), ACCUMULATES across the whole year (each eligible
//            month's slice adds on top of the last), and unused days
//            CARRY FORWARD into following years too.
//   sick   – accrues 1/12th of the annual allowance EVERY MONTH, but is
//            use-it-or-lose-it monthly: whatever isn't taken that same
//            month is forfeited — it does not add up with earlier months
//            the way paid does, and obviously doesn't carry into next year.
//   casual – identical monthly use-it-or-lose-it rule as sick.
//
// "Taken" only ever counts APPROVED leave documents, one per calendar day.
//
// Why accrual instead of granting the full per-year number on 1 Jan:
//   A staff member who joins, resigns, or is simply partway through the year
//   should only have access to the *portion* of their annual allowance for
//   the months they've actually worked so far — e.g. by the end of June
//   (month 6 of 12) only half of the annual allowance has accrued, and a
//   staff member relieved in June never accrues past that month for that
//   year. This mirrors how paid leave is legally/contractually earned.
//
// Attendance-gated accrual: a month only counts toward the 1/12 slice above
// if the staff member had ZERO unauthorized-absence (unpaid leave) days in
// it. One unpaid day anywhere in a month zeroes that month's accrual for
// ALL THREE types (paid, sick, casual) — see getAbsentMonthKeys /
// eligibleAccrualMonths below. This only affects future accrual, never
// days already taken.
// ═══════════════════════════════════════════════════════════════════════════

const yearRangeUTC = (year) => ({
  start: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
  end: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
});

// Rounds to 2 decimal places — enough precision to keep e.g. 18/12 = 1.5 or
// 6/12 = 0.5 exact while cleaning up floating-point noise (0.1 + 0.2 style
// artifacts) from repeated division/subtraction.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const countTaken = async (userId, leaveType, year) => {
  const { start, end } = yearRangeUTC(year);
  return Leave.countDocuments({
    userId,
    leaveType,
    status: "approved",
    leaveDate: { $gte: start, $lte: end },
  });
};

// Same as countTaken but scoped to a single calendar month (0-11). Used for
// sick/casual, which reset every month rather than accumulating across the
// year — see the "monthly use-it-or-lose-it" note on computeLeaveBalances.
const countTakenInMonth = async (userId, leaveType, year, monthIndex) => {
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
  return Leave.countDocuments({
    userId,
    leaveType,
    status: "approved",
    leaveDate: { $gte: start, $lte: end },
  });
};

// Number of calendar months (1-12), inclusive, that the staff member was
// actively employed *within `year`*, counted only up to `asOf`. Both the
// join month and the "as of" / relieving month count as full months.
//
//   - A staff member who joined in March of `year` and is still active:
//       accrual starts at month 3.
//   - A staff member relieved in June of `year`: accrual stops at month 6
//     for that year and every later year, no matter when `asOf` is.
//   - For a fully-completed past year, pass asOf = 31 Dec of that year (or
//     later) so the full (clipped) year is counted.
const accruedMonths = (joinDate, relievingDate, year, asOf) => {
  const yearStartMonth = 0; // January
  const yearEndMonth = 11; // December

  let startMonth = yearStartMonth;
  if (joinDate) {
    const j = new Date(joinDate);
    if (Number.isFinite(j.getTime())) {
      if (j.getUTCFullYear() > year) return 0; // hasn't joined yet in this year
      if (j.getUTCFullYear() === year) startMonth = j.getUTCMonth();
    }
  }

  // Cut-off is the earlier of "as of" date and relieving date.
  let cutoff = asOf;
  if (relievingDate) {
    const r = new Date(relievingDate);
    if (Number.isFinite(r.getTime()) && r < cutoff) cutoff = r;
  }

  if (cutoff.getUTCFullYear() < year) return 0; // not employed yet during this year
  const endMonth =
    cutoff.getUTCFullYear() > year ? yearEndMonth : cutoff.getUTCMonth();

  return Math.max(0, endMonth - startMonth + 1);
};

// Accrued (prorated) allowance for one leave type in one year, e.g.
// perYear=18, accruedMonths=6 (staff relieved in June) → 9 days.
//
// IMPORTANT: this must stay an exact fraction, NOT Math.round()'d. The whole
// point of month-wise accrual is that e.g. a 6-day annual sick allowance
// accrues 0.5 days per month — after 1 month a staff member should have
// exactly 0.5 days available (not enough to take a day off yet), and only
// after 2 months do they cross 1.0 and can actually take a sick day.
// Math.round(0.5) rounding UP to 1 after a single month was exactly the bug
// being fixed here: it silently gave staff a full day of leave — for every
// balance-tracked type — a full 1-2 months earlier than the policy allows,
// and staff with a short employment window (mid-year joiners/leavers) could
// end up with more leave than their prorated share ever intended.
const accruedAllowance = (perYear, months) => round2((perYear * months) / 12);

const joinYearOf = (joinDate, currentYear) => {
  if (!joinDate) return currentYear;
  const y = new Date(joinDate).getFullYear();
  return Number.isFinite(y) ? y : currentYear;
};

// Calendar months (within `year`) that contain at least one approved
// UNPAID leave, i.e. a real, unauthorized absence — not any of the
// balance-tracked types, and not a Sunday/holiday (those were never
// working days to begin with). Keyed "year-monthIndex" so callers can
// check membership without re-deriving it per month.
const getAbsentMonthKeys = async (userId, start, end) => {
  const docs = await Leave.find({
    userId,
    leaveType: "unpaid",
    status: "approved",
    leaveDate: { $gte: start, $lte: end },
  })
    .select("leaveDate")
    .lean();
  const keys = new Set();
  for (const d of docs) {
    const dt = new Date(d.leaveDate);
    keys.add(`${dt.getUTCFullYear()}-${dt.getUTCMonth()}`);
  }
  return keys;
};

// Same employed-month window as accruedMonths, but any month containing an
// unauthorized absence (see getAbsentMonthKeys) contributes ZERO instead of
// its usual 1/12 slice — and it zeroes out for EVERY leave type that
// month, not just whichever balance the absence happened to affect. A
// staff member who didn't show up (and never applied for leave) for even
// one day of a month shouldn't keep accruing paid, sick AND casual leave
// as if the month were fully worked.
const eligibleAccrualMonths = (joinDate, relievingDate, year, asOf, absentMonthKeys) => {
  let startMonth = 0;
  if (joinDate) {
    const j = new Date(joinDate);
    if (Number.isFinite(j.getTime())) {
      if (j.getUTCFullYear() > year) return 0;
      if (j.getUTCFullYear() === year) startMonth = j.getUTCMonth();
    }
  }

  let cutoff = asOf;
  if (relievingDate) {
    const r = new Date(relievingDate);
    if (Number.isFinite(r.getTime()) && r < cutoff) cutoff = r;
  }
  if (cutoff.getUTCFullYear() < year) return 0;
  const endMonth = cutoff.getUTCFullYear() > year ? 11 : cutoff.getUTCMonth();

  let count = 0;
  for (let m = startMonth; m <= endMonth; m++) {
    if (!absentMonthKeys.has(`${year}-${m}`)) count++;
  }
  return count;
};

// Whether the single calendar month containing `asOf` counts toward
// accrual: staff must be employed that month (joined on/before it, not yet
// relieved before it) AND the month must not already be flagged as an
// unauthorized-absence month (see getAbsentMonthKeys). Mirrors
// eligibleAccrualMonths but for exactly one month instead of a running
// total, since sick/casual balances below are evaluated per-month, not
// accumulated across the year.
const isCurrentMonthEligible = (joinDate, relievingDate, asOf, absentMonthKeys) => {
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth();

  if (joinDate) {
    const j = new Date(joinDate);
    if (Number.isFinite(j.getTime())) {
      if (j.getUTCFullYear() > year) return false;
      if (j.getUTCFullYear() === year && j.getUTCMonth() > month) return false;
    }
  }
  if (relievingDate) {
    const r = new Date(relievingDate);
    if (Number.isFinite(r.getTime())) {
      if (r.getUTCFullYear() < year) return false;
      if (r.getUTCFullYear() === year && r.getUTCMonth() < month) return false;
    }
  }
  return !absentMonthKeys.has(`${year}-${month}`);
};

// Carry-forward for PAID leave only: a proper year-over-year CHAIN, not an
// independent per-year sum. Sick and casual never carry.
//
// Why this has to be a chain and not `sum(accrued_y - taken_y)` for each
// year on its own: a staff member's balance in any given year is their own
// accrual for that year PLUS whatever rolled in from the year before — and
// they're allowed to draw on that rolled-in amount (approval already checks
// total remaining, carry included). So if in 2025 they had 13 days carried
// in from 2024 and took 25 days against an 18-day 2025 accrual, they spent
// 18 of their own 2025 days plus 7 of the 2024 carry-in, leaving 6 (not 18,
// and not 0) to roll into 2026. Summing each year in isolation either drops
// that 7-day draw-down entirely (clamping to 0 the moment a single year's
// own taken > that year's own accrual) or loses track of how much of the
// carry survived — so a chain spanning 2024 → 2025 → 2026 → ... has to
// track one running `carryIn` balance and feed each year's leftover into
// the next, exactly like the real-world balance does.
//
// IMPORTANT: the chain starts at the staff member's own join year — it does
// NOT stop at the leave policy document's createdAt. Gating on policy
// creation date used to silently drop an employee's entire earlier-year
// accrual any time the LeavePolicy record itself happened to be created
// (or re-saved) after they joined — e.g. a staff member who joined July
// 2025 showing only their 2026 accrual because the admin didn't set up
// the policy until 2026, even though they'd genuinely been accruing leave
// since July 2025. The policy's *numbers* (paidPerYear etc.) apply
// retroactively to however far back the staff member's own tenure goes —
// there's no separate "the app wasn't tracking leave yet" cutoff to honor.
const computePaidCarryForward = async (
  userId,
  joinDate,
  relievingDate,
  currentYear,
  paidPerYear,
) => {
  const firstYear = joinYearOf(joinDate, currentYear);
  let carryIn = 0; // nothing rolls in before the staff member's own join year
  for (let y = firstYear; y < currentYear; y++) {
    const yearEnd = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
    const months = accruedMonths(joinDate, relievingDate, y, yearEnd);
    if (months <= 0) {
      // Not employed at all during year `y` (e.g. joins straddling a
      // year boundary) — nothing accrued and nothing to carry out of it
      // either, so the chain resets rather than silently keeping a stale
      // carryIn alive across a gap year.
      carryIn = 0;
      continue;
    }
    const { start: yStart, end: yEnd } = yearRangeUTC(y);
    const absentMonthKeys = await getAbsentMonthKeys(userId, yStart, yEnd);
    const eligibleMonths = eligibleAccrualMonths(joinDate, relievingDate, y, yearEnd, absentMonthKeys);
    const accrued = accruedAllowance(paidPerYear, eligibleMonths);
    const availableThatYear = round2(accrued + carryIn); // this year's own accrual + whatever rolled in
    const taken = await countTaken(userId, "paid", y);
    carryIn = round2(Math.max(0, availableThatYear - taken)); // leftover rolls into the NEXT year in the chain
  }
  return carryIn; // this is what finally rolls into `currentYear`
};

// Full balance breakdown for one staff member. `userId` must be the id used on
// Leave documents (Staff._id in this codebase). Pass a resolved policy to avoid
// re-reading it per staff in list endpoints. `relievingDate` should be passed
// whenever the staff member's status is "Relieving" so accrual stops on time.
//
// PAID vs SICK/CASUAL follow different reset rules:
//   - Paid accrues 1/12th of the annual allowance every eligible month and
//     ACCUMULATES across the whole year (and years, via carry-forward) —
//     "remaining" = everything accrued to date, minus everything taken to
//     date. A staff member 9 months into the year with an 18/year policy
//     and 10 days taken has (18 * 9/12) - 10 = 3.5 remaining, not "0.5 left"
//     from just the current month's slice.
//   - Sick/Casual are use-it-or-lose-it EVERY MONTH: each eligible month
//     grants exactly 1/12th of the annual allowance (e.g. 0.5 of a 6/year
//     policy) and whatever isn't taken THAT SAME MONTH is forfeited — it
//     does not roll into next month, and does not accumulate across the
//     year the way paid leave does. So "remaining" for sick/casual is only
//     ever this month's own slice minus what was taken this month.
export const computeLeaveBalances = async (
  userId,
  joinDate,
  policy,
  asOf = new Date(),
  relievingDate = null,
) => {
  const p = policy || (await LeavePolicy.getSingleton());
  const currentYear = asOf.getFullYear();

  const currentYearMonths = accruedMonths(joinDate, relievingDate, currentYear, asOf);
  const { start: currentYearStart, end: currentYearEnd } = yearRangeUTC(currentYear);
  const absentMonthKeys = await getAbsentMonthKeys(userId, currentYearStart, currentYearEnd);
  const currentYearEligibleMonths = eligibleAccrualMonths(
    joinDate,
    relievingDate,
    currentYear,
    asOf,
    absentMonthKeys,
  );
  const currentMonthEligible = isCurrentMonthEligible(
    joinDate,
    relievingDate,
    asOf,
    absentMonthKeys,
  );
  const currentMonthIndex = asOf.getUTCMonth();

  const [
    paidTaken,
    sickTakenYear,
    casualTakenYear,
    sickTakenMonth,
    casualTakenMonth,
    paidCarry,
  ] = await Promise.all([
    countTaken(userId, "paid", currentYear),
    countTaken(userId, "sick", currentYear),
    countTaken(userId, "casual", currentYear),
    countTakenInMonth(userId, "sick", currentYear, currentMonthIndex),
    countTakenInMonth(userId, "casual", currentYear, currentMonthIndex),
    computePaidCarryForward(
      userId,
      joinDate,
      relievingDate,
      currentYear,
      p.paidPerYear,
    ),
  ]);

  // Paid: accumulated allowance for every eligible month so far this year,
  // plus whatever rolled in from prior years, minus everything taken so far.
  const paidAccrued = accruedAllowance(p.paidPerYear, currentYearEligibleMonths);
  const paidAllotted = round2(paidAccrued + paidCarry);
  const paidRemaining = round2(Math.max(0, paidAllotted - paidTaken));

  // Sick/Casual: only THIS month's slice, reset every month — never
  // accumulated across earlier months of the year.
  const sickMonthlyAllowance = accruedAllowance(p.sickPerYear, 1);
  const sickAllotted = currentMonthEligible ? sickMonthlyAllowance : 0;
  const sickRemaining = round2(Math.max(0, sickAllotted - sickTakenMonth));

  const casualMonthlyAllowance = accruedAllowance(p.casualPerYear, 1);
  const casualAllotted = currentMonthEligible ? casualMonthlyAllowance : 0;
  const casualRemaining = round2(Math.max(0, casualAllotted - casualTakenMonth));

  return {
    year: currentYear,
    monthsAccrued: currentYearMonths,
    eligibleMonthsAccrued: currentYearEligibleMonths,
    paid: {
      perYear: p.paidPerYear,
      accruedThisYear: paidAccrued,
      carriedForward: paidCarry,
      allotted: paidAllotted,
      taken: paidTaken,
      remaining: paidRemaining,
    },
    sick: {
      perYear: p.sickPerYear,
      // "taken"/"allotted"/"remaining" here are all THIS-MONTH figures
      // (the balance actually available right now); takenThisYear is kept
      // separately for year-to-date totals/reporting.
      allotted: sickAllotted,
      taken: sickTakenMonth,
      takenThisYear: sickTakenYear,
      remaining: sickRemaining,
    },
    casual: {
      perYear: p.casualPerYear,
      allotted: casualAllotted,
      taken: casualTakenMonth,
      takenThisYear: casualTakenYear,
      remaining: casualRemaining,
    },
  };
};

// Remaining days available for a specific balance-tracked type. Used by the
// apply/approve flows to block over-drawing a balance.
export const getRemainingForType = async (
  userId,
  joinDate,
  leaveType,
  asOf = new Date(),
  relievingDate = null,
) => {
  const balances = await computeLeaveBalances(userId, joinDate, null, asOf, relievingDate);
  if (leaveType === "paid") return balances.paid.remaining;
  if (leaveType === "sick") return balances.sick.remaining;
  if (leaveType === "casual") return balances.casual.remaining;
  return Infinity;
};

// Backwards-compatible helper: paid-only remaining, now accrual + carry-forward aware.
export const getAvailablePaidLeavesWithCarry = async (
  userId,
  joinDate,
  asOf = new Date(),
  relievingDate = null,
) => {
  const balances = await computeLeaveBalances(userId, joinDate, null, asOf, relievingDate);
  return balances.paid.remaining;
};