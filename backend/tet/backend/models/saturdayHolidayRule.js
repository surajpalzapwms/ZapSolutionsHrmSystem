// models/Hrm/SaturdayHolidayRule.js
//
// Lets an admin decide, per calendar month, WHICH Saturdays are treated
// as a holiday - e.g. "2nd & 4th Saturday" for one month and
// "3rd & 4th Saturday" for another, instead of hard-coding one rule for
// every month of the year.
//
// One document = one (year, month) pair. `occurrences` holds which
// Saturday-of-the-month numbers (1 = first Saturday ... 5 = fifth, for
// months that have one) are holidays. An empty array means "no recurring
// Saturday holiday that month" (all Saturdays are working days).
import mongoose from "mongoose";

const saturdayHolidayRuleSchema = new mongoose.Schema(
  {
    year: {
      type: Number,
      required: [true, "Year is required"],
      min: 2000,
      max: 2100,
    },
    month: {
      type: Number, // 1-12
      required: [true, "Month is required"],
      min: 1,
      max: 12,
    },
    occurrences: {
      // Which Saturdays of the month are holidays: 1st, 2nd, 3rd, 4th, 5th
      type: [Number],
      default: [],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.every((n) => Number.isInteger(n) && n >= 1 && n <= 5),
        message: "Occurrences must be integers between 1 and 5",
      },
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
    },
  },
  { timestamps: true },
);

// One rule per year+month - upserts overwrite rather than duplicate.
saturdayHolidayRuleSchema.index({ year: 1, month: 1 }, { unique: true });

// Dedupe + sort occurrences before every save so "2,4,2" always
// normalizes to "2,4".
saturdayHolidayRuleSchema.pre("validate", function (next) {
  if (Array.isArray(this.occurrences)) {
    this.occurrences = [...new Set(this.occurrences)].sort((a, b) => a - b);
  }
  next();
});

/** All Saturdays that fall in a given (year, month). month is 1-12. */
const getSaturdaysInMonth = (year, month) => {
  const saturdays = [];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCDay() === 6) saturdays.push(d);
  }
  return saturdays;
};

/** Which "nth Saturday of the month" a given date is (1-5), or null if it isn't a Saturday. */
saturdayHolidayRuleSchema.statics.getOccurrenceOfDate = function (date) {
  const d = new Date(date);
  if (d.getUTCDay() !== 6) return null;
  return Math.ceil(d.getUTCDate() / 7);
};

/** True if `date` is a Saturday covered by that month's recurring-holiday rule. */
saturdayHolidayRuleSchema.statics.isSaturdayHoliday = async function (date) {
  const d = new Date(date);
  const occurrence = this.getOccurrenceOfDate(d);
  if (!occurrence) return { isHoliday: false, occurrence: null };

  const rule = await this.findOne({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
  }).lean();

  const isHoliday = !!rule && rule.occurrences.includes(occurrence);
  return { isHoliday, occurrence };
};

/**
 * Returns every rule for a year, filling in any month with no saved rule
 * as `occurrences: []` so the UI always has all 12 rows to render.
 */
saturdayHolidayRuleSchema.statics.getFullYear = async function (year) {
  const saved = await this.find({ year: Number(year) }).lean();
  const byMonth = new Map(saved.map((r) => [r.month, r]));

  return Array.from({ length: 12 }, (_, idx) => {
    const month = idx + 1;
    const existing = byMonth.get(month);
    return {
      year: Number(year),
      month,
      occurrences: existing ? existing.occurrences : [],
    };
  });
};

/**
 * Expands every rule saved for a year into the actual calendar dates
 * those rules land on, e.g. { month: 3, occurrences: [2, 4] } -> the
 * real 2nd and 4th Saturday of March that year.
 */
saturdayHolidayRuleSchema.statics.getComputedDatesForYear = async function (year) {
  const rules = await this.find({ year: Number(year), "occurrences.0": { $exists: true } }).lean();
  const results = [];

  for (const rule of rules) {
    const saturdays = getSaturdaysInMonth(rule.year, rule.month);
    for (const occurrence of rule.occurrences) {
      const date = saturdays[occurrence - 1]; // occurrence is 1-based
      if (date) results.push({ date, month: rule.month, occurrence });
    }
  }

  return results.sort((a, b) => a.date - b.date);
};

export default mongoose.model("SaturdayHolidayRule", saturdayHolidayRuleSchema);
