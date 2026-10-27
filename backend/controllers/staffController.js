// controllers/staffController.js
import mongoose from "mongoose";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import { asyncHandler, ApiError } from "../utils/asyncHandler.js";
import { decryptPassword, encryptPassword } from "../utils/passwordVault.js";
import { computeFinalSettlement } from "../services/settlementService.js";
import BirthdayWish from "../models/BirthdayWish.js";
import StaffDocument from "../models/StaffDocument.js";
import { purgeStaff, previewStaffPurge } from "../services/staffPurge.js";
import { photoUrlFor, userPhotoUrlFor } from "../utils/fileSigning.js";
import { isAdminRole } from "../config/permissions.js";
import { getReferral, istPeriodOf } from "../utils/referral.js";
import { refreshPendingPayrollForPeriod } from "./payrollController.js";

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
  delete obj.passwordEncrypted;
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

// Staff lifecycle: Internship -> Probation -> Confirmation -> Relieved.
// Internship starts on the joining date; probation starts the day AFTER the
// internship ends. A staff member with no internshipEndDate never had an
// internship, so probation still starts on the joining date (old behaviour).

// Calculate internship end date (joining date + months - 1 day)
const calculateInternshipEndDate = (joiningDate, months) => {
  if (!joiningDate || !months) return null;
  const dateAfterMonths = addMonths(joiningDate, months);
  if (!dateAfterMonths) return null;
  return addDays(dateAfterMonths, -1);
};

// The date probation (and therefore confirmation) is counted from.
const getProbationStartDate = (joiningDate, internshipEndDate) =>
  internshipEndDate ? addDays(internshipEndDate, 1) : joiningDate || null;

// Calculate probation end date (probation start date + months - 1 day)
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

// Employment Type is a separate, independent choice from Status in the UI —
// its two date fields (projectStartDate/projectEndDate) only apply when an
// employmentType is actually selected. This nulls those two out whenever
// employmentType is empty, so a stray payload (an old client, a direct API
// call, a partial update) can't leave dates on disk for a type that isn't
// selected.
//
// probationEndDate / confirmationDate / relievingDate are deliberately left
// alone here — they're the staff member's lifecycle history (when
// probation ended, when confirmation started, when they left), and the
// "View" details panel needs all of them regardless of the current status.
// Nulling the earlier ones out on every status change (the old behaviour)
// meant that history was destroyed the moment probation turned into
// confirmation, which is exactly what made the details view incomplete.
//   - `explicitFields`: a set of field names the caller explicitly sent in
//     THIS request — those are respected and never overridden. Only used
//     by updateStaff, where an untouched field shouldn't be wiped just
//     because a different field changed. createStaff/importStaff build a
//     brand-new document each time, so they pass no exceptions.
const applyStatusEmploymentExclusivity = (data, explicitFields = new Set()) => {
  if (!data.employmentType) {
    if (!explicitFields.has("projectStartDate")) data.projectStartDate = null;
    if (!explicitFields.has("projectEndDate")) data.projectEndDate = null;
  }
  return data;
};

// Once a staff member's probation period has actually elapsed, their
// status should read "Confirmation" without an admin having to manually
// open the record and re-save it. This checks a single staff doc and
// returns the fields to update, or null if nothing is due yet.
const getAutoConfirmUpdate = (staff) => {
  if (staff.status !== "Probation" || !staff.probationEndDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(staff.probationEndDate);
  if (isNaN(endDate.getTime())) return null;
  endDate.setHours(0, 0, 0, 0);

  if (today <= endDate) return null; // still within probation

  // Confirmation date = whatever it was already, else the standard
  // joining-date + confirmationMonths calculation, else the day right
  // after probation ended.
  const confirmationDate =
    staff.confirmationDate ||
    calculateConfirmationDate(
      getProbationStartDate(staff.date, staff.internshipEndDate),
      staff.confirmationMonths || staff.probationMonths || 3,
    ) ||
    addDays(endDate, 1);

  return { status: "Confirmation", confirmationDate };
};

// Once an internship has actually ended, status moves Internship ->
// Probation automatically. If the probation period has ALSO already elapsed
// (e.g. an old record), it carries straight on to Confirmation in the same
// step. Returns the fields to update, or null if nothing is due yet.
const getAutoAdvanceUpdate = (staff) => {
  let update = null;
  let current = staff;

  if (staff.status === "Internship" && staff.internshipEndDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const internshipEnd = new Date(staff.internshipEndDate);
    if (!isNaN(internshipEnd.getTime())) {
      internshipEnd.setHours(0, 0, 0, 0);
      if (today > internshipEnd) {
        update = { status: "Probation" };
        if (!staff.probationEndDate) {
          update.probationEndDate = calculateProbationEndDate(
            addDays(internshipEnd, 1),
            staff.probationMonths || 3,
          );
        }
        current = { ...staff, ...update };
      }
    }
  }

  const confirmUpdate = getAutoConfirmUpdate(current);
  if (confirmUpdate) update = { ...(update || {}), ...confirmUpdate };
  return update;
};

// Applies getAutoAdvanceUpdate() across a list of (lean) staff docs,
// persisting whichever ones are due in a single bulk write, and returns the
// list with those changes merged in — so callers get the corrected status
// immediately, without a second round trip.
const autoAdvanceStaffList = async (staffList) => {
  const ops = [];
  const result = staffList.map((staff) => {
    const update = getAutoAdvanceUpdate(staff);
    if (!update) return staff;
    ops.push({
      updateOne: { filter: { _id: staff._id }, update: { $set: update } },
    });
    return { ...staff, ...update };
  });
  if (ops.length) await Staff.bulkWrite(ops);
  return result;
};

// Same as above, for a single staff doc (getStaffById / getMyStaffProfile).
const autoAdvanceStaff = async (staff) => {
  if (!staff) return staff;
  const update = getAutoAdvanceUpdate(staff);
  if (!update) return staff;
  await Staff.updateOne({ _id: staff._id }, { $set: update });
  return { ...staff, ...update };
};

/**
 * GET /api/staff/me — the logged-in account's own Staff profile.
 * Staff and User are only linked by email (no stored userId), same
 * pattern used everywhere else in this codebase (see services/leave.js).
 */
export const getMyStaffProfile = asyncHandler(async (req, res) => {
  const email = req.user?.email?.toLowerCase().trim();
  let staff = email
    ? await Staff.findOne({ email }).select("-password").lean()
    : null;

  if (!staff) {
    return res.status(404).json({
      success: false,
      message:
        "No staff profile is linked to your account yet. Contact your admin.",
    });
  }

  staff = await autoAdvanceStaff(staff);
  res.status(200).json({ success: true, data: await resolvePhotoUrls(staff) });
});


// Adds `photoUrl` to a staff object (or each one in an array) so the website
// and the app show the SAME photo that was uploaded from either of them.
// Besides the record's own photo it also finds:
//   - a photo that exists but whose record has no `photoUpdatedAt` (repaired),
//   - a photo uploaded on another staff record with the same e-mail,
//   - a photo uploaded to the login account before the staff record existed.
// null = no photo (initials are shown).
const resolvePhotoUrls = async (input) => {
  const isArray = Array.isArray(input);
  const list = (isArray ? input : [input])
    .filter(Boolean)
    .map((s) => (typeof s.toObject === "function" ? s.toObject() : { ...s }));
  if (list.length) {
    try {
      await fillBirthdayPhotos(list);
    } catch {
      // a photo lookup problem must never break the staff list
    }
    const needAccount = list.filter((s) => !s.photoUpdatedAt && !s._photoOwner && s.email);
    let userByEmail = new Map();
    if (needAccount.length) {
      try {
        const users = await User.find({
          email: { $in: [...new Set(needAccount.map((s) => String(s.email).toLowerCase().trim()))] },
          photoUpdatedAt: { $ne: null },
        })
          .select("_id email photoUpdatedAt")
          .lean();
        userByEmail = new Map(users.map((u) => [String(u.email).toLowerCase().trim(), u]));
      } catch {
        // ignore
      }
    }
    for (const s of list) {
      let url = photoUrlFor(s._photoOwner || s);
      if (!url && s.email) {
        const u = userByEmail.get(String(s.email).toLowerCase().trim());
        if (u) url = userPhotoUrlFor(u);
      }
      s.photoUrl = url || null;
      delete s._photoOwner;
    }
  }
  return isArray ? list : list[0];
};

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

  let staff = await Staff.find(filter).sort({ createdAt: -1 }).lean();
  staff = hideOthersReferral(staff, req.user);
  // Move anyone whose internship / probation period has elapsed on to the
  // next status (Internship -> Probation -> Confirmation) automatically, so
  // the list always reflects today's real status.
  staff = await autoAdvanceStaffList(staff);
  res.json({ success: true, count: staff.length, data: await resolvePhotoUrls(staff) });
});

/**
 * GET /api/staff/left — lean list of staff who have LEFT (status Relieved,
 * relieving date reached), for the Final Settlement dropdown. Only the few
 * fields the page needs, no photo lookups and no auto-advance writes — the
 * full /api/staff list does both, which made that page slow to open.
 * Disabled staff stay hidden, same as every other dropdown.
 */
export const getLeftStaff = asyncHandler(async (req, res) => {
  const staff = await Staff.find({
    status: "Relieved",
    relievingDate: { $ne: null, $lte: new Date() },
    enabled: { $ne: false },
  })
    .select("staffName staffId date confirmationDate relievingDate status enabled")
    .sort({ relievingDate: -1, staffName: 1 })
    .lean();
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
  let staff = await Staff.findById(req.params.id).lean();
  if (!staff) throw new ApiError(404, "Staff member not found");
  staff = hideOthersReferral([staff], req.user)[0];
  staff = await autoAdvanceStaff(staff);
  res.json({ success: true, data: await resolvePhotoUrls(staff) });
});

/** GET /api/staff/:id/password — admin-only: the password as originally entered */
// A bcrypt hash looks like $2a$12$... — anything else stored in the password
// field was inserted directly into the database as plain text.
const looksHashed = (v) => /^\$2[aby]\$\d{2}\$/.test(String(v || ""));

export const getStaffPassword = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const staff = await Staff.findById(req.params.id)
    .select("+password +passwordEncrypted email")
    .lean();
  if (!staff) throw new ApiError(404, "Staff member not found");

  let password = decryptPassword(staff.passwordEncrypted);
  // Tells the History view WHY there is no password to show.
  //   ok           -> password returned
  //   key-mismatch -> a copy is saved but the current key can't read it
  //   hash-only    -> only the one-way login hash exists (older account)
  let passwordStatus = password
    ? "ok"
    : staff.passwordEncrypted
      ? "key-mismatch"
      : "hash-only";

  // Nothing stored by the app: check whether the account was inserted into
  // the database with a plain-text password (Staff or its linked User).
  if (!password) {
    let plain = staff.password && !looksHashed(staff.password) ? staff.password : null;
    if (!plain && staff.email) {
      const user = await User.findOne({ email: staff.email.toLowerCase().trim() })
        .select("+password")
        .lean();
      if (user?.password && !looksHashed(user.password)) plain = user.password;
    }
    if (plain) {
      password = plain;
      passwordStatus = "ok";
      // Remember it so it keeps showing (without touching the login hash).
      await Staff.updateOne(
        { _id: staff._id },
        { $set: { passwordEncrypted: encryptPassword(plain) } },
      );
    }
  }

  res.set("Cache-Control", "no-store");
  res.json({
    success: true,
    data: {
      email: staff.email || null,
      // null => bcrypt-hashed only (cannot be reversed)
      password: password || null,
      status: staff.email ? passwordStatus : "no-login",
    },
  });
});

/** PUT /api/staff/:id/password — admin-only: store/set the login password */
export const setStaffPassword = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const pwd = typeof req.body.password === "string" ? req.body.password.trim() : "";
  if (pwd.length < 6) {
    throw new ApiError(400, "Password must be at least 6 characters");
  }
  const staff = await Staff.findById(req.params.id).select("+password email");
  if (!staff) throw new ApiError(404, "Staff member not found");
  if (!staff.email) {
    throw new ApiError(400, "This staff member has no email, so no login");
  }
  // .save() so the model hook stores the bcrypt hash AND the encrypted,
  // viewable copy.
  staff.password = pwd;
  await staff.save();

  // Keep the linked login account in sync so this is the password they
  // actually log in with.
  const user = await User.findOne({ email: staff.email.toLowerCase().trim() });
  if (user) {
    user.password = pwd;
    await user.save();
  }
  res.set("Cache-Control", "no-store");
  res.json({ success: true, data: { password: pwd } });
});

// GET /api/staff/:id/settlement — Full & Final Settlement Statement for a
// relieved staff member (leave balance, days worked/payable, net amount
// still owed). Only meaningful once status is "Relieved" with a
// relievingDate set — computeFinalSettlement itself enforces that and
// throws a 400 (via err.status) if it isn't.
export const getFinalSettlement = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  try {
    const settlement = await computeFinalSettlement(req.params.id);
    res.json({ success: true, data: settlement });
  } catch (err) {
    // computeFinalSettlement throws plain Errors with a `.status` (400/404)
    // for expected cases (not found / not yet relieved) — translate those
    // into the app's standard ApiError shape instead of a generic 500.
    if (err.status) throw new ApiError(err.status, err.message);
    throw err;
  }
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

// "male" / "M" / "Mr" -> "Male", "female" / "F" / "Ms" / "Mrs" -> "Female".
const normalizeGender = (g) => {
  const v = String(g || "").trim().toLowerCase();
  if (["male", "m", "mr", "mr."].includes(v)) return "Male";
  if (["female", "f", "ms", "ms.", "mrs", "mrs.", "miss"].includes(v)) return "Female";
  return "";
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
    dateOfBirth,
    gender,
    designation,
    department,
    address,
    currentAddress,
    workSchedule,
    status = "Probation",
    internshipMonths = 3,
    internshipEndDate,
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

  // Internship runs from the joining date; calculate its end date when the
  // status is Internship and none was supplied.
  let finalInternshipEndDate = internshipEndDate;
  if (status === "Internship" && !finalInternshipEndDate) {
    finalInternshipEndDate = calculateInternshipEndDate(
      joiningDate,
      internshipMonths,
    );
  }

  // Probation (and confirmation) count from the day after the internship
  // ends — or from the joining date when there was no internship.
  const probationStartDate = getProbationStartDate(
    joiningDate,
    finalInternshipEndDate,
  );

  // Calculate probation end date for Internship (planned) and Probation
  let finalProbationEndDate = probationEndDate;
  if (
    (status === "Internship" || status === "Probation") &&
    !finalProbationEndDate
  ) {
    finalProbationEndDate = calculateProbationEndDate(
      probationStartDate,
      probationMonths,
    );
  }

  // Calculate confirmation date if status is Confirmation
  let finalConfirmationDate = confirmationDate;
  if (status === "Confirmation" && !finalConfirmationDate) {
    finalConfirmationDate = calculateConfirmationDate(
      probationStartDate,
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
    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
    gender: normalizeGender(gender),
    designation: String(designation || "").trim(),
    department: String(department || "").trim(),
    address: String(address || "").trim(),
    currentAddress: String(currentAddress || "").trim(),
    workSchedule: String(workSchedule || "").trim(),
    status: status || "Probation",
    internshipMonths: internshipMonths || 3,
    internshipEndDate: finalInternshipEndDate || null,
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

  // staffId / email must be unique. Checked here as well as by the database
  // index, so the message is clear on every database.
  if (await Staff.exists({ staffId: finalStaffId })) {
    throw new ApiError(409, `Staff ID "${finalStaffId}" already exists`);
  }
  if (trimmedEmail && (await Staff.exists({ email: trimmedEmail }))) {
    throw new ApiError(409, `A staff member with email "${trimmedEmail}" already exists`);
  }

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
    dateOfBirth,
    gender,
    designation,
    department,
    address,
    currentAddress,
    workSchedule,
    status,
    internshipMonths,
    internshipEndDate,
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
  if (dateOfBirth !== undefined) {
    updateData.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
  }
  if (gender !== undefined) updateData.gender = normalizeGender(gender);
  if (designation !== undefined) updateData.designation = String(designation || "").trim();
  if (department !== undefined) updateData.department = String(department || "").trim();
  if (address !== undefined) updateData.address = String(address || "").trim();
  if (currentAddress !== undefined) updateData.currentAddress = String(currentAddress || "").trim();
  if (workSchedule !== undefined) updateData.workSchedule = String(workSchedule || "").trim();
  if (status !== undefined) updateData.status = status;
  if (internshipMonths !== undefined)
    updateData.internshipMonths = internshipMonths;
  if (internshipEndDate !== undefined) {
    updateData.internshipEndDate = internshipEndDate
      ? new Date(internshipEndDate)
      : null;
  }
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

  // Marking someone "Relieved" is how this app records that a staff member
  // has left, but `enabled` is a separate flag that several dashboard/
  // report queries filter on. If this request sets status to Relieved and
  // doesn't also explicitly say what `enabled` should be, default it to
  // false so the two stay in sync and the person disappears from active-
  // staff lists (Present/Not Present, leave balances, etc.) without the
  // admin having to remember a second, separate toggle.
  //
  // This must only happen at the moment the staff member is *moved into*
  // Relieved — NOT on every later save. The staff form never sends `enabled`,
  // so applying it on every save of an already-Relieved record silently
  // flipped an admin's manual "Active" back to Inactive. It is also skipped
  // while the Relieved Date is still in the future (notice period — the
  // person still works here).
  {
    const effectiveRelieving =
      relievingDate !== undefined
        ? relievingDate
          ? new Date(relievingDate)
          : null
        : existingStaff.relievingDate;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    let hasLeft = true; // Relieved with no date recorded counts as left
    if (effectiveRelieving) {
      const d = new Date(effectiveRelieving);
      if (!isNaN(d.getTime())) {
        d.setHours(0, 0, 0, 0);
        hasLeft = d <= startOfToday;
      }
    }
    const becomingRelieved =
      status === "Relieved" && existingStaff.status !== "Relieved";
    if (becomingRelieved && enabled === undefined && hasLeft) {
      updateData.enabled = false;
    }
  }

  // Auto-calculate dates if status changed and no explicit dates provided
  const newStatus = status || existingStaff.status;
  const joiningDate = date ? new Date(date) : existingStaff.date;
  const newInternshipMonths =
    internshipMonths !== undefined
      ? internshipMonths
      : existingStaff.internshipMonths || 3;
  const newProbationMonths =
    probationMonths !== undefined
      ? probationMonths
      : existingStaff.probationMonths;
  const newConfirmationMonths =
    confirmationMonths !== undefined
      ? confirmationMonths
      : existingStaff.confirmationMonths;

  // If status is Internship and internshipEndDate not explicitly set,
  // calculate it — only when it's missing or the inputs it depends on
  // (joining date / internship months) changed, so an admin-picked date
  // isn't overwritten by an unrelated update.
  if (
    newStatus === "Internship" &&
    internshipEndDate === undefined &&
    (!existingStaff.internshipEndDate ||
      date !== undefined ||
      internshipMonths !== undefined)
  ) {
    updateData.internshipEndDate = calculateInternshipEndDate(
      joiningDate,
      newInternshipMonths,
    );
  }

  // Probation / confirmation count from the day after the internship ends
  // (or from the joining date if this staff member had no internship).
  const effectiveInternshipEndDate =
    updateData.internshipEndDate !== undefined
      ? updateData.internshipEndDate
      : existingStaff.internshipEndDate;
  const probationStartDate = getProbationStartDate(
    joiningDate,
    effectiveInternshipEndDate,
  );

  // Internship status: keep the *planned* probation end date filled in.
  if (
    newStatus === "Internship" &&
    probationEndDate === undefined &&
    (!existingStaff.probationEndDate ||
      internshipEndDate !== undefined ||
      internshipMonths !== undefined ||
      date !== undefined ||
      probationMonths !== undefined)
  ) {
    updateData.probationEndDate = calculateProbationEndDate(
      probationStartDate,
      newProbationMonths,
    );
  }

  // If status is Probation and probationEndDate not explicitly set, calculate it
  if (newStatus === "Probation" && probationEndDate === undefined) {
    updateData.probationEndDate = calculateProbationEndDate(
      probationStartDate,
      newProbationMonths,
    );
  }

  // If status is Confirmation and confirmationDate not explicitly set, calculate it
  if (newStatus === "Confirmation" && confirmationDate === undefined) {
    updateData.confirmationDate = calculateConfirmationDate(
      probationStartDate,
      newConfirmationMonths,
    );
  }

  // Note: relievingDate is intentionally NOT auto-defaulted to "today" when
  // status is switched to Relieving. The admin picks the actual last
  // working day in the form; if it's left blank, it just stays blank
  // rather than silently substituting today's date.

  // Status and Employment Type are mutually exclusive in the UI — only
  // enforce that here when this request is actually touching one of them.
  // Otherwise an unrelated update (e.g. just editing contactNo) would wipe
  // out dates that were never part of this request. Only the
  // employmentType-linked project dates get cleared this way — probation
  // end / confirmation start / relieving date are lifecycle history and
  // are preserved regardless of the current status (see
  // applyStatusEmploymentExclusivity above).
  if (status !== undefined || employmentType !== undefined) {
    const newEmploymentType =
      employmentType !== undefined ? employmentType : existingStaff.employmentType;
    applyStatusEmploymentExclusivity(
      { ...updateData, status: newStatus, employmentType: newEmploymentType },
      new Set([
        projectStartDate !== undefined ? "projectStartDate" : null,
        projectEndDate !== undefined ? "projectEndDate" : null,
      ].filter(Boolean)),
    );
    // applyStatusEmploymentExclusivity mutates the object passed to it —
    // pull the (possibly nulled) date fields back out into updateData.
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

  // Joining date changed on a staff member with a referral: the first month
  // (where the commission is taken) moved, so re-run both months' pending
  // payroll — the old month loses the commission, the new month gets it.
  if (updateData.date !== undefined && getReferral(updated)) {
    await refreshReferralMonths(updated._id, [
      istPeriodOf(existingStaff.date),
      istPeriodOf(updated.date),
    ]);
  }

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
  // Removes the staff member AND all their data (attendance, leaves,
  // payroll, advances, expenses, documents, letters, login account, …).
  const { deletedCount, counts } = await purgeStaff([req.params.id]);
  if (!deletedCount) throw new ApiError(404, "Staff member not found");
  res.json({ success: true, message: "Staff member and all related data deleted successfully", counts });
});

/** GET /api/staff/:id/delete-preview — what deleting this staff member removes. */
export const deleteStaffPreview = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const preview = await previewStaffPurge([req.params.id]);
  if (!preview.staff.length) throw new ApiError(404, "Staff member not found");
  res.json({ success: true, data: preview });
});

/** DELETE /api/staff — bulk delete { ids: [...] } (with all related data) */
export const deleteManyStaff = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, "ids must be a non-empty array");
  }
  const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  const { deletedCount, counts } = await purgeStaff(validIds);

  res.json({
    success: true,
    message: `${deletedCount} staff member(s) and all related data deleted successfully`,
    deletedCount,
    counts,
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
    const internshipMonths = row.internshipMonths || 3;
    const probationMonths = row.probationMonths || 3;
    const confirmationMonths = row.confirmationMonths || 3;
    const status = row.status || "Probation";

    let internshipEndDate = row.internshipEndDate
      ? new Date(row.internshipEndDate)
      : null;
    if (status === "Internship" && !internshipEndDate) {
      internshipEndDate = calculateInternshipEndDate(
        joiningDate,
        internshipMonths,
      );
    }
    // Probation / confirmation count from the day after the internship.
    const probationStartDate = getProbationStartDate(
      joiningDate,
      internshipEndDate,
    );

    let probationEndDate = row.probationEndDate
      ? new Date(row.probationEndDate)
      : null;
    let confirmationDate = row.confirmationDate
      ? new Date(row.confirmationDate)
      : null;

    // Auto-calculate if not provided
    if (
      (status === "Internship" || status === "Probation") &&
      !probationEndDate
    ) {
      probationEndDate = calculateProbationEndDate(
        probationStartDate,
        probationMonths,
      );
    }

    if (status === "Confirmation" && !confirmationDate) {
      confirmationDate = calculateConfirmationDate(
        probationStartDate,
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
      dateOfBirth: row.dateOfBirth ? new Date(row.dateOfBirth) : null,
      status: status,
      internshipMonths: internshipMonths,
      internshipEndDate: internshipEndDate,
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
// ── Birthdays ─────────────────────────────────────────────────────────────

// "Today" in India, as a plain local calendar date (midnight).
const istToday = () => {
  const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return new Date(ist.getFullYear(), ist.getMonth(), ist.getDate());
};

// Next birthday on/after `today` for a DOB saved as UTC midnight.
const nextBirthday = (dateOfBirth, today) => {
  const raw = new Date(dateOfBirth);
  if (isNaN(raw.getTime())) return null;
  // Read the day/month in India time: a DOB saved as UTC midnight AND one
  // saved as India midnight (18:30 UTC the day before) both give the right
  // day, so the Wish button opens at 12:00 midnight on the real birthday.
  const dob = new Date(raw.getTime() + 5.5 * 3600 * 1000);
  const m = dob.getUTCMonth();
  const d = dob.getUTCDate();
  let next = new Date(today.getFullYear(), m, d);
  if (next < today) next = new Date(today.getFullYear() + 1, m, d);
  return {
    next,
    daysUntil: Math.round((next - today) / 86400000),
    ymd: `${next.getFullYear()}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  };
};

const isBirthdayToday = (staff) => {
  if (!staff?.dateOfBirth) return false;
  const nb = nextBirthday(staff.dateOfBirth, istToday());
  return !!nb && nb.daysUntil === 0;
};

const sameEmail = (a, b) =>
  !!a && !!b && String(a).toLowerCase().trim() === String(b).toLowerCase().trim();

// Gives every staff object in `staff` (lean, mutated in place) a
// `photoUpdatedAt` when a profile photo really exists for them.
const fillBirthdayPhotos = async (staff) => {
  const missing = staff.filter((s) => !s.photoUpdatedAt);
  if (!missing.length) return;

  // 1) Photo stored for this very staff record.
  const docs = await StaffDocument.find({ staff: { $in: missing.map((s) => s._id) }, type: "photo" })
    .select("staff updatedAt createdAt")
    .lean();
  const byStaff = new Map(docs.map((d) => [String(d.staff), d.updatedAt || d.createdAt || new Date()]));

  // 2) Photo uploaded on another staff record with the same e-mail.
  const emails = missing
    .filter((s) => !byStaff.has(String(s._id)) && s.email)
    .map((s) => String(s.email).toLowerCase().trim());
  const twins = emails.length
    ? await Staff.find({ email: { $in: emails }, photoUpdatedAt: { $ne: null } })
        .select("_id email photoUpdatedAt")
        .lean()
    : [];
  const twinByEmail = new Map(twins.map((t) => [String(t.email).toLowerCase().trim(), t]));

  const repairs = [];
  for (const s of missing) {
    const at = byStaff.get(String(s._id));
    if (at) {
      s.photoUpdatedAt = at;
      repairs.push({ updateOne: { filter: { _id: s._id }, update: { $set: { photoUpdatedAt: at } } } });
      continue;
    }
    const twin = s.email && twinByEmail.get(String(s.email).toLowerCase().trim());
    if (twin) {
      // The signed link is for the record that owns the photo.
      s._photoOwner = { _id: twin._id, photoUpdatedAt: twin.photoUpdatedAt };
    }
  }
  if (repairs.length) await Staff.bulkWrite(repairs).catch(() => {});
};

/**
 * GET /api/staff/birthdays/upcoming?days=60
 * Upcoming birthdays for the mobile "Upcoming birthdays" cards. Only name /
 * team / day+month / photo are returned — never the birth year.
 * Today's birthdays (from 12:00 midnight India time) also carry:
 *   wishCount  — how many colleagues have wished them
 *   wishedByMe — the caller already wished them
 *   canWish    — show the Wish button (never for your own birthday)
 */
export const getUpcomingBirthdays = asyncHandler(async (req, res) => {
  const days = Math.min(366, Math.max(1, parseInt(req.query.days, 10) || 60));
  const today = istToday();

  const staff = await Staff.find({
    enabled: true,
    status: { $ne: "Relieved" },
    dateOfBirth: { $ne: null },
  })
    .select("staffName projectName dateOfBirth email photoUpdatedAt")
    .lean();

  // Colleagues' photos: some staff have an uploaded photo but no
  // `photoUpdatedAt` on the record the birthday list reads (photo uploaded
  // before that field existed, or uploaded on a second staff record with the
  // same e-mail). Those used to show as initials ("AI") for everyone else.
  // Fill them in from the stored photo itself, and repair the record.
  await fillBirthdayPhotos(staff);

  const list = [];
  for (const s of staff) {
    const nb = nextBirthday(s.dateOfBirth, today);
    if (!nb || nb.daysUntil > days) continue;
    list.push({
      _id: s._id,
      staffName: s.staffName,
      projectName: s.projectName || "",
      date: nb.ymd,
      daysUntil: nb.daysUntil,
      isToday: nb.daysUntil === 0,
      isSelf: sameEmail(s.email, req.user?.email),
      photoUrl: photoUrlFor(s._photoOwner || s),
    });
  }

  // Wish info for today's birthdays.
  const todays = list.filter((b) => b.isToday);
  if (todays.length) {
    const year = today.getFullYear();
    const wishes = await BirthdayWish.find({
      staff: { $in: todays.map((b) => b._id) },
      year,
    })
      .select("staff fromUser")
      .lean();
    const me = String(req.user?._id || "");
    for (const b of todays) {
      const mine = wishes.filter((w) => String(w.staff) === String(b._id));
      b.wishCount = mine.length;
      b.wishedByMe = mine.some((w) => String(w.fromUser) === me);
      b.canWish = !b.isSelf;
    }
  }

  list.sort((a, b) => a.daysUntil - b.daysUntil || a.staffName.localeCompare(b.staffName));
  res.json({ success: true, count: list.length, data: list });
});

/**
 * POST /api/staff/birthdays/:id/wish   { message? }
 * Wish a colleague on their birthday. Only on the birthday itself (India
 * date), never yourself, once per person per year.
 */
export const wishBirthday = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const staff = await Staff.findById(req.params.id)
    .select("staffName dateOfBirth email enabled status")
    .lean();
  if (!staff) throw new ApiError(404, "Staff member not found");
  if (sameEmail(staff.email, req.user?.email)) {
    throw new ApiError(400, "You can't wish yourself — enjoy your day! 🎂");
  }
  if (!isBirthdayToday(staff)) {
    throw new ApiError(400, `Today is not ${staff.staffName}'s birthday.`);
  }
  const year = istToday().getFullYear();
  const already = await BirthdayWish.exists({ staff: staff._id, year, fromUser: req.user._id });
  if (already) throw new ApiError(400, `You have already wished ${staff.staffName}.`);

  const fromStaff = req.user?.email
    ? await Staff.findOne({ email: req.user.email.toLowerCase().trim() }).select("_id staffName").lean()
    : null;
  const fromName =
    fromStaff?.staffName ||
    req.user?.name ||
    `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() ||
    "A colleague";

  await BirthdayWish.create({
    staff: staff._id,
    year,
    fromUser: req.user._id,
    fromStaff: fromStaff?._id || null,
    fromName,
    message: String(req.body?.message || "").trim().slice(0, 300),
  });
  const wishCount = await BirthdayWish.countDocuments({ staff: staff._id, year });
  res.status(201).json({
    success: true,
    message: `You wished ${staff.staffName} a happy birthday! 🎉`,
    data: { staffId: staff._id, wishCount, wishedByMe: true },
  });
});

/**
 * GET /api/staff/birthdays/my-wishes — wishes the logged-in staff member
 * received for this year's birthday (shown on their own birthday card).
 */
export const getMyBirthdayWishes = asyncHandler(async (req, res) => {
  const email = req.user?.email?.toLowerCase().trim();
  const me = email ? await Staff.findOne({ email }).select("_id").lean() : null;
  if (!me) return res.json({ success: true, data: [] });
  const wishes = await BirthdayWish.find({ staff: me._id, year: istToday().getFullYear() })
    .sort({ createdAt: -1 })
    .populate("fromStaff", "photoUpdatedAt")
    .lean();
  res.json({
    success: true,
    data: wishes.map((w) => ({
      _id: w._id,
      fromName: w.fromName,
      message: w.message,
      createdAt: w.createdAt,
      photoUrl: w.fromStaff ? photoUrlFor(w.fromStaff) : null,
    })),
  });
});


// ── Referral organisation + first-month commission ─────────────────────
// Only the super admin sets this. Admins see it; a regular staff member
// sees only their OWN referral (on /api/staff/me and in salary figures).
function hideOthersReferral(list, user) {
  if (isAdminRole(user?.role)) return list;
  const me = String(user?.email || "").toLowerCase().trim();
  return list.map((s) => {
    if (!s?.referral) return s;
    if (me && String(s.email || "").toLowerCase().trim() === me) return s;
    const { referral, ...rest } = s;
    return rest;
  });
}

const referralResponse = (staff) => {
  const r = getReferral(staff);
  return r
    ? {
        ...r,
        defaultPeriod: istPeriodOf(staff.date),
      }
    : { organizationName: "", percent: 0, period: null, defaultPeriod: istPeriodOf(staff.date) };
};

// Re-run any still-pending payroll for the months affected, so the saved
// figure follows the new commission straight away.
const refreshReferralMonths = async (staffId, periods) => {
  for (const period of [...new Set(periods.filter(Boolean))]) {
    try {
      await refreshPendingPayrollForPeriod(staffId, period);
    } catch {
      // a refresh problem must never block saving the referral
    }
  }
};

/** PUT /api/staff/:id/referral — super admin only
 *  { organizationName: "Navkar", commissionPercent: 25,
 *    remarks? }  — always taken from the FIRST (joining) month only */
export const setStaffReferral = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const organizationName = String(req.body.organizationName || "").trim();
  const commissionPercent = Math.round(Number(req.body.commissionPercent) * 100) / 100;
  const remarks = String(req.body.remarks || "").trim();

  if (!organizationName) throw new ApiError(400, "Organisation name is required");
  if (organizationName.length > 120) throw new ApiError(400, "Organisation name is too long");
  if (!Number.isFinite(commissionPercent) || commissionPercent <= 0 || commissionPercent > 100) {
    throw new ApiError(400, "Commission % must be more than 0 and at most 100");
  }

  const staff = await Staff.findById(req.params.id);
  if (!staff) throw new ApiError(404, "Staff member not found");
  const oldPeriod = getReferral(staff)?.period || null;
  // Older records may still carry a different month chosen earlier — that
  // month's pending payroll must lose the commission too.
  const oldCustomPeriod = staff.referral?.commissionPeriod || null;

  staff.referral = {
    organizationName,
    commissionPercent,
    commissionPeriod: "", // first (joining) month only
    remarks,
    updatedBy: req.user?.id || req.user?._id,
    updatedByName:
      req.user?.name ||
      [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") ||
      req.user?.email ||
      "",
    updatedAt: new Date(),
  };
  await staff.save();

  const newPeriod = getReferral(staff)?.period || null;
  await refreshReferralMonths(staff._id, [oldPeriod, oldCustomPeriod, newPeriod]);

  res.json({
    success: true,
    message: `Referral saved — ${commissionPercent}% of the first month (${newPeriod || "joining month"}) salary goes to ${organizationName}`,
    data: referralResponse(staff.toObject()),
  });
});

/** DELETE /api/staff/:id/referral — super admin only */
export const clearStaffReferral = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const staff = await Staff.findById(req.params.id);
  if (!staff) throw new ApiError(404, "Staff member not found");
  const oldPeriod = getReferral(staff)?.period || null;
  // Older records may still carry a different month chosen earlier — that
  // month's pending payroll must lose the commission too.
  const oldCustomPeriod = staff.referral?.commissionPeriod || null;
  staff.referral = {
    organizationName: "",
    commissionPercent: 0,
    commissionPeriod: "",
    remarks: "",
    updatedBy: req.user?.id || req.user?._id,
    updatedByName: req.user?.name || req.user?.email || "",
    updatedAt: new Date(),
  };
  await staff.save();
  await refreshReferralMonths(staff._id, [oldPeriod, oldCustomPeriod]);
  res.json({ success: true, message: "Referral removed", data: referralResponse(staff.toObject()) });
});
