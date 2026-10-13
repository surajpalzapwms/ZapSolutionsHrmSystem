// utils/officeNetwork.js
//
// Decides whether a request comes from the OFFICE network (the office Wi-Fi
// router). Used by automatic attendance (services/presence.js) and the
// auto check-in on login. The manual "Sign In" button is NOT gated by this.
//
// Office networks come from TWO places (either one is enough):
//
//  1. The admin screen (recommended) — an admin connected to the office
//     Wi-Fi presses "Set this Wi-Fi as office network" on the website or in
//     the app. The IP the server sees is saved in the database
//     (OfficeNetwork model). No .env editing or server restart needed.
//
//  2. OFFICE_ALLOWED_IPS in .env — comma-separated exact IPs and/or CIDR
//     ranges, e.g. OFFICE_ALLOWED_IPS=203.0.113.5,203.0.113.0/29
//
// Which IP is that?
//  - Backend hosted on the internet (Render, VPS, ...): every device behind
//    the office router shows up with the office's PUBLIC IP. That's what
//    gets saved.
//  - Backend running on a PC inside the office: devices show up with their
//    LAN address (192.168.x.x). Saving one such address saves its whole /24
//    LAN range automatically, or set OFFICE_ALLOW_PRIVATE_LAN=true to treat
//    every private-LAN device as "in office".
//
// Needs `trust proxy` to match your hosting (TRUST_PROXY_HOPS in .env, see
// server.js) so req.ip is the real client IP rather than the proxy's.

import os from "os";
import OfficeNetwork from "../models/OfficeNetwork.js";
import OfficeWifi from "../models/OfficeWifi.js";

const normalizeIp = (ip) => (ip || "").replace(/^::ffff:/, "").trim();

const isIpv4 = (ip) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);

const ipToLong = (ip) =>
  ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) + (parseInt(octet, 10) & 255), 0) >>>
  0;

export const ipInCidr = (ip, cidr) => {
  const [range, bitsStr] = cidr.split("/");
  if (!isIpv4(ip) || !isIpv4(range)) return false;
  const bits = bitsStr === undefined ? 32 : parseInt(bitsStr, 10);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
};

// ── IPv6 ─────────────────────────────────────────────────────────────────
// Many Indian ISPs (Airtel, Jio) give every device a public IPv6 address
// that CHANGES every few hours ("temporary" addresses), but all devices
// behind one router share the same first 64 bits (the "/64 prefix"). So an
// office IPv6 network is stored and matched as that /64 prefix.
const isIpv6 = (ip) => ip.includes(":");

/** "2401:4900:88b1:ac1e::1f9" -> 8 groups as numbers, or null. */
const expandIpv6 = (raw) => {
  let ip = String(raw).split("%")[0].toLowerCase(); // drop zone id
  if (!isIpv6(ip)) return null;
  // embedded IPv4 tail (::ffff:1.2.3.4)
  const v4 = ip.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipToLong(v4[1]);
    ip = ip.replace(v4[1], `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  if (ip.includes("::")) {
    const fill = 8 - h.length - t.length;
    if (fill < 0) return null;
    const groups = [...h, ...Array(fill).fill("0"), ...t];
    return groups.map((g) => parseInt(g || "0", 16));
  }
  if (h.length !== 8) return null;
  return h.map((g) => parseInt(g || "0", 16));
};

const ipv6InCidr = (ip, cidr) => {
  const [range, bitsStr] = cidr.split("/");
  const a = expandIpv6(ip);
  const b = expandIpv6(range);
  if (!a || !b || a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  let bits = bitsStr === undefined ? 128 : parseInt(bitsStr, 10);
  if (Number.isNaN(bits) || bits < 0 || bits > 128) return false;
  for (let i = 0; i < 8 && bits > 0; i++) {
    const take = Math.min(16, bits);
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if ((a[i] & mask) !== (b[i] & mask)) return false;
    bits -= take;
  }
  return true;
};

const ipv6Prefix64 = (ip) => {
  const g = expandIpv6(ip);
  if (!g) return ip;
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
};

const PRIVATE_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
export const isPrivateIp = (raw) => {
  const ip = normalizeIp(raw);
  if (isIpv6(ip)) return ipv6InCidr(ip, "fc00::/7") || ipv6InCidr(ip, "fe80::/10");
  return PRIVATE_RANGES.some((r) => ipInCidr(ip, r));
};

/** Does `ip` match one saved entry (exact IP or CIDR range, v4 or v6)? */
const matchesEntry = (ip, entry) => {
  if (isIpv6(entry) || isIpv6(ip)) {
    if (isIpv6(entry) !== isIpv6(ip)) return false;
    return entry.includes("/") ? ipv6InCidr(ip, entry) : ipv6InCidr(ip, `${entry}/128`);
  }
  return entry.includes("/") ? ipInCidr(ip, entry) : ip === entry;
};

/**
 * What to store when an admin says "this is the office network":
 * a private LAN address becomes its /24 range (all devices on that router),
 * a public address is stored as-is (the whole office shares it).
 */
export const officeEntryForIp = (rawIp) => {
  const ip = normalizeIp(rawIp);
  if (isIpv4(ip) && isPrivateIp(ip)) {
    return ip.split(".").slice(0, 3).join(".") + ".0/24";
  }
  // IPv6: the whole office network (/64), not the device's changing address.
  if (isIpv6(ip)) return ipv6Prefix64(ip);
  return ip;
};

export const isLoopbackIp = (rawIp) => {
  const ip = normalizeIp(rawIp);
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
};

// Virtual adapters (VirtualBox, VMware, Hyper-V/WSL, Docker) are not the
// office Wi-Fi — skip them.
const VIRTUAL_ADAPTER = /virtual|vmware|vbox|vethernet|wsl|docker|br-|veth|loopback|hyper-v|tailscale|zerotier/i;

/**
 * LAN ranges of the machine the backend runs on, e.g. ["192.168.1.0/24"].
 * Used when the admin opens the site on the server PC itself (localhost):
 * "this Wi-Fi" then means the network that PC is connected to.
 */
export const serverLanEntries = () => {
  const out = new Set();
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (VIRTUAL_ADAPTER.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family !== "IPv4" && a.family !== 4) continue;
      if (a.internal || !isPrivateIp(a.address)) continue;
      out.add(officeEntryForIp(a.address));
    }
  }
  return [...out];
};

/**
 * Is `entry` a usable office address: an IPv4 / IPv6 address, or a CIDR range
 * ("192.168.1.0/24", "2401:4900:88b1:ac1e::/64")?
 */
export const isValidOfficeEntry = (entry) => {
  const [range, bits, extra] = String(entry || "").trim().split("/");
  if (extra !== undefined || !range) return false;
  if (bits !== undefined && !/^\d{1,3}$/.test(bits)) return false;
  if (isIpv4(range)) {
    if (!range.split(".").every((o) => Number(o) <= 255)) return false;
    return bits === undefined || Number(bits) <= 32;
  }
  if (isIpv6(range)) {
    if (range.split("::").length > 2) return false;
    const g = expandIpv6(range);
    if (!g || g.some(Number.isNaN)) return false;
    return bits === undefined || Number(bits) <= 128;
  }
  return false;
};

/**
 * Turns what a person typed (comma / space / newline separated, or an array)
 * into a de-duplicated list of entries. Returns { entries } or { error }.
 */
export const parseOfficeEntries = (input) => {
  const list = Array.isArray(input) ? input : String(input ?? "").split(/[\s,;]+/);
  const entries = [];
  for (const raw of list) {
    const e = normalizeIp(String(raw ?? "")).toLowerCase();
    if (!e) continue;
    if (!isValidOfficeEntry(e)) return { error: `Not a valid IP / range: ${raw}` };
    if (!entries.includes(e)) entries.push(e);
  }
  if (entries.length > 20) return { error: "At most 20 office addresses" };
  return { entries };
};

// ── In-memory cache of the DB entries ────────────────────────────────────
let dbEntries = []; // ["1.2.3.4", "2401:...::/64", ...]
let dbWifis = []; // [{ ssidKey: "zap-office", bssids: ["aa:bb:..."] }]
let lastLoad = 0;
let loading = null;
const CACHE_MS = 60 * 1000;

export const reloadOfficeNetworks = async () => {
  try {
    const now = new Date();
    const [rows, wifis] = await Promise.all([
      OfficeNetwork.find({
        enabled: { $ne: false },
        $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
      })
        .select("ip")
        .lean(),
      OfficeWifi.find({ enabled: { $ne: false } }).select("ssidKey bssids").lean(),
    ]);
    dbEntries = rows.map((r) => r.ip).filter(Boolean);
    dbWifis = wifis.map((w) => ({ ssidKey: w.ssidKey, bssids: (w.bssids || []).filter(Boolean) }));
    lastLoad = Date.now();
  } catch {
    // keep the last known list
  }
  return dbEntries;
};

const refreshInBackground = () => {
  if (loading || Date.now() - lastLoad < CACHE_MS) return;
  loading = reloadOfficeNetworks().finally(() => {
    loading = null;
  });
};

export const getEnvOfficeEntries = () =>
  (process.env.OFFICE_ALLOWED_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Wi-Fi names from .env, e.g. OFFICE_WIFI_NAMES=ZAP-Office,ZAP-Office-5G */
export const getEnvOfficeWifiNames = () =>
  (process.env.OFFICE_WIFI_NAMES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const privateLanAllowed = () => process.env.OFFICE_ALLOW_PRIVATE_LAN === "true";

export const getOfficeEntries = () => [...getEnvOfficeEntries(), ...dbEntries];
export const getOfficeWifis = () => [
  ...getEnvOfficeWifiNames().map((n) => ({ ssidKey: n.toLowerCase(), bssids: [] })),
  ...dbWifis,
];
export const isOfficeNetworkConfigured = () =>
  getOfficeEntries().length > 0 || getOfficeWifis().length > 0 || privateLanAllowed();

export const getClientIp = (req) => normalizeIp(req.ip);

export const ipMatchesOffice = (rawIp) => {
  const ip = normalizeIp(rawIp);
  if (isLoopbackIp(ip)) return true; // the server PC itself
  if (privateLanAllowed() && isPrivateIp(ip)) return true;
  return getOfficeEntries().some((entry) => matchesEntry(ip, entry));
};

// ── Wi-Fi name (SSID) / router (BSSID) ───────────────────────────────────
const cleanSsid = (s) =>
  String(s ?? "")
    .replace(/^"|"$/g, "")
    .trim()
    .slice(0, 64);

/** "AA-BB-CC-DD-EE-FF" / "aa:bb:cc:dd:ee:ff" -> "aa:bb:cc:dd:ee:ff", or "" */
export const normalizeBssid = (b) => {
  const hex = String(b ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12 || /^0+$/.test(hex)) return "";
  return hex.match(/.{2}/g).join(":");
};

/** Turns whatever the device sent into { ssid, bssid } (either may be ""). */
export const readWifiFromBody = (body) => {
  const w = body?.wifi && typeof body.wifi === "object" ? body.wifi : body || {};
  const ssid = cleanSsid(w.ssid);
  const bad = !ssid || /^<unknown ssid>$/i.test(ssid);
  return { ssid: bad ? "" : ssid, bssid: normalizeBssid(w.bssid) };
};

/**
 * Is the device on a saved office Wi-Fi?
 *  - Wi-Fi saved WITHOUT router addresses: the name is enough.
 *  - Wi-Fi saved WITH router addresses (BSSIDs): the router must match too.
 */
export const wifiMatchesOffice = ({ ssid, bssid } = {}) => {
  const key = cleanSsid(ssid).toLowerCase();
  if (!key) return false;
  return getOfficeWifis().some((w) => {
    if (w.ssidKey !== key) return false;
    if (!w.bssids?.length) return true;
    return !!bssid && w.bssids.includes(normalizeBssid(bssid));
  });
};

// How long a learned office IP stays valid without a new confirmation.
const LEARNED_IP_HOURS = () => {
  const n = parseInt(process.env.OFFICE_LEARNED_IP_HOURS, 10);
  return Number.isFinite(n) && n > 0 ? n : 24;
};
const learnThrottle = new Map(); // entry -> last write time (ms)

/**
 * A phone / PC proved it is on the office Wi-Fi (by name) and came from
 * `rawIp`. Remember that IP as an office address for a while, so browsers
 * on the same Wi-Fi (which can't read the Wi-Fi name) are recognised too —
 * even after the ISP changes the office IP.
 */
export const learnOfficeIp = async (rawIp, ssid) => {
  const ip = normalizeIp(rawIp);
  if (!ip || isLoopbackIp(ip)) return;
  // A private address only says "same LAN as the server"; nothing to learn.
  if (isPrivateIp(ip)) return;
  const entry = officeEntryForIp(ip);
  const last = learnThrottle.get(entry) || 0;
  if (Date.now() - last < 10 * 60 * 1000) return; // at most every 10 min per IP
  learnThrottle.set(entry, Date.now());
  try {
    const existing = await OfficeNetwork.findOne({ ip: entry });
    if (existing && !existing.learned) return; // saved by an admin — keep as is
    const now = new Date();
    await OfficeNetwork.findOneAndUpdate(
      { ip: entry },
      {
        $set: {
          enabled: true,
          learned: true,
          ssid: cleanSsid(ssid) || undefined,
          name: `Auto (Wi-Fi ${cleanSsid(ssid) || "office"})`,
          lastConfirmedAt: now,
          expiresAt: new Date(now.getTime() + LEARNED_IP_HOURS() * 3600000),
        },
        $setOnInsert: { ip: entry },
      },
      { upsert: true, new: true },
    );
    if (!existing) await reloadOfficeNetworks();
  } catch (err) {
    console.error("Could not learn office IP", entry, err.message);
  }
};

/**
 * @param {import("express").Request} req
 * @returns {boolean} true if this request comes from the office network
 */
export const isFromOfficeNetwork = (req) => {
  refreshInBackground();
  return ipMatchesOffice(req.ip);
};

/**
 * Full office check for a presence heartbeat: by network address OR by the
 * Wi-Fi name the device reported. Learns the IP when matched by Wi-Fi.
 * @returns {{ inOffice: boolean, via: "ip"|"wifi"|null, wifi: {ssid:string, bssid:string} }}
 */
export const detectOffice = (req) => {
  refreshInBackground();
  const wifi = readWifiFromBody(req.body);
  const byIp = ipMatchesOffice(req.ip);
  const byWifi = wifiMatchesOffice(wifi);
  if (byWifi) learnOfficeIp(req.ip, wifi.ssid); // background, never blocks
  return { inOffice: byIp || byWifi, via: byWifi ? "wifi" : byIp ? "ip" : null, wifi };
};
