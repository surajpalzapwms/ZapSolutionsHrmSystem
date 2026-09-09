import mongoose from "mongoose";
import Leave from "../models/Leave.js";
import LeavePolicy from "../models/LeavePolicy.js";

const yearRangeUTC = (year) => ({
  start: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
  end: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
});
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const countTaken = async (userId, leaveType, year) => {
  const { start, end } = yearRangeUTC(year);
  // Sums dayValue instead of counting documents, so a half-day leave
  // (dayValue: 0.5) only deducts half a day from the staff member's
  // Paid/Sick/Casual balance instead of a full day. `$ifNull` covers
  // records saved before dayValue existed, which default to a full day.
  const result = await Leave.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        leaveType,
        status: "approved",
        leaveDate: { $gte: start, $lte: end },
      },
    },
    { $group: { _id: null, total: { $sum: { $ifNull: ["$dayValue", 1] } } } },
  ]);
  return result[0]?.total || 0;
};

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

const accruedAllowance = (perYear, months) => round2((perYear * months) / 12);

const joinYearOf = (joinDate, currentYear) => {
  if (!joinDate) return currentYear;
  const y = new Date(joinDate).getFullYear();
  return Number.isFinite(y) ? y : currentYear;
};

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
    const eligibleMonths = accruedMonths(joinDate, relievingDate, y, yearEnd);
    const accrued = accruedAllowance(paidPerYear, eligibleMonths);
    const availableThatYear = round2(accrued + carryIn); // this year's own accrual + whatever rolled in
    const taken = await countTaken(userId, "paid", y);
    carryIn = round2(Math.max(0, availableThatYear - taken)); // leftover rolls into the NEXT year in the chain
  }
  return carryIn; // this is what finally rolls into `currentYear`
};


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

  const [paidTaken, sickTakenYear, casualTakenYear, paidCarry] = await Promise.all([
    countTaken(userId, "paid", currentYear),
    countTaken(userId, "sick", currentYear),
    countTaken(userId, "casual", currentYear),
    computePaidCarryForward(
      userId,
      joinDate,
      relievingDate,
      currentYear,
      p.paidPerYear,
    ),
  ]);

  // Paid: accumulated allowance for every employed month so far this year,
  // plus whatever rolled in from prior years, minus everything taken so far.
  const paidAccrued = accruedAllowance(p.paidPerYear, currentYearMonths);
  const paidAllotted = round2(paidAccrued + paidCarry);
  const paidRemaining = round2(Math.max(0, paidAllotted - paidTaken));

  // Sick/Casual: accumulated allowance for every employed month so far
  // THIS YEAR (no cross-year carry-forward), minus everything taken this
  // year so far.
  const sickAccrued = accruedAllowance(p.sickPerYear, currentYearMonths);
  const sickRemaining = round2(Math.max(0, sickAccrued - sickTakenYear));

  const casualAccrued = accruedAllowance(p.casualPerYear, currentYearMonths);
  const casualRemaining = round2(Math.max(0, casualAccrued - casualTakenYear));

  return {
    year: currentYear,
    monthsAccrued: currentYearMonths,
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
      accruedThisYear: sickAccrued,
      allotted: sickAccrued,
      taken: sickTakenYear,
      takenThisYear: sickTakenYear,
      remaining: sickRemaining,
    },
    casual: {
      perYear: p.casualPerYear,
      accruedThisYear: casualAccrued,
      allotted: casualAccrued,
      taken: casualTakenYear,
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