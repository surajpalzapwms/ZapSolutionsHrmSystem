// controllers/staffController.js
import mongoose from "mongoose";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import { asyncHandler, ApiError } from "../utils/asyncHandler.js";

// Truthy-string-or-boolean helper — checkboxes serialize as real booleans
// from JSON but as "true"/"on" strings from some form submissions.
const isTruthy = (v) => v === true || v === "true" || v === "on";

const assertValidId = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid staff ID");
  }
};

// User requires firstName + lastName separately; Staff only has one
// combined name field. Prefer explicit firstName/lastName sent by the
// staff form; fall back to splitting the combined name for callers that
// don't send them (e.g. CSV import) — "Ravi Kumar" -> ("Ravi", "Kumar").
// Single-word names (e.g. "Ravi") use the same word for both, since
// User's schema requires lastName to be non-empty.
const splitStaffName = (fullName) => {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0];
  // Single-word names (e.g. "Mihir") leave lastName blank rather than
  // repeating the first name — User.lastName is optional, so this no
  // longer forces a "Mihir Mihir" style duplicate in the combined `name`.
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return { firstName, lastName };
};

// Resolve the (firstName, lastName) to use for the linked User account:
// explicit fields win when supplied, otherwise derive from staffName.
const resolveNameParts = (staffName, firstName, lastName) => {
  if (firstName && firstName.trim()) {
    return { firstName: firstName.trim(), lastName: (lastName || "").trim() };
  }
  return splitStaffName(staffName);
};

// Staff.create()/doc.save() return the in-memory document, which includes
// the hashed password even though the schema marks it select:false (that
// only applies to queries). Strip it before it ever reaches a response.
const sanitize = (doc) => {
  const obj = doc.toObject ? doc.toObject() : doc;
  delete obj.password;
  return obj;
};

// MongoDB's duplicate-key error only gives us the field name, e.g.
// { staffId: "ZAP0001" } or { email: "ravi@zapwms.com" } — turn that into
// a message that names the actual field and value that collided, instead
// of always assuming it was the Staff ID.
const duplicateKeyMessage = (err) => {
  const field = Object.keys(err.keyValue || {})[0];
  const value = field ? err.keyValue[field] : undefined;
  const label =
    field === "staffId"
      ? "Staff ID"
      : field === "email"
        ? "email"
        : field || "value";
  return value
    ? `A staff member with ${label} "${value}" already exists`
    : `A staff member with this ${label} already exists`;
};

// Helper function to add months to a date
const addMonths = (dateStr, months) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + months);
  return d;
};

// Helper function to add days to a date
const addDays = (dateStr, days) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d;
};

// Calculate probation end date (joining date + months - 1 day)
const calculateProbationEndDate = (joiningDate, months) => {
  if (!joiningDate || !months) return null;
  const dateAfterMonths = addMonths(joiningDate, months);
  if (!dateAfterMonths) return null;
  return addDays(dateAfterMonths, -1);
};

// Calculate confirmation date (joining date + months)
const calculateConfirmationDate = (joiningDate, months) => {
  if (!joiningDate || !months) return null;
  return addMonths(joiningDate, months);
};

// Status and Employment Type are mutually exclusive in the UI — only one
// card is active at a time — but a stray payload (an old client, a direct
// API call, a partial update) could still send date fields that don't
// belong to the active status/employmentType. This nulls out whichever
// fields don't apply to `data.status` / `data.employmentType`, so the
// record on disk never disagrees with what's actually selected.
//   - `explicitFields`: a set of field names the caller explicitly sent in
//     THIS request — those are respected and never overridden. Only used
//     by updateStaff, where an untouched field shouldn't be wiped just
//     because a different field changed. createStaff/importStaff build a
//     brand-new document each time, so they pass no exceptions.
const applyStatusEmploymentExclusivity = (data, explicitFields = new Set()) => {
  if (data.status !== "Probation" && !explicitFields.has("probationEndDate")) {
    data.probationEndDate = null;
  }
  if (
    data.status !== "Confirmation" &&
    !explicitFields.has("confirmationDate")
  ) {
    data.confirmationDate = null;
  }
  if (data.status !== "Relieving" && !explicitFields.has("relievingDate")) {
    data.relievingDate = null;
  }
  if (!data.employmentType) {
    if (!explicitFields.has("projectStartDate")) data.projectStartDate = null;
    if (!explicitFields.has("projectEndDate")) data.projectEndDate = null;
  }
  return data;
};

/**
 * GET /api/staff/me — the logged-in account's own Staff profile.
 * Staff and User are only linked by email (no stored userId), same
 * pattern used everywhere else in this codebase (see services/leave.js).
 */
export const getMyStaffProfile = asyncHandler(async (req, res) => {
  const email = req.user?.email?.toLowerCase().trim();
  const staff = email
    ? await Staff.findOne({ email }).select("-password")
    : null;

  if (!staff) {
    return res.status(404).json({
      success: false,
      message:
        "No staff profile is linked to your account yet. Contact your admin.",
    });
  }

  res.status(200).json({ success: true, data: staff });
});

/** GET /api/staff — list all staff members */
export const getAllStaff = asyncHandler(async (req, res) => {
  const { team, enabled, search } = req.query;
  const filter = {};

  if (team) filter.projectName = team;
  if (enabled !== undefined) filter.enabled = enabled === "true";
  if (search) {
    filter.$or = [
      { staffName: { $regex: search, $options: "i" } },
      { staffId: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { contactNo: { $regex: search, $options: "i" } },
    ];
  }

  const staff = await Staff.find(filter).sort({ createdAt: -1 }).lean();
  res.json({ success: true, count: staff.length, data: staff });
});

/** GET /api/staff/teams — distinct list of team names */
export const getTeams = asyncHandler(async (req, res) => {
  const teams = await Staff.distinct("projectName", {
    projectName: { $nin: [null, ""] },
  });
  res.json({ success: true, data: teams.sort() });
});

/** GET /api/staff/:id — single staff member */
export const getStaffById = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const staff = await Staff.findById(req.params.id).lean();
  if (!staff) throw new ApiError(404, "Staff member not found");
  res.json({ success: true, data: staff });
});

// Auto-increments off the highest existing numeric suffix (e.g. 5 staff → next is ZAP0006),
// rather than trusting createdAt order, so it stays correct even if an ID was ever
// entered manually or out of sequence.
// Auto-increments off the highest existing numeric suffix
export const generateStaffId = async () => {
  const docs = await Staff.find(
    { staffId: { $regex: /^ZS\d+$/ } },  // Changed from ZAP to ZS
    { staffId: 1 },
  ).lean();
  const maxNum = docs.reduce((max, d) => {
    const n = parseInt(d.staffId.replace("ZS", ""), 10) || 0;  // Changed from ZAP to ZS
    return n > max ? n : max;
  }, 0);
  // Start from 10 instead of 1
  const nextNumber = Math.max(maxNum + 1, 10);
  return `ZS${String(nextNumber).padStart(3, "0")}`;  // Changed to 3 digits (010, 011, etc.)
};

/** POST /api/staff — create a staff member */
export const createStaff = asyncHandler(async (req, res) => {
  console.log("values of req.body", req.body);
  let {
    firstName,
    lastName,
    staffName, // Added support for staffName from frontend
    staffId,
    projectName,
    contactNo,
    email,
    password,
    date, // Joining Date
    status = "Probation",
    probationMonths = 3,
    probationEndDate,
    confirmationMonths = 3,
    confirmationDate,
    relievingDate,
    employmentType = "",
    projectStartDate,
    projectEndDate,
    enabled = true,
    // "Make Admin" checkbox on the Add Staff form — only ever has an
    // effect when the caller is the super admin (checked below) and the
    // staff member is also being given login access (email + password).
    makeAdmin,
  } = req.body;

  // Handle both scenarios: either firstName+lastName OR staffName
  // If firstName is not provided but staffName is, use staffName
  if (!firstName || !firstName.trim()) {
    if (staffName && staffName.trim()) {
      // Derive firstName and lastName from staffName
      const nameParts = splitStaffName(staffName);
      firstName = nameParts.firstName;
      lastName = nameParts.lastName;
    } else {
      throw new ApiError(400, "Staff name is required");
    }
  } else if (!lastName || !lastName.trim()) {
    // If only firstName is provided but no lastName, use single name
    lastName = "";
  }

  // Validate after potential derivation
  if (!firstName || !firstName.trim()) {
    throw new ApiError(400, "First name is required");
  }

  // Build staffName from firstName and lastName
  const finalStaffName = `${firstName.trim()} ${lastName.trim()}`.trim();

  // If staffId is empty string or not provided, generate one
  const finalStaffId = staffId?.trim() || (await generateStaffId());
  const trimmedEmail = email?.trim();

  // A linked login (User document, role "user") is only created when the
  // admin actually supplies credentials for this staff member — staff
  // added without email/password stay as records-only, same as before.
  const wantsLogin = Boolean(trimmedEmail && password);

  // Only the super admin is allowed to grant admin access while creating a
  // staff member — an ordinary admin creating staff always creates a plain
  // ("user") login, even if a stray makeAdmin flag is sent, so an admin can
  // never quietly promote someone (including themselves) to admin.
  const wantsAdmin =
    wantsLogin && isTruthy(makeAdmin) && req.user?.role === "super-admin";

  // Calculate dates based on status
  const joiningDate = date ? new Date(date) : new Date();

  // Calculate probation end date if status is Probation
  let finalProbationEndDate = probationEndDate;
  if (status === "Probation" && !finalProbationEndDate) {
    finalProbationEndDate = calculateProbationEndDate(
      joiningDate,
      probationMonths,
    );
  }

  // Calculate confirmation date if status is Confirmation
  let finalConfirmationDate = confirmationDate;
  if (status === "Confirmation" && !finalConfirmationDate) {
    finalConfirmationDate = calculateConfirmationDate(
      joiningDate,
      confirmationMonths,
    );
  }

  // Status and Employment Type are mutually exclusive in the UI — collapse
  // whichever set of date fields doesn't belong to the chosen status /
  // employmentType down to null before the document is ever written, so a
  // fresh record never carries dates from a status it isn't in.
  const staffData = applyStatusEmploymentExclusivity({
    staffName: finalStaffName,
    staffId: finalStaffId,
    projectName: projectName?.trim() || "",
    contactNo: contactNo?.trim() || "",
    date: joiningDate,
    status: status || "Probation",
    probationMonths: probationMonths || 3,
    probationEndDate: finalProbationEndDate || null,
    confirmationMonths: confirmationMonths || 3,
    confirmationDate: finalConfirmationDate || null,
    relievingDate: relievingDate ? new Date(relievingDate) : null,
    employmentType: employmentType || "",
    projectStartDate: projectStartDate ? new Date(projectStartDate) : null,
    projectEndDate: projectEndDate ? new Date(projectEndDate) : null,
    enabled,
  });

  let staff;
  try {
    staff = await Staff.create({
      ...staffData,
      // Omit rather than store "" — with a sparse unique index, multiple
      // blank strings would still collide as duplicates.
      ...(trimmedEmail ? { email: trimmedEmail } : {}),
      // Hashed automatically by the pre("save") hook on the model.
      ...(password ? { password } : {}),
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, duplicateKeyMessage(err));
    }
    throw err;
  }

  let linkedUser = null;
  if (wantsLogin) {
    try {
      linkedUser = await User.create({
        firstName: firstName.trim(),
        lastName: lastName.trim() || firstName.trim(), // Ensure lastName has a value
        // User requires a valid contact number; fall back to a placeholder
        // in the rare case the staff form didn't collect one.
        contactNumber: contactNo?.trim() || "0000000000",
        email: trimmedEmail,
        password, // hashed automatically by User's own pre("save") hook
        role: wantsAdmin ? "admin" : "user",
        // New admins start with zero tabs granted — the super admin picks
        // which tabs/sub-tabs to expose from the Permissions screen right
        // after creating them. "Show All" is opt-in, never a default.
        ...(wantsAdmin ? { permissions: { allTabs: false, tabs: [] } } : {}),
      });
    } catch (err) {
      // Don't leave an orphaned Staff record if the login account
      // couldn't be created — keep the two collections in sync.
      await Staff.findByIdAndDelete(staff._id);
      if (err.code === 11000) {
        throw new ApiError(
          409,
          `A user account with email "${trimmedEmail}" already exists`,
        );
      }
      throw new ApiError(
        400,
        `Could not create the linked login account: ${err.message}`,
      );
    }
  }

  res.status(201).json({
    success: true,
    message: wantsAdmin
      ? "Staff member created successfully with admin login access"
      : wantsLogin
        ? "Staff member created successfully with login access"
        : "Staff member created successfully",
    data: sanitize(staff),
    ...(linkedUser
      ? { userId: linkedUser._id, userRole: linkedUser.role }
      : {}),
  });
});

/** PUT /api/staff/:id — update a staff member */
export const updateStaff = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const {
    firstName,
    lastName,
    staffId,
    projectName,
    contactNo,
    email,
    password,
    date, // Joining Date
    status,
    probationMonths,
    probationEndDate,
    confirmationMonths,
    confirmationDate,
    relievingDate,
    employmentType,
    projectStartDate,
    projectEndDate,
    enabled,
    makeAdmin,
  } = req.body;

  const trimmedEmail = email !== undefined ? email.trim() : undefined;
  const trimmedPassword =
    password && password.trim() ? password.trim() : undefined;
  // Build the combined staffName from firstName/lastName whenever either is
  // sent by the (now split-field) staff form; leave staffName untouched
  // otherwise so partial updates (e.g. just toggling status) don't wipe it.
  const staffName =
    firstName !== undefined || lastName !== undefined
      ? `${(firstName || "").trim()} ${(lastName || "").trim()}`.trim()
      : undefined;

  // Grab the staff doc BEFORE updating it, so we still have the original
  // email on hand — that's the only thing that links this Staff record to
  // its User (login) record, since no userId is stored on Staff.
  const existingStaff = await Staff.findById(req.params.id).lean();
  if (!existingStaff) throw new ApiError(404, "Staff member not found");
  const originalEmail = existingStaff.email;

  // Prepare update object
  const updateData = {};

  if (staffName !== undefined) updateData.staffName = staffName;
  if (staffId !== undefined) updateData.staffId = staffId.trim();
  if (projectName !== undefined) updateData.projectName = projectName.trim();
  if (contactNo !== undefined) updateData.contactNo = contactNo.trim();
  if (trimmedEmail) updateData.email = trimmedEmail;
  if (trimmedPassword) updateData.password = trimmedPassword;
  if (date !== undefined) updateData.date = new Date(date);
  if (status !== undefined) updateData.status = status;
  if (probationMonths !== undefined)
    updateData.probationMonths = probationMonths;
  if (probationEndDate !== undefined) {
    updateData.probationEndDate = probationEndDate
      ? new Date(probationEndDate)
      : null;
  }
  if (confirmationMonths !== undefined)
    updateData.confirmationMonths = confirmationMonths;
  if (confirmationDate !== undefined) {
    updateData.confirmationDate = confirmationDate
      ? new Date(confirmationDate)
      : null;
  }
  if (relievingDate !== undefined) {
    updateData.relievingDate = relievingDate ? new Date(relievingDate) : null;
  }
  if (employmentType !== undefined) updateData.employmentType = employmentType;
  if (projectStartDate !== undefined) {
    updateData.projectStartDate = projectStartDate
      ? new Date(projectStartDate)
      : null;
  }
  if (projectEndDate !== undefined) {
    updateData.projectEndDate = projectEndDate
      ? new Date(projectEndDate)
      : null;
  }
  if (enabled !== undefined) updateData.enabled = enabled;

  // Auto-calculate dates if status changed and no explicit dates provided
  const newStatus = status || existingStaff.status;
  const joiningDate = date ? new Date(date) : existingStaff.date;
  const newProbationMonths =
    probationMonths !== undefined
      ? probationMonths
      : existingStaff.probationMonths;
  const newConfirmationMonths =
    confirmationMonths !== undefined
      ? confirmationMonths
      : existingStaff.confirmationMonths;

  // If status is Probation and probationEndDate not explicitly set, calculate it
  if (newStatus === "Probation" && probationEndDate === undefined) {
    updateData.probationEndDate = calculateProbationEndDate(
      joiningDate,
      newProbationMonths,
    );
  }

  // If status is Confirmation and confirmationDate not explicitly set, calculate it
  if (newStatus === "Confirmation" && confirmationDate === undefined) {
    updateData.confirmationDate = calculateConfirmationDate(
      joiningDate,
      newConfirmationMonths,
    );
  }

  // If status is Relieving and relievingDate not set, default to today
  if (
    newStatus === "Relieving" &&
    relievingDate === undefined &&
    !existingStaff.relievingDate
  ) {
    updateData.relievingDate = new Date();
  }

  // Status and Employment Type are mutually exclusive in the UI — only
  // enforce that here when this request is actually touching one of them.
  // Otherwise an unrelated update (e.g. just editing contactNo) would wipe
  // out dates that were never part of this request.
  if (status !== undefined || employmentType !== undefined) {
    const newEmploymentType =
      employmentType !== undefined ? employmentType : existingStaff.employmentType;
    applyStatusEmploymentExclusivity(
      { ...updateData, status: newStatus, employmentType: newEmploymentType },
      new Set([
        probationEndDate !== undefined ? "probationEndDate" : null,
        confirmationDate !== undefined ? "confirmationDate" : null,
        relievingDate !== undefined ? "relievingDate" : null,
        projectStartDate !== undefined ? "projectStartDate" : null,
        projectEndDate !== undefined ? "projectEndDate" : null,
      ].filter(Boolean)),
    );
    // applyStatusEmploymentExclusivity mutates the object passed to it —
    // pull the (possibly nulled) date fields back out into updateData.
    if (newStatus !== "Probation" && probationEndDate === undefined) {
      updateData.probationEndDate = null;
    }
    if (newStatus !== "Confirmation" && confirmationDate === undefined) {
      updateData.confirmationDate = null;
    }
    if (newStatus !== "Relieving" && relievingDate === undefined) {
      updateData.relievingDate = null;
    }
    if (!newEmploymentType) {
      if (projectStartDate === undefined) updateData.projectStartDate = null;
      if (projectEndDate === undefined) updateData.projectEndDate = null;
    }
  }

  let updated;
  try {
    updated = await Staff.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
      context: "query",
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, duplicateKeyMessage(err));
    }
    throw err;
  }

  if (!updated) throw new ApiError(404, "Staff member not found");

  // Keep the linked User (login) document in sync. Look it up by whatever
  // email the User was actually created under (the staff's email at the
  // time login access was granted) — that's `originalEmail` if it existed,
  // otherwise the newly-set email if login is being added for the first time.
  const lookupEmail = originalEmail || trimmedEmail;
  // Promoting an existing login to admin must be able to run on its own,
  // even when nothing else on the form changed — otherwise ticking only
  // "Make Admin" would be silently ignored.
  const wantsAdmin = isTruthy(makeAdmin) && req.user?.role === "super-admin";
  const wantsUserSync =
    Boolean(lookupEmail) &&
    (trimmedPassword ||
      (trimmedEmail && trimmedEmail !== originalEmail) ||
      staffName !== undefined ||
      wantsAdmin);
  if (wantsUserSync) {
    const linkedUser = await User.findOne({
      email: lookupEmail.toLowerCase().trim(),
    });

    if (linkedUser) {
      // Existing login account — update in place. Setting `.password` and
      // calling `.save()` (rather than findOneAndUpdate) is required so the
      // User model's pre("save") hook actually hashes the new password.
      if (trimmedPassword) linkedUser.password = trimmedPassword;
      if (trimmedEmail) linkedUser.email = trimmedEmail;
      if (staffName !== undefined) {
        const parts = resolveNameParts(staffName, firstName, lastName);
        linkedUser.firstName = parts.firstName;
        linkedUser.lastName = parts.lastName;
      }
      // Promote a plain staff login to admin when the super admin ticks
      // "Make Admin". Only ever an upgrade: unticking the box (its default
      // in the edit form) must NOT demote an existing admin — that's done
      // explicitly via "Revoke admin access" on the Permissions screen.
      // A super admin is left untouched.
      if (wantsAdmin && linkedUser.role === "user") {
        linkedUser.role = "admin";
        linkedUser.permissions = { allTabs: false, tabs: [] };
      }
      await linkedUser.save();
    } else if (trimmedPassword && trimmedEmail) {
      // No login account existed yet, but this update just supplied both an
      // email and a password — grant login access now, same as createStaff.
      // Same super-admin-only rule applies to the makeAdmin checkbox here.
      const parts = resolveNameParts(updated.staffName, firstName, lastName);
      try {
        await User.create({
          firstName: parts.firstName,
          lastName: parts.lastName,
          contactNumber: updated.contactNo?.trim() || "0000000000",
          email: trimmedEmail,
          password: trimmedPassword,
          role: wantsAdmin ? "admin" : "user",
          ...(wantsAdmin ? { permissions: { allTabs: false, tabs: [] } } : {}),
        });
      } catch (err) {
        if (err.code === 11000) {
          throw new ApiError(
            409,
            `A user account with email "${trimmedEmail}" already exists`,
          );
        }
        throw new ApiError(
          400,
          `Could not create the linked login account: ${err.message}`,
        );
      }
    }
  }

  res.json({
    success: true,
    message: "Staff member updated successfully",
    data: sanitize(updated),
  });
});

/** PUT /api/staff/status/:id — activate/deactivate a staff member */
export const toggleStaffStatus = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const { isActive } = req.body;

  const staff = await Staff.findByIdAndUpdate(
    req.params.id,
    { enabled: !!isActive },
    { new: true },
  );
  if (!staff) throw new ApiError(404, "Staff member not found");

  res.json({
    success: true,
    message: `Staff member ${isActive ? "activated" : "deactivated"}`,
    data: staff,
  });
});

/** DELETE /api/staff/:id — remove a staff member */
export const deleteStaff = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const staff = await Staff.findByIdAndDelete(req.params.id);
  if (!staff) throw new ApiError(404, "Staff member not found");

  // Staff and User are only linked by email (no stored userId) — delete the
  // matching login account too, otherwise a "deleted" staff member could
  // still log in indefinitely.
  if (staff.email) {
    await User.deleteOne({ email: staff.email.toLowerCase().trim() });
  }

  res.json({ success: true, message: "Staff member deleted successfully" });
});

/** DELETE /api/staff — bulk delete { ids: [...] } */
export const deleteManyStaff = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, "ids must be a non-empty array");
  }
  const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));

  // Grab emails before the Staff docs are gone, so the matching User
  // (login) accounts can be removed too.
  const staffToDelete = await Staff.find(
    { _id: { $in: validIds } },
    { email: 1 },
  ).lean();
  const emails = staffToDelete
    .map((s) => s.email)
    .filter(Boolean)
    .map((e) => e.toLowerCase().trim());

  const result = await Staff.deleteMany({ _id: { $in: validIds } });
  if (emails.length > 0) {
    await User.deleteMany({ email: { $in: emails } });
  }

  res.json({
    success: true,
    message: `${result.deletedCount} staff member(s) deleted successfully`,
    deletedCount: result.deletedCount,
  });
});

/** POST /api/staff/import — bulk import an array of staff records */
export const importStaff = asyncHandler(async (req, res) => {
  const rows = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(400, "Request body must be a non-empty array");
  }

  const docs = [];
  for (const row of rows) {
    if (!row.staffName || !row.staffName.trim()) continue;

    const joiningDate = row.date ? new Date(row.date) : new Date();
    const probationMonths = row.probationMonths || 3;
    const confirmationMonths = row.confirmationMonths || 3;
    const status = row.status || "Probation";

    let probationEndDate = row.probationEndDate
      ? new Date(row.probationEndDate)
      : null;
    let confirmationDate = row.confirmationDate
      ? new Date(row.confirmationDate)
      : null;

    // Auto-calculate if not provided
    if (status === "Probation" && !probationEndDate) {
      probationEndDate = calculateProbationEndDate(
        joiningDate,
        probationMonths,
      );
    }

    if (status === "Confirmation" && !confirmationDate) {
      confirmationDate = calculateConfirmationDate(
        joiningDate,
        confirmationMonths,
      );
    }

    // insertMany() below skips Mongoose's pre("save") hooks entirely, so
    // the model-level safety net never runs for imported rows — apply the
    // same status/employmentType exclusivity here explicitly.
    const doc = applyStatusEmploymentExclusivity({
      staffName: row.staffName.trim(),
      staffId: row.staffId?.trim() || (await generateStaffId()),
      projectName: row.projectName?.trim() || "",
      contactNo: row.contactNo?.trim() || "",
      ...(row.email?.trim() ? { email: row.email.trim() } : {}),
      date: joiningDate,
      status: status,
      probationMonths: probationMonths,
      probationEndDate: probationEndDate,
      confirmationMonths: confirmationMonths,
      confirmationDate: confirmationDate,
      relievingDate: row.relievingDate ? new Date(row.relievingDate) : null,
      employmentType: row.employmentType || "",
      projectStartDate: row.projectStartDate
        ? new Date(row.projectStartDate)
        : null,
      projectEndDate: row.projectEndDate ? new Date(row.projectEndDate) : null,
      enabled: row.enabled !== undefined ? row.enabled : true,
    });

    docs.push(doc);
  }

  if (docs.length === 0) {
    throw new ApiError(400, "No valid staff rows found in the import");
  }

  const inserted = await Staff.insertMany(docs, { ordered: false });
  res.status(201).json({
    success: true,
    message: `${inserted.length} staff member(s) imported successfully`,
    data: inserted.map((doc) => sanitize(doc)),
  });
});
