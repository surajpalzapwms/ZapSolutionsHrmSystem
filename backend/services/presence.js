// services/presence.js
//
// Automatic attendance based on OFFICE NETWORK PRESENCE.
//
// Every device a staff member uses (the mobile app, the website and the
// Windows PC agent) sends a small "heartbeat" to POST /api/hrm/presence/heartbeat
// whenever its network changes and every few minutes. The backend decides
// whether that heartbeat came from the office network by its public IP
// (OFFICE_ALLOWED_IPS — see utils/officeNetwork.js), so being on the office
// Wi-Fi router is what counts, not anything the device claims.
//
//  1. CONNECT → AUTO SIGN-IN
//     First office heartbeat of the day and the user hasn't signed in yet →
//     they are signed in automatically at that moment (source "auto").
//
//  2. DISCONNECT → TIME STORED
//     A heartbeat from outside the office (phone moved from office Wi-Fi to
//     mobile data), an explicit "offline/shutdown/sleep/logoff" event, or no
//     office heartbeat from ANY of the user's devices for
//     PRESENCE_OFFLINE_TIMEOUT_MINUTES → attendance.lastDisconnectAt is set.
//     While another device of the same user is still in the office, a single
//     device leaving does not count as a disconnect.
//
//  3. RECONNECT → DISCONNECT CLEARED
//     The next office heartbeat clears lastDisconnectAt — the user is
//     present again. A later disconnect stores the new time.
//
//  4. AUTO SIGN-OUT AT THE LAST DISCONNECT TIME
//     If the user never signed out with the button, the record is closed
//     with logoutTime = lastDisconnectAt once BOTH:
//       - they have been gone for AUTO_SIGNOUT_GRACE_MINUTES, and
//       - their shift has ended (never in the middle of the day, so a lunch
//         break is never taken as the going time).
//
//  4b. BACK AFTER AN AUTOMATIC SIGN-OUT → DAY RE-OPENED
//     If the system had signed them out and they come back to the office the
//     same day, the record is re-opened: in-time stays the first arrival and
//     the going time becomes the LAST time they leave.
//     Records still open from a previous day are always closed at their
//     last disconnect / last seen time.
//
//  5. PC SHUTDOWN → SIGN-OUT
//     The Windows agent reports "shutdown"/"logoff". If that happens after
//     shift end, or after the required hours are done, the user is signed
//     out immediately at the shutdown time. A mid-day restart is only
//     stored as a disconnect (and cleared again when the PC comes back).
//
// The sign-out button still works exactly as before; the system only fills
// in what the user forgot.

import crypto from "crypto";
import Attendance from "../models/Attendance.js";
import PresenceDevice from "../models/PresenceDevice.js";
import User from "../models/User.js";
import {
  getDateStringIST,
  getUserShift,
  getClampedWorkingMinutes,
  findAttendanceByUserAndDate,
  REQUIRED_WORK_MINUTES,
} from "./leave.js";
import { performSelfCheckIn, finalizeSignOut } from "../controllers/leave.js";
import { formatMinutesToTimeString } from "./leave.js";
import { isAdminRole } from "../config/permissions.js";

/**
 * Who is marked automatically from the office Wi-Fi?
 *  - staff ("user"): always
 *  - admins: yes, unless AUTO_ATTENDANCE_INCLUDE_ADMINS=false
 *  - super admin: never (has no staff record or attendance)
 */
export const autoAttendanceApplies = (role) => {
  const r = String(role || "").toLowerCase();
  if (r === "super-admin") return false;
  if (r === "admin") return process.env.AUTO_ATTENDANCE_INCLUDE_ADMINS !== "false";
  return true;
};
import { markCalendarDataChanged } from "./calendarHealCache.js";
import { isUserLeftOrganization } from "./staffVisibility.js";

const num = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

// No office heartbeat from any device for this long = disconnected.
// Phones in the background can only check in about every 15 minutes, so
// keep this comfortably above that.
export const OFFLINE_TIMEOUT_MINUTES = () =>
  num(process.env.PRESENCE_OFFLINE_TIMEOUT_MINUTES, 30);
// How long someone must stay disconnected before the system signs them out
// (lunch breaks, a quick trip downstairs, a PC restart etc. never trigger it).
export const AUTO_SIGNOUT_GRACE_MINUTES = () =>
  num(process.env.AUTO_SIGNOUT_GRACE_MINUTES, 60);

export const LEAVING_EVENTS = ["offline", "shutdown", "sleep", "logoff"];
export const ALL_EVENTS = [
  "heartbeat",
  "startup",
  "online",
  "login",
  "resume",
  ...LEAVING_EVENTS,
];
const SHUTDOWN_EVENTS = ["shutdown", "logoff"];

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_EVENTS = 60;

export const hashDeviceToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

export const newDeviceToken = () => crypto.randomBytes(32).toString("hex");

/** Minutes since IST midnight for a timestamp. */
const istMinuteOfDay = (date) => {
  const ist = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
};

const hmToMinutes = (hm) => {
  const [h, m] = String(hm).split(":").map(Number);
  return h * 60 + (m || 0);
};

const pushEvent = (rec, type, at, device) => {
  const list = Array.isArray(rec.presenceEvents) ? rec.presenceEvents : [];
  list.push({
    type,
    at,
    platform: device?.platform,
    deviceName: device?.name,
  });
  rec.presenceEvents = list.slice(-MAX_EVENTS);
};

/** Net minutes worked on this record if it were closed at `until`. */
const workedMinutesUntil = (rec, user, until) => {
  const { shiftStartTime, shiftEndTime } = getUserShift(user);
  if (!rec.loginTime || !until || new Date(until) <= new Date(rec.loginTime)) {
    return rec.sessionMinutes || 0;
  }
  return (
    (rec.sessionMinutes || 0) +
    getClampedWorkingMinutes(rec.loginTime, until, shiftStartTime, shiftEndTime)
  );
};

/**
 * May this (still open) record be closed now, at its disconnect time?
 * True once the shift is over, or once the required hours were already
 * complete when the user left.
 */
export const isDayDoneFor = (rec, user, disconnectAt, now = new Date()) => {
  const { shiftEndTime } = getUserShift(user);
  const shiftOver = istMinuteOfDay(now) >= hmToMinutes(shiftEndTime);
  const workedEnough =
    workedMinutesUntil(rec, user, disconnectAt) >= REQUIRED_WORK_MINUTES;
  return shiftOver || workedEnough;
};

/** Has this user's shift ended for the day (IST)? */
export const isShiftOver = (user, now = new Date()) => {
  const { shiftEndTime } = getUserShift(user);
  return istMinuteOfDay(now) >= hmToMinutes(shiftEndTime);
};

/** Is any OTHER device of this user currently checking in from the office? */
const otherDeviceInOffice = async (userId, exceptDeviceId, now) => {
  const since = new Date(now.getTime() - OFFLINE_TIMEOUT_MINUTES() * 60000);
  const q = { userId, inOffice: true, revoked: { $ne: true }, lastSeenAt: { $gte: since } };
  if (exceptDeviceId) q._id = { $ne: exceptDeviceId };
  return !!(await PresenceDevice.exists(q));
};

const autoSignOut = async (rec, user, at, reason, reasonText) => {
  pushEvent(rec, "auto_signout", at, null);
  // Remember the open state, so the record can be re-opened exactly as it
  // was if the user walks back into the office later the same day.
  rec.autoSignOutSnapshot = { sessionMinutes: rec.sessionMinutes || 0 };
  await finalizeSignOut(rec, user, at, { auto: true, reason, reasonText });
  markCalendarDataChanged();
};

/** Give extra-hours minutes back to the bank (newest earlier working day). */
const refundBankMinutes = async (rec) => {
  const minutes = Math.max(0, Math.floor(rec.bankMinutesUsed || 0));
  if (!minutes) return;
  const target = await Attendance.findOne({
    userId: rec.userId,
    _id: { $ne: rec._id },
    isLeaveDay: { $ne: true },
    loginTime: { $lt: rec.loginTime },
  }).sort({ loginTime: -1 });
  if (!target) return;
  target.extraHoursInMinutes = (target.extraHoursInMinutes || 0) + minutes;
  target.extraHours = formatMinutesToTimeString(target.extraHoursInMinutes);
  await target.save();
};

/**
 * The SYSTEM signed this user out (they left the office network), and now
 * they are back in the office the same day → it was only a break, not the
 * going time. Re-open the record: the in-time stays the first arrival and
 * the going time will be the LAST time they leave.
 */
const reopenAfterAutoSignOut = async (rec, device, now) => {
  await refundBankMinutes(rec);
  rec.sessionMinutes = rec.autoSignOutSnapshot?.sessionMinutes ?? 0;
  rec.autoSignOutSnapshot = undefined;
  rec.logoutTime = undefined;
  rec.totalTime = undefined;
  rec.attendanceType = undefined;
  rec.extraHours = undefined;
  rec.extraHoursInMinutes = 0;
  rec.bankMinutesUsed = 0;
  rec.autoSignedOut = false;
  rec.signOutReason = undefined;
  rec.remarks = undefined;
  rec.lastDisconnectAt = undefined;
  rec.lastSeenInOfficeAt = now;
  pushEvent(rec, "reopen", now, device);
  await rec.save();
  markCalendarDataChanged();
};

const fmtIST = (d) =>
  new Date(d).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Upserts the device a heartbeat came from. For PC agents the device is
 * already known (authenticated by its token) and passed in directly.
 */
export const upsertDevice = async ({ user, device, deviceId, platform, name }) => {
  if (device) return device;
  const id = String(deviceId || "legacy-web").slice(0, 100);
  const allowed = ["pc", "android", "ios", "web", "other"];
  const plat = allowed.includes(platform) ? platform : "other";
  return PresenceDevice.findOneAndUpdate(
    { userId: user._id, deviceId: id },
    {
      $set: { platform: plat, ...(name ? { name: String(name).slice(0, 120) } : {}) },
      $setOnInsert: { userId: user._id, deviceId: id },
    },
    { upsert: true, new: true },
  );
};

/**
 * Main entry point: one heartbeat/event from one device.
 * @returns {{ skipped?: string, inOffice: boolean, action: string, attendance?: object }}
 */
export const handlePresenceEvent = async ({
  user,
  device,
  event = "heartbeat",
  fromOfficeNetwork,
  ip,
  leftAt = null,
  now = new Date(),
}) => {
  if (!ALL_EVENTS.includes(event)) event = "heartbeat";
  const leaving = LEAVING_EVENTS.includes(event);
  const inOffice = !leaving && !!fromOfficeNetwork;

  // Device bookkeeping (kept for admins too, harmless).
  device.lastSeenAt = now;
  device.lastIp = ip;
  device.lastEvent = event;
  device.inOffice = inOffice;
  if (inOffice) device.lastInOfficeAt = now;
  await device.save();

  // Super admin is never auto-marked; admins only when switched off.
  if (!autoAttendanceApplies(user.role)) {
    return { skipped: "admin", inOffice, action: "none" };
  }

  const userId = user._id;
  // Left the organization: nothing is marked any more (see staffVisibility).
  if (await isUserLeftOrganization(userId, now)) {
    return { skipped: "left_organization", inOffice, action: "none" };
  }

  const today = getDateStringIST(now);
  let rec = await findAttendanceByUserAndDate(userId, today);

  if (inOffice) {
    let action = "present";

    if (!rec) {
      const result = await performSelfCheckIn(userId, { source: "auto", at: now });
      if (!result.ok) {
        // Holiday / Sunday etc. — nothing to mark.
        return { inOffice, action: "none", reason: result.message };
      }
      rec = result.attendance;
      action = "signed_in";
      pushEvent(rec, "connect", now, device);
      rec.lastSeenInOfficeAt = now;
      await rec.save();
      markCalendarDataChanged();
      return { inOffice, action, attendance: rec };
    }

    if (rec.logoutTime) {
      if (rec.autoSignedOut) {
        // Signed out by the SYSTEM (left the Wi-Fi range) but back again
        // today → that was a break, not the going time. Re-open the day.
        await reopenAfterAutoSignOut(rec, device, now);
        return { inOffice, action: "reopened", attendance: rec };
      }
      // Signed out with the button — the user closed the day themselves.
      return { inOffice, action: "already_signed_out", attendance: rec };
    }

    if (rec.lastDisconnectAt) {
      // Back in the office: the earlier disconnect no longer matters.
      rec.lastDisconnectAt = undefined;
      pushEvent(rec, "reconnect", now, device);
      action = "reconnected";
    } else if (!rec.lastSeenInOfficeAt) {
      pushEvent(rec, "connect", now, device);
    }
    rec.lastSeenInOfficeAt = now;
    await rec.save();
    return { inOffice, action, attendance: rec };
  }

  // ── Not in the office (left the Wi-Fi, PC shutting down, ...) ──────────
  if (!rec || rec.logoutTime) {
    return { inOffice, action: "none", attendance: rec || undefined };
  }
  // Only track disconnects for days on which the user was actually seen in
  // the office — someone who signed in by button while working from home
  // must not be auto-signed-out because their phone is "outside the office".
  if (!rec.lastSeenInOfficeAt) {
    return { inOffice, action: "none", attendance: rec };
  }
  if (await otherDeviceInOffice(userId, device._id, now)) {
    // e.g. phone left but the PC is still on in the office.
    return { inOffice, action: "other_device_in_office", attendance: rec };
  }

  // The phone may report WHEN it really left (it noticed a bit late, e.g.
  // the OS woke the app a few minutes after walking out). Trust it only if
  // it is after the last time we saw them in the office and not in the future.
  let leftTime = now;
  if (leftAt) {
    const t = new Date(leftAt);
    const lastSeen = rec.lastSeenInOfficeAt ? new Date(rec.lastSeenInOfficeAt) : null;
    if (!Number.isNaN(t.getTime()) && t <= now && (!lastSeen || t >= lastSeen)) leftTime = t;
  }

  let action = "disconnected";
  if (!rec.lastDisconnectAt) {
    rec.lastDisconnectAt = leftTime;
    pushEvent(rec, leaving ? event : "disconnect", leftTime, device);
  } else if (leaving) {
    pushEvent(rec, event, now, device);
    action = "still_disconnected";
  } else {
    action = "still_disconnected";
  }

  if (
    SHUTDOWN_EVENTS.includes(event) &&
    isDayDoneFor(rec, user, rec.lastDisconnectAt, now)
  ) {
    await autoSignOut(
      rec,
      user,
      rec.lastDisconnectAt,
      "pc_shutdown",
      `${event === "logoff" ? "PC signed off" : "PC shut down"} at ${fmtIST(now)}`,
    );
    return { inOffice, action: "signed_out", attendance: rec };
  }

  await rec.save();
  return { inOffice, action, attendance: rec };
};

/**
 * Periodic pass (every few minutes, see server.js):
 *  - marks users whose devices all went silent as disconnected, and
 *  - signs out anyone who left and didn't come back.
 */
export const runPresenceSweep = async (now = new Date()) => {
  const today = getDateStringIST(now);
  const weekAgo = getDateStringIST(new Date(now.getTime() - 7 * 86400000));
  const timeoutMs = OFFLINE_TIMEOUT_MINUTES() * 60000;
  const graceMs = AUTO_SIGNOUT_GRACE_MINUTES() * 60000;

  const open = await Attendance.find({
    logoutTime: { $exists: false },
    date: { $gte: weekAgo, $lte: today },
    lastSeenInOfficeAt: { $exists: true },
  });

  const summary = { checked: open.length, timedOut: 0, signedOut: 0 };
  if (!open.length) return summary;

  const users = await User.find({ _id: { $in: open.map((r) => r.userId) } })
    .select("role shiftStartTime shiftEndTime")
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  for (const rec of open) {
    try {
      const user = userById.get(String(rec.userId));
      if (!user || !autoAttendanceApplies(user.role)) continue;

      // Previous day still open → close at the last disconnect / last seen.
      if (rec.date < today) {
        const at = rec.lastDisconnectAt || rec.lastSeenInOfficeAt;
        await autoSignOut(
          rec,
          user,
          at,
          "day_end",
          `not signed out; last seen at office ${fmtIST(at)}`,
        );
        summary.signedOut++;
        continue;
      }

      // Every device silent for too long → disconnected at the last time
      // any of them was seen in the office.
      if (!rec.lastDisconnectAt) {
        const devices = await PresenceDevice.find({
          userId: rec.userId,
          revoked: { $ne: true },
        })
          .select("inOffice lastSeenAt lastInOfficeAt")
          .lean();
        const stillHere = devices.some(
          (d) => d.inOffice && d.lastSeenAt && now - new Date(d.lastSeenAt) < timeoutMs,
        );
        if (!stillHere) {
          const lastSeen = [rec.lastSeenInOfficeAt, ...devices.map((d) => d.lastInOfficeAt)]
            .filter(Boolean)
            .map((d) => new Date(d))
            .sort((a, b) => b - a)[0];
          if (lastSeen && now - lastSeen >= timeoutMs) {
            rec.lastDisconnectAt = lastSeen;
            pushEvent(rec, "timeout", lastSeen, null);
            await rec.save();
            summary.timedOut++;
          }
        }
      }

      // Close the day only once the shift is over. Leaving earlier (lunch,
      // a meeting outside...) is never treated as the going time while the
      // user can still come back — the LAST leaving time is used.
      if (
        rec.lastDisconnectAt &&
        now - new Date(rec.lastDisconnectAt) >= graceMs &&
        isShiftOver(user, now)
      ) {
        await autoSignOut(
          rec,
          user,
          rec.lastDisconnectAt,
          "left_office",
          `left office network at ${fmtIST(rec.lastDisconnectAt)}`,
        );
        summary.signedOut++;
      }
    } catch (err) {
      console.error("Presence sweep failed for record", String(rec._id), err.message);
    }
  }
  return summary;
};

