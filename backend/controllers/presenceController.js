// controllers/presenceController.js — see services/presence.js for the rules.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Attendance from "../models/Attendance.js";
import PresenceDevice from "../models/PresenceDevice.js";
import User from "../models/User.js";
import OfficeNetwork from "../models/OfficeNetwork.js";
import OfficeWifi from "../models/OfficeWifi.js";
import {
  isFromOfficeNetwork,
  detectOffice,
  readWifiFromBody,
  normalizeBssid,
  getEnvOfficeWifiNames,
  wifiMatchesOffice,
  getClientIp,
  officeEntryForIp,
  reloadOfficeNetworks,
  isOfficeNetworkConfigured,
  ipMatchesOffice,
  isLoopbackIp,
  serverLanEntries,
  parseOfficeEntries,
  getEnvOfficeEntries,
  privateLanAllowed,
} from "../utils/officeNetwork.js";
import { isAdminRole } from "../config/permissions.js";
import { protect } from "../middleware/auth.js";
import { getDateStringIST } from "../services/leave.js";
import {
  handlePresenceEvent,
  autoAttendanceApplies,
  upsertDevice,
  hashDeviceToken,
  newDeviceToken,
  OFFLINE_TIMEOUT_MINUTES,
  AUTO_SIGNOUT_GRACE_MINUTES,
} from "../services/presence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.join(__dirname, "..", "agent", "windows");

const clientIp = getClientIp;

/**
 * Auth for presence routes: either a PC agent device token
 * (X-Device-Token header) or the normal login JWT (Authorization: Bearer).
 */
export const protectUserOrDevice = async (req, res, next) => {
  const deviceToken = req.get("x-device-token");
  if (!deviceToken) return protect(req, res, next);

  try {
    const device = await PresenceDevice.findOne({
      tokenHash: hashDeviceToken(deviceToken),
      revoked: { $ne: true },
    });
    if (!device) {
      return res
        .status(401)
        .json({ success: false, message: "Unknown or revoked device", code: "DEVICE_INVALID" });
    }
    const user = await User.findById(device.userId).select("-password");
    if (!user || user.isActive === false) {
      return res
        .status(403)
        .json({ success: false, message: "User inactive", code: "STAFF_INACTIVE" });
    }
    req.user = user;
    req.device = device;
    return next();
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const shapeAttendance = (rec) =>
  rec
    ? {
        _id: rec._id,
        date: rec.date,
        loginTime: rec.loginTime,
        logoutTime: rec.logoutTime,
        source: rec.source,
        lastSeenInOfficeAt: rec.lastSeenInOfficeAt,
        lastDisconnectAt: rec.lastDisconnectAt,
        autoSignedOut: rec.autoSignedOut,
        signOutReason: rec.signOutReason,
        attendanceType: rec.attendanceType,
        totalTime: rec.totalTime,
      }
    : null;

// POST /api/presence/heartbeat
// body: { event, deviceId, platform, name, wifi?: { ssid, bssid },
//         geo?: { inOffice }, leftAt? }  (geo / leftAt: phone app only)
// The phone app and the PC agent send the Wi-Fi name they are connected to;
// the website can't read it and is matched by network address only.
export const heartbeat = async (req, res) => {
  try {
    const { event, deviceId, platform, name, hostname } = req.body || {};
    let device = req.device;
    if (device) {
      // PC agent: refresh its display name from the machine it runs on.
      const label = name || hostname;
      if (label && label !== device.name) device.name = String(label).slice(0, 120);
    }
    device = await upsertDevice({ user: req.user, device, deviceId, platform, name });

    const office = detectOffice(req);
    // Phone app: it also checks the office GPS circle (needed when the phone
    // can't read the Wi-Fi name in the background, e.g. Android with the app
    // closed). Without this the server never heard "I'm back" after lunch
    // and later closed the day at the lunch-time disconnect.
    const geoInOffice = req.body?.geo?.inOffice === true;
    const result = await handlePresenceEvent({
      user: req.user,
      device,
      event,
      fromOfficeNetwork: office.inOffice || geoInOffice,
      ip: clientIp(req),
      leftAt: req.body?.leftAt || null,
    });

    res.json({
      success: true,
      inOffice: result.inOffice,
      via: result.inOffice ? office.via || (geoInOffice ? "gps" : null) : null,
      wifiName: office.wifi.ssid || null,
      action: result.action,
      skipped: result.skipped,
      reason: result.reason,
      ip: clientIp(req),
      officeNetworkConfigured: isOfficeNetworkConfigured(),
      attendance: shapeAttendance(result.attendance),
    });
  } catch (err) {
    console.error("Presence heartbeat failed:", err.message);
    // Background call — never surface as an error to the device.
    res.status(200).json({ success: false, action: "error" });
  }
};

// Backwards-compatible handler for the website's existing
// POST /api/hrm/leaves/attendance/auto-checkin call.
export const legacyAutoCheckIn = async (req, res) => {
  try {
    const device = await upsertDevice({
      user: req.user,
      deviceId: "legacy-web",
      platform: "web",
      name: "Website",
    });
    const result = await handlePresenceEvent({
      user: req.user,
      device,
      event: "login",
      fromOfficeNetwork: isFromOfficeNetwork(req),
      ip: clientIp(req),
    });
    res.status(200).json({
      success: true,
      skipped: result.skipped ? true : !result.inOffice,
      reason: result.skipped || (result.inOffice ? undefined : "not_office_network"),
      action: result.action,
      attendance: shapeAttendance(result.attendance),
    });
  } catch (err) {
    res.status(200).json({ success: true, skipped: true, reason: "error" });
  }
};

// GET /api/presence/me — my presence status today + my devices
export const getMyPresence = async (req, res) => {
  try {
    const userId = req.user._id;
    const [rec, devices] = await Promise.all([
      Attendance.findOne({ userId, date: getDateStringIST(new Date()) }).lean(),
      PresenceDevice.find({ userId, revoked: { $ne: true } })
        .select("-tokenHash")
        .sort({ lastSeenAt: -1 })
        .lean(),
    ]);
    res.json({
      success: true,
      fromOfficeNetwork: isFromOfficeNetwork(req),
      ip: clientIp(req),
      officeNetworkConfigured: isOfficeNetworkConfigured(),
      attendance: shapeAttendance(rec),
      events: rec?.presenceEvents || [],
      devices,
      settings: {
        offlineTimeoutMinutes: OFFLINE_TIMEOUT_MINUTES(),
        autoSignOutGraceMinutes: AUTO_SIGNOUT_GRACE_MINUTES(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/presence/devices/:id — remove (revoke) one of my devices.
// Admins may revoke anyone's device.
export const revokeDevice = async (req, res) => {
  try {
    const device = await PresenceDevice.findById(req.params.id);
    if (!device) return res.status(404).json({ success: false, message: "Device not found" });
    if (String(device.userId) !== String(req.user._id) && !isAdminRole(req.user.role)) {
      return res.status(403).json({ success: false, message: "Not your device" });
    }
    device.revoked = true;
    device.inOffice = false;
    device.tokenHash = undefined;
    await device.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const psEscape = (s) => String(s ?? "").replace(/[`"$]/g, "");

// GET /api/presence/agent/windows?name=My%20Laptop
// Creates a new device key for the caller and returns a personal installer
// (.ps1) with the key and this server's URL already filled in.
export const downloadWindowsAgent = async (req, res) => {
  try {
    const user = req.user;
    const token = newDeviceToken();
    const deviceName = psEscape(req.query.name || `${user.firstName || "Staff"}'s PC`).slice(0, 60);
    await PresenceDevice.create({
      userId: user._id,
      deviceId: `pc-${token.slice(0, 12)}`,
      platform: "pc",
      name: deviceName,
      tokenHash: hashDeviceToken(token),
    });

    const apiUrl = (
      process.env.PUBLIC_API_URL ||
      process.env.BACKEND_URL ||
      `${req.protocol}://${req.get("host")}`
    ).replace(/\/+$/, "");

    const fileName = "Install-HrmAttendanceAgent.ps1";
    const agent = fs.readFileSync(path.join(AGENT_DIR, "HrmPresenceAgent.ps1"), "utf8");
    const template = fs.readFileSync(path.join(AGENT_DIR, "install-template.ps1"), "utf8");
    const out = template
      .replace("__AGENT_SCRIPT__", () => agent.trimEnd())
      .replaceAll("__API_URL__", psEscape(apiUrl))
      .replaceAll("__DEVICE_TOKEN__", token)
      .replaceAll("__DEVICE_NAME__", deviceName)
      .replaceAll("__USER_NAME__", psEscape(user.name || user.email))
      .replaceAll("__USER_EMAIL__", psEscape(user.email))
      .replaceAll("__FILE_NAME__", fileName)
      // Windows PowerShell 5.1 is happiest with CRLF line endings.
      .replace(/\r?\n/g, "\r\n");

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Cache-Control", "no-store");
    // UTF-8 BOM so PowerShell 5.1 reads the dashes/arrows correctly.
    res.send("﻿" + out);
  } catch (err) {
    console.error("Agent download failed:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/presence/live — admin: everyone's presence today
export const getLivePresence = async (req, res) => {
  try {
    const today = getDateStringIST(new Date());
    const timeoutMs = OFFLINE_TIMEOUT_MINUTES() * 60000;
    const now = Date.now();

    const [records, devices] = await Promise.all([
      Attendance.find({ date: today }).populate("userId", "name email role").lean(),
      PresenceDevice.find({ revoked: { $ne: true }, lastSeenAt: { $exists: true } })
        .select("-tokenHash")
        .populate("userId", "name email role")
        .lean(),
    ]);

    const devicesByUser = new Map();
    for (const d of devices) {
      if (!d.userId) continue;
      const k = String(d.userId._id);
      if (!devicesByUser.has(k)) devicesByUser.set(k, []);
      devicesByUser.get(k).push({
        _id: d._id,
        name: d.name,
        platform: d.platform,
        lastSeenAt: d.lastSeenAt,
        inOffice: !!d.inOffice && now - new Date(d.lastSeenAt) < timeoutMs,
        lastInOfficeAt: d.lastInOfficeAt,
      });
    }

    const rows = records
      .filter((r) => r.userId && autoAttendanceApplies(r.userId.role))
      .map((r) => {
        const k = String(r.userId._id);
        const devs = devicesByUser.get(k) || [];
        let status;
        if (r.logoutTime) status = r.autoSignedOut ? "auto_signed_out" : "signed_out";
        else if (devs.some((d) => d.inOffice) && !r.lastDisconnectAt) status = "in_office";
        else if (r.lastDisconnectAt) status = "away";
        else status = "signed_in";
        return {
          userId: k,
          name: r.userId.name,
          email: r.userId.email,
          status,
          ...shapeAttendance(r),
          events: (r.presenceEvents || []).slice(-10),
          devices: devs,
        };
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    res.json({
      success: true,
      date: today,
      settings: {
        offlineTimeoutMinutes: OFFLINE_TIMEOUT_MINUTES(),
        autoSignOutGraceMinutes: AUTO_SIGNOUT_GRACE_MINUTES(),
        officeNetworkConfigured: isOfficeNetworkConfigured(),
      },
      data: rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Office networks (admin) ─────────────────────────────────────────────────
// GET /api/presence/office-networks
export const listOfficeNetworks = async (req, res) => {
  try {
    const [rows, wifis] = await Promise.all([
      OfficeNetwork.find({
        $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      })
        .sort({ createdAt: 1 })
        .lean(),
      OfficeWifi.find().sort({ createdAt: 1 }).lean(),
    ]);
    const ip = clientIp(req);
    const onServerPc = isLoopbackIp(ip);
    const saved = new Set(rows.map((r) => r.ip));
    res.json({
      success: true,
      // Admin-saved addresses (never expire)
      data: rows.filter((r) => !r.learned),
      // Picked up automatically from phones / PCs on an office Wi-Fi name.
      learned: rows.filter((r) => r.learned),
      wifis,
      wifiFromEnv: getEnvOfficeWifiNames(),
      // Opened on the server PC itself: "this Wi-Fi" = the server's LAN.
      onServerPc,
      serverLan: onServerPc ? serverLanEntries() : [],
      serverLanSaved: onServerPc && serverLanEntries().length > 0 && serverLanEntries().every((e) => saved.has(e)),
      fromEnv: getEnvOfficeEntries(),
      allowPrivateLan: privateLanAllowed(),
      yourIp: ip,
      // Debug help: if "yourIp" is the router/proxy instead of your real
      // address, TRUST_PROXY_HOPS in .env is wrong for this hosting.
      forwardedFor: req.get("x-forwarded-for") || null,
      trustProxyHops: process.env.TRUST_PROXY_HOPS || "1",
      yourEntry: officeEntryForIp(ip),
      youAreOnOfficeNetwork: ipMatchesOffice(ip),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Saves (or updates) one office Wi-Fi name. Returns the document.
const saveOfficeWifi = async ({ ssid, bssid, name, userId }) => {
  const clean = String(ssid || "").trim().slice(0, 64);
  if (!clean) return null;
  const b = normalizeBssid(bssid);
  return OfficeWifi.findOneAndUpdate(
    { ssidKey: clean.toLowerCase() },
    {
      $set: { ssid: clean, enabled: true, ...(name ? { name: String(name).slice(0, 80) } : {}) },
      ...(b ? { $addToSet: { bssids: b } } : {}),
      $setOnInsert: { ssidKey: clean.toLowerCase(), addedBy: userId },
    },
    { upsert: true, new: true },
  );
};

// POST /api/presence/office-wifis  { ssid, bssid?, name?, lockToRouter? }
// Saves an office Wi-Fi by NAME. Works with a dynamic office IP.
export const addOfficeWifi = async (req, res) => {
  try {
    const { ssid, bssid, name, lockToRouter } = req.body || {};
    if (!String(ssid || "").trim()) {
      return res.status(400).json({ success: false, message: "Enter the Wi-Fi name" });
    }
    const doc = await saveOfficeWifi({
      ssid,
      // Only lock to this exact router when asked; otherwise the name is enough.
      bssid: lockToRouter ? bssid : undefined,
      name,
      userId: req.user._id,
    });
    await reloadOfficeNetworks();
    res.json({
      success: true,
      message: `Saved Wi-Fi "${doc.ssid}". Staff phones and PCs on it are signed in automatically.`,
      data: doc,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/presence/office-wifis/:id
export const removeOfficeWifi = async (req, res) => {
  try {
    await OfficeWifi.findByIdAndDelete(req.params.id);
    await reloadOfficeNetworks();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/presence/office-check  (any logged-in user)
// Lets the phone app / website show "you are on the office Wi-Fi" or not.
// Send ?ssid=&bssid= to test a Wi-Fi name.
export const officeCheck = async (req, res) => {
  const wifi = readWifiFromBody(req.query);
  res.json({
    success: true,
    ip: clientIp(req),
    byIp: ipMatchesOffice(clientIp(req)),
    byWifi: wifiMatchesOffice(wifi),
    officeNetworkConfigured: isOfficeNetworkConfigured(),
  });
};

// POST /api/presence/office-networks  { name?, ip?, ssid?, bssid? }
// Without `ip`: saves the network the admin is connected to right now.
// With `ssid`: also saves that Wi-Fi name (recommended — the IP may change).
export const addOfficeNetwork = async (req, res) => {
  try {
    if (req.body?.ssid) {
      await saveOfficeWifi({
        ssid: req.body.ssid,
        bssid: req.body.lockToRouter ? req.body.bssid : undefined,
        name: req.body.name,
        userId: req.user._id,
      });
    }
    const raw = (req.body?.ip || "").trim();
    const ip = clientIp(req);
    let entries;
    if (raw) {
      const parsed = parseOfficeEntries(raw);
      if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
      entries = parsed.entries;
    } else if (isLoopbackIp(ip)) {
      // Opened on the PC that runs the backend: save that PC's Wi-Fi/LAN.
      entries = serverLanEntries();
      if (!entries.length) {
        return res.status(400).json({
          success: false,
          message:
            "This server PC is not connected to any Wi-Fi/LAN network. Connect it to the office Wi-Fi and try again.",
        });
      }
    } else entries = [officeEntryForIp(ip)];

    if (!entries.length) {
      return res.status(400).json({ success: false, message: "Enter an IP address or range" });
    }
    let doc;
    for (const entry of entries) {
      doc = await OfficeNetwork.findOneAndUpdate(
        { ip: entry },
        {
          // An admin saving it makes it permanent (no longer "learned").
          $set: {
            enabled: true,
            learned: false,
            name: (req.body?.name || "Office Wi-Fi").slice(0, 80),
            ...(req.body?.ssid ? { ssid: String(req.body.ssid).trim().slice(0, 64) } : {}),
          },
          $unset: { expiresAt: 1 },
          $setOnInsert: { ip: entry, addedBy: req.user._id },
        },
        { upsert: true, new: true },
      );
    }
    const entry = entries.join(", ");
    await reloadOfficeNetworks();
    res.json({
      success: true,
      message: req.body?.ssid
        ? `Saved Wi-Fi "${String(req.body.ssid).trim()}" and address ${entry}. Devices on it are now signed in automatically.`
        : `Saved ${entry} as an office network. Devices on it are now signed in automatically.`,
      data: doc,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/presence/office-networks/:id
export const removeOfficeNetwork = async (req, res) => {
  try {
    await OfficeNetwork.findByIdAndDelete(req.params.id);
    await reloadOfficeNetworks();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
