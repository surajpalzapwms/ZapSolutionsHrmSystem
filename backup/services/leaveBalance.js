import Leave from "../models/Leave.js";
import LeavePolicy from "../models/LeavePolicy.js";

// ═══════════════════════════════════════════════════════════════════════════
// Leave balance calculation (single source of truth)
//
//   paid   – UNUSED days CARRY FORWARD into following years.
//   sick   – resets every year, no carry-forward.
//   casual – resets every year, no carry-forward.
//
// "Taken" only ever counts APPROVED leave documents, one per calendar day.
// ═══════════════════════════════════════════════════════════════════════════

const yearRangeUTC = (year) => ({
  start: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
  end: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
});

const countTaken = async (userId, leaveType, year) => {
  const { start, end } = yearRangeUTC(year);
  return Leave.countDocuments({
    userId,
    leaveType,
    status: "approved",
    leaveDate: { $gte: start, $lte: end },
  });
};

const joinYearOf = (joinDate, currentYear) => {
  if (!joinDate) return currentYear;
  const y = new Date(joinDate).getFullYear();
  return Number.isFinite(y) ? y : currentYear;
};

// Carry-forward for PAID leave: sum of unused paid days across every COMPLETED
// year since the staff member joined (join year up to, but not including, the
// current year). Sick and casual never carry.
const computePaidCarryForward = async (userId, joinDate, currentYear, paidPerYear) => {
  const firstYear = joinYearOf(joinDate, currentYear);
  let carry = 0;
  for (let y = firstYear; y < currentYear; y++) {
    const taken = await countTaken(userId, "paid", y);
    carry += Math.max(0, paidPerYear - taken);
  }
  return carry;
};

// Full balance breakdown for one staff member. `userId` must be the id used on
// Leave documents (Staff._id in this codebase). Pass a resolved policy to avoid
// re-reading it per staff in list endpoints.
export const computeLeaveBalances = async (userId, joinDate, policy, asOf = new Date()) => {
  const p = policy || (await LeavePolicy.getSingleton());
  const currentYear = asOf.getFullYear();

  const [paidTaken, sickTaken, casualTaken, paidCarry] = await Promise.all([
    countTaken(userId, "paid", currentYear),
    countTaken(userId, "sick", currentYear),
    countTaken(userId, "casual", currentYear),
    computePaidCarryForward(userId, joinDate, currentYear, p.paidPerYear),
  ]);

  const paidAllotted = p.paidPerYear + paidCarry;
  const paidRemaining = Math.max(0, paidAllotted - paidTaken);

  const sickAllotted = p.sickPerYear;
  const sickRemaining = Math.max(0, sickAllotted - sickTaken);

  const casualAllotted = p.casualPerYear;
  const casualRemaining = Math.max(0, casualAllotted - casualTaken);

  return {
    year: currentYear,
    paid: {
      perYear: p.paidPerYear,
      carriedForward: paidCarry,
      allotted: paidAllotted,
      taken: paidTaken,
      remaining: paidRemaining,
    },
    sick: {
      perYear: p.sickPerYear,
      allotted: sickAllotted,
      taken: sickTaken,
      remaining: sickRemaining,
    },
    casual: {
      perYear: p.casualPerYear,
      allotted: casualAllotted,
      taken: casualTaken,
      remaining: casualRemaining,
    },
  };
};

// Remaining days available for a specific balance-tracked type. Used by the
// apply/approve flows to block over-drawing a balance.
export const getRemainingForType = async (userId, joinDate, leaveType, asOf = new Date()) => {
  const balances = await computeLeaveBalances(userId, joinDate, null, asOf);
  if (leaveType === "paid") return balances.paid.remaining;
  if (leaveType === "sick") return balances.sick.remaining;
  if (leaveType === "casual") return balances.casual.remaining;
  return Infinity;
};

// Backwards-compatible helper: paid-only remaining, now carry-forward aware.
export const getAvailablePaidLeavesWithCarry = async (userId, joinDate, asOf = new Date()) => {
  const balances = await computeLeaveBalances(userId, joinDate, null, asOf);
  return balances.paid.remaining;
};
