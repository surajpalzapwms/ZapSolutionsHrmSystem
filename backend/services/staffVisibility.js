// services/staffVisibility.js
//
// Two rules about staff who are no longer "normal" members of the app:
//
// 1. DISABLED (Staff.enabled === false — the Enable/Disable toggle on the
//    Staff tab, shown next to "Left" for staff who have left)
//    -> the staff member is visible ONLY on the Staff tab. Their rows are
//       dropped from every other list the app shows (attendance, leaves,
//       payroll, staff basic payroll, advances, resignations, birthdays,
//       documents, staff summary) and from every staff dropdown.
//    Enabled staff who have left keep showing everywhere, including the
//    dropdowns, exactly like current staff.
//
// 2. LEFT THE ORGANIZATION (status "Relieved" and the relieving date — the
//    last working day — is before today, IST)
//    -> never marked present after their last working day. A left staff
//       member who is still logged in on the website / app is not signed in
//       automatically or by the button, and does not count in "present
//       today" / today's attendance.
//
// Both lists are small, so they are read in one go and kept for a few
// seconds per company. Any write to a staff / HRM / auth route clears them
// (see server.js), so flipping the toggle takes effect immediately.

import Staff from "../models/Staff.js";
import User from "../models/User.js";
import { getCompanyId } from "../utils/tenant.js";
import { isAdminRole } from "../config/permissions.js";

const TTL_MS = 15 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const cache = new Map(); // companyKey -> { at, value }
const inFlight = new Map(); // companyKey -> Promise

export const clearStaffVisibilityCache = () => {
  cache.clear();
  inFlight.clear();
};

/** "YYYY-MM-DD" of a date in India time. Plain "YYYY-MM-DD" strings pass through. */
export const istDayKey = (value) => {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
};

// Relieving dates are saved as midnight of the chosen day (UTC or IST
// depending on the screen that saved it). Reading the UTC date part of a
// UTC-midnight value, or the IST date of an IST-midnight value, both give
// the day the admin picked.
const relievingKey = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const utcKey = d.toISOString().slice(0, 10);
  const istKey = istDayKey(d);
  return utcKey > istKey ? utcKey : istKey;
};

const idOf = (v) => {
  if (!v) return null;
  if (typeof v === "object") return v._id ? String(v._id) : v.toString?.() || null;
  return String(v);
};

const build = async () => {
  const staff = await Staff.find({
    $or: [{ enabled: false }, { status: "Relieved" }],
  })
    .select("_id email enabled status relievingDate")
    .lean();

  const emails = [
    ...new Set(staff.map((s) => s.email && s.email.toLowerCase().trim()).filter(Boolean)),
  ];
  const users = emails.length
    ? await User.find({ email: { $in: emails } }).select("_id email").lean()
    : [];
  const userIdByEmail = new Map(users.map((u) => [String(u.email).toLowerCase(), String(u._id)]));

  const hiddenIds = new Set(); // Staff._id AND linked User._id of disabled staff
  const lastDayByUserId = new Map(); // User._id -> last working day key (left staff)
  const lastDayByStaffId = new Map(); // Staff._id -> last working day key

  for (const s of staff) {
    const sid = String(s._id);
    const uid = s.email ? userIdByEmail.get(s.email.toLowerCase().trim()) : null;
    if (s.enabled === false) {
      hiddenIds.add(sid);
      if (uid) hiddenIds.add(uid);
    }
    if (s.status === "Relieved") {
      // "Relieved" with no date recorded counts as already gone.
      const key = relievingKey(s.relievingDate) || "0000-00-00";
      lastDayByStaffId.set(sid, key);
      if (uid) lastDayByUserId.set(uid, key);
    }
  }

  return { hiddenIds, lastDayByUserId, lastDayByStaffId };
};

/** Cached { hiddenIds, lastDayByUserId, lastDayByStaffId } for the current company. */
export const getStaffVisibility = async () => {
  const key = getCompanyId() || "_";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (inFlight.has(key)) return inFlight.get(key);
  const p = build()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
};

/** True when this login account belongs to staff whose last working day is before `day`. */
export const hasUserLeftBy = (visibility, userId, day = new Date()) => {
  const last = visibility.lastDayByUserId.get(idOf(userId));
  if (!last) return false;
  return istDayKey(day) > last;
};

/** Async convenience for a single user (sign-in / presence). */
export const isUserLeftOrganization = async (userId, day = new Date()) => {
  if (!userId) return false;
  const v = await getStaffVisibility();
  return hasUserLeftBy(v, userId, day);
};

export const LEFT_ORGANIZATION_MESSAGE =
  "You have left the organization — attendance can no longer be marked for you.";

// ── Response filter ─────────────────────────────────────────────────────
// Fields on list rows that point at a staff member (Staff._id) or at the
// staff member's login account (User._id).
const REF_FIELDS = ["employeeId", "userId", "staffId", "attendanceUserId", "employee", "staff", "user"];

const rowIsHidden = (row, hiddenIds, { matchOwnId }) => {
  if (!row || typeof row !== "object") return false;
  if (matchOwnId && row._id && hiddenIds.has(String(row._id))) return true;
  for (const f of REF_FIELDS) {
    const id = idOf(row[f]);
    if (id && hiddenIds.has(id)) return true;
  }
  return false;
};

// An attendance row dated after the staff member's last working day.
const rowIsAfterLeaving = (row, v) => {
  if (!row || typeof row !== "object" || row.isLeaveDay) return false;
  const uid = idOf(row.userId);
  if (!uid) return false;
  const last = v.lastDayByUserId.get(uid);
  if (!last) return false;
  const day = istDayKey(row.date || row.loginTime || row.createdAt);
  return !!day && day > last;
};

const ARRAY_KEYS = ["data", "records", "leaves", "attendance", "requests", "details", "items", "resignations"];

const filterArraysIn = (body, keep) => {
  if (Array.isArray(body)) return body.filter(keep);
  if (!body || typeof body !== "object") return body;
  let out = body;
  for (const k of ARRAY_KEYS) {
    const val = body[k];
    if (Array.isArray(val)) {
      const next = val.filter(keep);
      if (next.length !== val.length) {
        if (out === body) out = { ...body };
        out[k] = next;
        if (typeof body.count === "number" && body.count === val.length) out.count = next.length;
      }
    } else if (val && typeof val === "object" && !Array.isArray(val) && k === "data") {
      // { data: { details: [...] } } (pending payroll summary) etc.
      const inner = filterArraysIn(val, keep);
      if (inner !== val) {
        if (out === body) out = { ...body };
        out[k] = inner;
      }
    }
  }
  return out;
};

/**
 * Express middleware factory: on the listed GET paths, drops rows that belong
 * to disabled staff (and, for attendance lists, rows dated after a left staff
 * member's last working day) from the JSON response.
 *
 *   paths       — exact sub-paths (relative to the mount point) to filter
 *   ownIdPaths  — paths whose rows ARE staff records (match row._id too)
 *   attendancePaths — paths listing Attendance rows
 *
 * Skipped when the request asks for one specific staff member (?employeeId=,
 * ?staffId=, ?userId=) or explicitly for everyone by an admin (?includeHidden=true — the
 * Staff tab).
 */
export const hideDisabledStaffRows = ({ paths = [], ownIdPaths = [], attendancePaths = [] }) => {
  const all = new Set([...paths, ...ownIdPaths, ...attendancePaths]);
  const own = new Set(ownIdPaths);
  const att = new Set(attendancePaths);
  return async (req, res, next) => {
    if (req.method !== "GET") return next();
    const p = req.path.replace(/\/+$/, "") || "/";
    if (!all.has(p)) return next();
    const q = req.query || {};
    if (q.employeeId || q.staffId || q.userId) return next();
    // ?includeHidden=true (the Staff tab) is honoured for admin / super admin
    // only — checked when the response is sent, after protect() has run.
    const wantsHidden = q.includeHidden === "true" || q.includeHidden === true;

    const matchOwnId = own.has(p);
    const isAttendance = att.has(p);

    // The lists are read when the response is sent — by then protect() has
    // run, so the lookup is limited to the caller's company.
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 400) return originalJson(body);
      if (wantsHidden && isAdminRole(req.user?.role)) return originalJson(body);
      getStaffVisibility()
        .then((v) => {
          const keep = (row) =>
            !rowIsHidden(row, v.hiddenIds, { matchOwnId }) &&
            !(isAttendance && rowIsAfterLeaving(row, v));
          originalJson(filterArraysIn(body, keep));
        })
        .catch(() => {
          // never break a list because of this filter
          if (!res.headersSent) originalJson(body);
        });
      return res;
    };
    next();
  };
};
