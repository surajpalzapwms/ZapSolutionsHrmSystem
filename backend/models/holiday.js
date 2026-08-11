// models/Hrm/Holiday.js
import mongoose from "mongoose";

// "Emergency" covers ad-hoc, same-day closures an admin declares manually
// (heavy rain, flooding, strikes, etc.) as opposed to holidays planned
// ahead of time.
const HOLIDAY_TYPES = ["General", "Public", "Company", "Optional", "Emergency"];

const holidaySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Holiday name is required"],
      trim: true,
      maxlength: [120, "Holiday name is too long"],
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },
    // NOTE: Cambodia's original schema never declared this field, so the
    // `type` sent by its router was silently dropped by Mongoose's strict
    // mode on every save. Declared properly here.
    type: {
      type: String,
      enum: HOLIDAY_TYPES,
      default: "General",
    },
    yearCode: {
      type: [String], // every calendar year the holiday range spans
      required: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [500, "Description is too long"],
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
    },
  },
  { timestamps: true },
);

const getYearsRange = (startDate, endDate) => {
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  const years = [];
  for (let year = startYear; year <= endYear; year++) years.push(year.toString());
  return years;
};

holidaySchema.pre("validate", function (next) {
  if (this.startDate && this.endDate) {
    if (this.endDate < this.startDate) {
      return next(new Error("End date cannot be before start date"));
    }
    this.yearCode = getYearsRange(this.startDate, this.endDate);
  }
  next();
});

holidaySchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate() || {};
  if (update.startDate && update.endDate) {
    if (new Date(update.endDate) < new Date(update.startDate)) {
      return next(new Error("End date cannot be before start date"));
    }
    const years = getYearsRange(new Date(update.startDate), new Date(update.endDate));
    this.setUpdate({ ...update, yearCode: years });
  }
  next();
});

// Prevents the exact same holiday (name + start date) from being created
// twice at the database level - not just via an app-level findOne check,
// which is vulnerable to a race between two concurrent requests.
holidaySchema.index({ name: 1, startDate: 1 }, { unique: true });
holidaySchema.index({ startDate: 1 });
holidaySchema.index({ endDate: 1 });
holidaySchema.index({ yearCode: 1 });

holidaySchema.statics.findByYear = function (year) {
  return this.find({ yearCode: year.toString() });
};

holidaySchema.statics.findCurrentYear = function () {
  const currentYear = new Date().getFullYear().toString();
  return this.find({ yearCode: currentYear, enabled: true });
};

/** True if `date` falls within any enabled holiday range. */
holidaySchema.statics.isHoliday = async function (date) {
  const d = new Date(date);
  const dayStart = new Date(d);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(d);
  dayEnd.setUTCHours(23, 59, 59, 999);

  const holiday = await this.findOne({
    enabled: true,
    startDate: { $lte: dayEnd },
    endDate: { $gte: dayStart },
  });

  return holiday ? { isHoliday: true, holiday } : { isHoliday: false, holiday: null };
};

export const HOLIDAY_TYPE_VALUES = HOLIDAY_TYPES;
export default mongoose.model("Holiday", holidaySchema);
