// controllers/hrm/saturdayHolidayController.js
import SaturdayHolidayRule from "../models/saturdayHolidayRule.js";
import { asyncHandler, ApiError } from "../utils/asyncHandler.js";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const currentYear = () => new Date().getFullYear();

/** GET / — the 12-month rule table for a year (?year=2026, defaults to this year). */
export const getSaturdayRules = asyncHandler(async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : currentYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ApiError(400, "Invalid year");
  }

  const rules = await SaturdayHolidayRule.getFullYear(year);
  res.json({
    success: true,
    year,
    rules: rules.map((r) => ({ ...r, monthName: MONTH_NAMES[r.month - 1] })),
  });
});

/**
 * PUT / — bulk save the whole year's rules in one request.
 * Body: { year: 2026, rules: [{ month: 1, occurrences: [] }, { month: 2, occurrences: [2, 4] }, ...] }
 * Months omitted from the body are left untouched.
 */
export const saveSaturdayRules = asyncHandler(async (req, res) => {
  const { year, rules } = req.body;
  const numericYear = Number(year);

  if (!Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 2100) {
    throw new ApiError(400, "Invalid year");
  }
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new ApiError(400, "rules must be a non-empty array");
  }

  const ops = [];
  for (const entry of rules) {
    const month = Number(entry?.month);
    const occurrences = Array.isArray(entry?.occurrences) ? entry.occurrences.map(Number) : [];

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new ApiError(400, `Invalid month in rules: ${entry?.month}`);
    }
    if (occurrences.some((n) => !Number.isInteger(n) || n < 1 || n > 5)) {
      throw new ApiError(400, `Occurrences for month ${month} must be integers between 1 and 5`);
    }

    ops.push({
      updateOne: {
        filter: { year: numericYear, month },
        update: {
          $set: {
            occurrences: [...new Set(occurrences)].sort((a, b) => a - b),
            updatedBy: req.user?.id,
          },
        },
        upsert: true,
      },
    });
  }

  await SaturdayHolidayRule.bulkWrite(ops);

  const saved = await SaturdayHolidayRule.getFullYear(numericYear);
  res.json({
    success: true,
    message: "Saturday holiday rules saved successfully",
    year: numericYear,
    rules: saved.map((r) => ({ ...r, monthName: MONTH_NAMES[r.month - 1] })),
  });
});

/**
 * GET /dates — the actual calendar dates the saved rules resolve to for a
 * year, shaped like a Holiday record so the frontend can merge them
 * straight into the holiday calendar view without special-casing them.
 */
export const getComputedSaturdayHolidays = asyncHandler(async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : currentYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ApiError(400, "Invalid year");
  }

  const dates = await SaturdayHolidayRule.getComputedDatesForYear(year);
  const ordinal = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };

  const holidays = dates.map(({ date, month, occurrence }) => ({
    _id: `saturday-${year}-${month}-${occurrence}`,
    name: `${ordinal[occurrence]} Saturday Holiday`,
    startDate: date,
    endDate: date,
    type: "Saturday",
    description: "Recurring Saturday holiday set by admin",
    enabled: true,
    virtual: true, // flags this as computed, not a real Holiday document
  }));

  res.json({ success: true, year, count: holidays.length, holidays });
});
