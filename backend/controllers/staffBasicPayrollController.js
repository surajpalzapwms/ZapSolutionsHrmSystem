// controllers/staffBasicPayrollController.js
import mongoose from "mongoose";
import StaffBasicPayroll from "../models/StaffBasicPayroll.js";
import Staff from "../models/Staff.js";
import { asyncHandler, ApiError } from "../utils/asyncHandler.js";

const assertValidId = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid staff basic payroll ID");
  }
};

// Flattens a populated StaffBasicPayroll doc into the shape the frontend
// table/list expects (row.staffId, row.staffName, ... at the top level,
// instead of nested under row.employeeId).
const flatten = (record) => {
  const staff = record.employeeId;
  return {
    _id: record._id,
    employeeId: staff?._id ?? record.employeeId,
    staffId: staff?.staffId ?? "",
    staffName: staff?.staffName ?? record.employeeName ?? "",
    projectName: staff?.projectName ?? "",
    currentBasicSalary: record.currentBasicSalary,
    currentEffectiveFrom: record.currentEffectiveFrom,
    remarks: record.remarks || "",
    salaryHistory: record.salaryHistory || [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
};

/** GET /api/hrm/staff-basic-payrolls — list all basic payroll records (optional ?search=) */
export const getAllStaffBasicPayrolls = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const filter = {};

  if (search) {
    const staff = await Staff.find({
      $or: [
        { staffName: { $regex: search, $options: "i" } },
        { staffId: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ],
    }).select("_id");
    filter.employeeId = { $in: staff.map((s) => s._id) };
  }

  const records = await StaffBasicPayroll.find(filter)
    .populate("employeeId", "staffName email projectName staffId")
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    count: records.length,
    data: records.map(flatten),
  });
});

/** GET /api/hrm/staff-basic-payrolls/staff/available — staff who don't yet have a basic payroll record */
export const getAvailableStaff = asyncHandler(async (req, res) => {
  // This list changes any time a staff member is added/deactivated or a
  // payroll record is added elsewhere — never let the browser (or any
  // proxy in between) serve a stale cached copy of it.
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");

  const assigned = await StaffBasicPayroll.find({}).select("employeeId").lean();
  const assignedIds = assigned.map((a) => a.employeeId);

  const staff = await Staff.find({
    _id: { $nin: assignedIds },
    enabled: true,
  })
    .select("staffName email projectName staffId")
    .sort({ staffName: 1 })
    .lean();

  res.json({ success: true, count: staff.length, data: staff });
});

/** GET /api/hrm/staff-basic-payrolls/:id — single basic payroll record */
export const getStaffBasicPayrollById = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const record = await StaffBasicPayroll.findById(req.params.id)
    .populate("employeeId", "staffName email projectName staffId")
    .lean();
  if (!record) throw new ApiError(404, "Staff basic payroll record not found");
  res.json({ success: true, data: flatten(record) });
});

/** GET /api/hrm/staff-basic-payrolls/:id/history — salary revision history for a record, newest first */
export const getSalaryHistory = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const record = await StaffBasicPayroll.findById(req.params.id)
    .select("employeeId employeeName salaryHistory")
    .lean();
  if (!record) throw new ApiError(404, "Staff basic payroll record not found");

  const sorted = [...(record.salaryHistory || [])].sort(
    (a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom),
  );

  res.json({ success: true, count: sorted.length, data: sorted });
});

/** POST /api/hrm/staff-basic-payrolls — create a basic payroll record for a staff member */
export const createStaffBasicPayroll = asyncHandler(async (req, res) => {
  const { staffId, currentBasicSalary, currentEffectiveFrom, remarks } =
    req.body;

  if (!staffId || !mongoose.Types.ObjectId.isValid(staffId)) {
    throw new ApiError(400, "A valid staffId is required");
  }
  if (currentBasicSalary === undefined || Number(currentBasicSalary) < 0) {
    throw new ApiError(400, "A valid currentBasicSalary is required");
  }

  const staff = await Staff.findById(staffId);
  if (!staff) throw new ApiError(404, "Staff member not found");

  const existing = await StaffBasicPayroll.findOne({ employeeId: staffId });
  if (existing) {
    throw new ApiError(
      409,
      "A basic payroll record already exists for this staff member",
    );
  }

  const effectiveFrom = currentEffectiveFrom
    ? new Date(currentEffectiveFrom)
    : new Date();

  const record = await StaffBasicPayroll.create({
    employeeId: staffId,
    employeeName: staff.staffName,
    currentBasicSalary: Number(currentBasicSalary),
    currentEffectiveFrom: effectiveFrom,
    remarks: remarks || "",
    salaryHistory: [
      {
        basicSalary: Number(currentBasicSalary),
        effectiveFrom,
        remarks: remarks || "Initial basic salary",
      },
    ],
  });

  const populated = await StaffBasicPayroll.findById(record._id)
    .populate("employeeId", "staffName email projectName staffId")
    .lean();

  res.status(201).json({
    success: true,
    message: "Staff basic payroll record created successfully",
    data: flatten(populated),
  });
});

/** POST /api/hrm/staff-basic-payrolls/:id/salary — add a new salary revision to history */
export const addSalaryRevision = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const { basicSalary, effectiveFrom, remarks } = req.body;

  if (basicSalary === undefined || Number(basicSalary) < 0) {
    throw new ApiError(400, "A valid basicSalary is required");
  }
  if (!effectiveFrom || isNaN(new Date(effectiveFrom).getTime())) {
    throw new ApiError(400, "A valid effectiveFrom date is required");
  }

  const record = await StaffBasicPayroll.findById(req.params.id);
  if (!record) throw new ApiError(404, "Staff basic payroll record not found");

  const newEffectiveFrom = new Date(effectiveFrom);

  record.salaryHistory.push({
    basicSalary: Number(basicSalary),
    effectiveFrom: newEffectiveFrom,
    remarks: remarks || "",
  });

  // Keep the "current" fields pointing at whichever revision has the
  // latest effectiveFrom date (handles back-dated / future-dated entries).
  const latest = record.salaryHistory.reduce((a, b) =>
    new Date(b.effectiveFrom) >= new Date(a.effectiveFrom) ? b : a,
  );
  record.currentBasicSalary = latest.basicSalary;
  record.currentEffectiveFrom = latest.effectiveFrom;
  if (remarks !== undefined) record.remarks = remarks;

  await record.save();

  const populated = await StaffBasicPayroll.findById(record._id)
    .populate("employeeId", "staffName email projectName staffId")
    .lean();

  res.status(201).json({
    success: true,
    message: "Salary revision added successfully",
    data: flatten(populated),
  });
});

/** PUT /api/hrm/staff-basic-payrolls/:id — update a basic payroll record */
export const updateStaffBasicPayroll = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const { currentBasicSalary, currentEffectiveFrom, remarks } = req.body;

  if (currentBasicSalary !== undefined && Number(currentBasicSalary) < 0) {
    throw new ApiError(400, "currentBasicSalary must be a non-negative number");
  }

  const record = await StaffBasicPayroll.findById(req.params.id);
  if (!record) throw new ApiError(404, "Staff basic payroll record not found");

  const salaryChanged =
    currentBasicSalary !== undefined &&
    Number(currentBasicSalary) !== record.currentBasicSalary;

  if (currentBasicSalary !== undefined)
    record.currentBasicSalary = Number(currentBasicSalary);
  if (currentEffectiveFrom !== undefined)
    record.currentEffectiveFrom = new Date(currentEffectiveFrom);
  if (remarks !== undefined) record.remarks = remarks;

  // Log a history entry whenever the salary amount actually changes via a
  // plain edit, so salaryHistory never falls out of sync with "current*".
  if (salaryChanged) {
    record.salaryHistory.push({
      basicSalary: record.currentBasicSalary,
      effectiveFrom: record.currentEffectiveFrom,
      remarks: remarks || "Updated via edit",
    });
  }

  await record.save();

  const populated = await StaffBasicPayroll.findById(record._id)
    .populate("employeeId", "staffName email projectName staffId")
    .lean();

  res.json({
    success: true,
    message: "Staff basic payroll record updated successfully",
    data: flatten(populated),
  });
});

/** DELETE /api/hrm/staff-basic-payrolls/:id — remove a basic payroll record */
export const deleteStaffBasicPayroll = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const record = await StaffBasicPayroll.findById(req.params.id);
  if (!record) throw new ApiError(404, "Staff basic payroll record not found");

  await record.deleteOne();
  res.json({
    success: true,
    message: "Staff basic payroll record deleted successfully",
  });
});

/** DELETE /api/hrm/staff-basic-payrolls — bulk delete ({ ids: [...] } in body) */
export const deleteManyStaffBasicPayrolls = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, "ids must be a non-empty array");
  }
  const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));

  const result = await StaffBasicPayroll.deleteMany({ _id: { $in: validIds } });

  res.json({
    success: true,
    message: `${result.deletedCount} record(s) deleted successfully`,
    deletedCount: result.deletedCount,
  });
});

/** POST /api/hrm/staff-basic-payrolls/import — bulk import basic payroll rows */
export const importStaffBasicPayrolls = asyncHandler(async (req, res) => {
  const rows = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(400, "Request body must be a non-empty array");
  }

  const created = [];
  const skipped = [];

  for (const row of rows) {
    const staffCode = (row.staffId || "").toString().trim();
    const basicSalary = Number(row.currentBasicSalary);

    if (!staffCode || Number.isNaN(basicSalary) || basicSalary < 0) {
      skipped.push({
        row,
        reason: "Missing/invalid staffId or currentBasicSalary",
      });
      continue;
    }

    const staff = await Staff.findOne({ staffId: staffCode });
    if (!staff) {
      skipped.push({
        row,
        reason: `No staff found with staffId "${staffCode}"`,
      });
      continue;
    }

    const existing = await StaffBasicPayroll.findOne({ employeeId: staff._id });
    if (existing) {
      skipped.push({
        row,
        reason: `Payroll record already exists for "${staffCode}"`,
      });
      continue;
    }

    const effectiveFrom = row.currentEffectiveFrom
      ? new Date(row.currentEffectiveFrom)
      : new Date();
    const remarks = row.remarks || "";

    const record = await StaffBasicPayroll.create({
      employeeId: staff._id,
      employeeName: staff.staffName,
      currentBasicSalary: basicSalary,
      currentEffectiveFrom: effectiveFrom,
      remarks,
      salaryHistory: [
        {
          basicSalary,
          effectiveFrom,
          remarks: remarks || "Initial basic salary",
        },
      ],
    });
    created.push(record);
  }

  if (created.length === 0) {
    throw new ApiError(
      400,
      "No valid rows were imported. " + JSON.stringify(skipped.slice(0, 5)),
    );
  }

  res.status(201).json({
    success: true,
    message: `${created.length} record(s) imported successfully${
      skipped.length ? `, ${skipped.length} skipped` : ""
    }`,
    data: created,
    skipped,
  });
});
