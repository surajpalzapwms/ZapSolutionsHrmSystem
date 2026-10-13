// controllers/hrm/holidayController.js
import mongoose from "mongoose";
import Holiday from "../models/holiday.js";
import { asyncHandler, ApiError } from "../utils/asyncHandler.js";
import { toTitleCase } from "../utils/dateHelpers.js";
import { invalidateHolidayCheckCache } from "../services/leave.js";

// Swap this stub for your real activity logger if Zap Solutionz has one
// (e.g. import { logActivity } from "../activity/activityLog.js";).
// Kept as a no-op fallback so this module has zero hard dependency on a
// system that may not exist yet in the new app.
const logActivity = async (_req, _entry) => {};

const assertValidId = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid holiday ID");
  }
};

/** GET / — list all holidays (optionally filter by ?year=2026&enabled=true) */
export const getAllHolidays = asyncHandler(async (req, res) => {
  const { year, enabled } = req.query;
  const filter = {};
  if (year) filter.yearCode = String(year);
  if (enabled !== undefined) filter.enabled = enabled === "true";

  const holidays = await Holiday.find(filter).sort({ startDate: 1 }).lean();
  res.json({ success: true, count: holidays.length, holidays });
});

/** GET /:id — single holiday */
export const getHolidayById = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const holiday = await Holiday.findById(req.params.id).lean();
  if (!holiday) throw new ApiError(404, "Holiday not found");
  res.json({ success: true, holiday });
});

/** POST / — create a holiday */
export const createHoliday = asyncHandler(async (req, res) => {
  const { name, startDate, endDate, description, type, enabled = true } = req.body;
  const finalEndDate = endDate || startDate;

  const existing = await Holiday.findOne({
    name: name.trim(),
    startDate: new Date(startDate),
  });
  if (existing) {
    throw new ApiError(409, "Holiday with the same name and start date already exists");
  }

  let holiday;
  try {
    holiday = await Holiday.create({
      name: name.trim(),
      startDate: new Date(startDate),
      endDate: new Date(finalEndDate),
      type: type || "General",
      description: description?.trim() || "",
      enabled,
      createdBy: req.user?.id,
    });
  } catch (err) {
    // Catches the race-condition case the pre-check above can miss:
    // two concurrent requests both pass findOne, then the unique index
    // rejects the second insert.
    if (err.code === 11000) {
      throw new ApiError(409, "Holiday with the same name and start date already exists");
    }
    throw err;
  }

  invalidateHolidayCheckCache();

  await logActivity(req, {
    action: "CREATE",
    tableName: "holidays",
    recordId: holiday._id,
    description: `New holiday "${toTitleCase(holiday.name)}" created`,
  });

  res.status(201).json({ success: true, message: "Holiday created successfully", holiday });
});

/** PUT /:id — update a holiday */
export const updateHoliday = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const { name, startDate, endDate, description, type, enabled } = req.body;
  const finalEndDate = endDate || startDate;

  const previous = await Holiday.findById(req.params.id).lean();
  if (!previous) throw new ApiError(404, "Holiday not found");

  let updated;
  try {
    updated = await Holiday.findByIdAndUpdate(
      req.params.id,
      {
        name: name?.trim(),
        startDate: startDate ? new Date(startDate) : previous.startDate,
        endDate: finalEndDate ? new Date(finalEndDate) : previous.endDate,
        description: description !== undefined ? description.trim() : previous.description,
        type,
        enabled,
        updatedBy: req.user?.id,
      },
      { new: true, runValidators: true, context: "query" },
    );
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, "Holiday with the same name and start date already exists");
    }
    throw err;
  }

  invalidateHolidayCheckCache();

  await logActivity(req, {
    action: "UPDATE",
    tableName: "holidays",
    recordId: updated._id,
    description: `Holiday "${toTitleCase(updated.name)}" updated`,
  });

  res.json({ success: true, message: "Holiday updated successfully", holiday: updated });
});

/** PUT /:id/status — enable/disable a holiday */
export const toggleHolidayStatus = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const { enabled } = req.body;

  const holiday = await Holiday.findByIdAndUpdate(
    req.params.id,
    { enabled: !!enabled, updatedBy: req.user?.id },
    { new: true },
  );
  if (!holiday) throw new ApiError(404, "Holiday not found");

  invalidateHolidayCheckCache();

  await logActivity(req, {
    action: "UPDATE",
    tableName: "holidays",
    recordId: holiday._id,
    description: `Holiday "${toTitleCase(holiday.name)}" ${enabled ? "enabled" : "disabled"}`,
  });

  res.json({
    success: true,
    message: `Holiday ${enabled ? "enabled" : "disabled"} successfully`,
    holiday,
  });
});

/** DELETE /:id — remove a holiday */
export const deleteHoliday = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const holiday = await Holiday.findByIdAndDelete(req.params.id);
  if (!holiday) throw new ApiError(404, "Holiday not found");

  invalidateHolidayCheckCache();

  await logActivity(req, {
    action: "DELETE",
    tableName: "holidays",
    recordId: holiday._id,
    description: `Holiday "${toTitleCase(holiday.name)}" deleted`,
  });

  res.json({ success: true, message: "Holiday deleted successfully" });
});

/** POST /import — bulk import from parsed Excel/CSV rows */
export const importHolidays = asyncHandler(async (req, res) => {
  const holidaysData = req.body;
  if (!Array.isArray(holidaysData) || holidaysData.length === 0) {
    throw new ApiError(400, "No holiday data provided");
  }
  if (holidaysData.length > 1000) {
    throw new ApiError(400, "Cannot import more than 1000 holidays at once");
  }

  const results = { success: 0, failed: 0, errors: [], importedHolidays: [] };

  for (const [index, row] of holidaysData.entries()) {
    const rowNum = index + 1;
    try {
      const { name, startDate, endDate, description, type } = row;
      if (!name || !startDate) {
        results.failed++;
        results.errors.push(`Row ${rowNum}: name and startDate are required`);
        continue;
      }

      const start = new Date(startDate);
      const end = new Date(endDate || startDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        results.failed++;
        results.errors.push(`Row ${rowNum}: invalid date format`);
        continue;
      }
      if (end < start) {
        results.failed++;
        results.errors.push(`Row ${rowNum}: end date cannot be before start date`);
        continue;
      }

      const existing = await Holiday.findOne({ name: name.trim(), startDate: start });
      if (existing) {
        results.failed++;
        results.errors.push(`Row ${rowNum}: "${name.trim()}" already exists on this date`);
        continue;
      }

      const saved = await Holiday.create({
        name: name.trim(),
        startDate: start,
        endDate: end,
        description: description?.trim() || "",
        type: type || "General",
        enabled: true,
        createdBy: req.user?.id,
      });

      results.success++;
      results.importedHolidays.push(saved.toObject());
    } catch (err) {
      results.failed++;
      results.errors.push(`Row ${rowNum}: ${err.message}`);
    }
  }

  if (results.success > 0) {
    invalidateHolidayCheckCache();
    await logActivity(req, {
      action: "IMPORT",
      tableName: "holidays",
      description: `Imported ${results.success} holiday(s), ${results.failed} failed`,
    });
  }

  res.json({
    success: results.success > 0,
    message: `${results.success} imported, ${results.failed} failed`,
    ...results,
  });
});

/** GET /export — export all holidays as an .xlsx buffer */
export const exportHolidays = asyncHandler(async (req, res) => {
  const holidays = await Holiday.find({}).sort({ startDate: 1 }).lean();

  const data = holidays.map((h) => ({
    "Holiday Name": h.name,
    "Start Date": new Date(h.startDate).toISOString().split("T")[0],
    "End Date": new Date(h.endDate).toISOString().split("T")[0],
    Type: h.type || "General",
    Description: h.description || "",
    Status: h.enabled ? "Active" : "Inactive",
    Year: h.yearCode?.join(", ") || "",
  }));

  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Holidays");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  await logActivity(req, {
    action: "EXPORT",
    tableName: "holidays",
    description: `Exported ${holidays.length} holidays`,
  });

  res.setHeader("Content-Disposition", "attachment; filename=holidays.xlsx");
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.send(buf);
});
