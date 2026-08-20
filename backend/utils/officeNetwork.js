// utils/officeNetwork.js
//
// Gates the *silent/automatic* attendance check-in (fired when the app
// loads, not a button the user clicks) to devices on the office network.
// This deliberately does NOT gate the manual "Sign In" button — staff
// working from home/field with approval must still be able to check
// themselves in from anywhere; only the automatic background check-in is
// location-restricted.
//
// Configure via OFFICE_ALLOWED_IPS in .env — a comma-separated list of
// exact IPs and/or CIDR ranges, e.g.:
//   OFFICE_ALLOWED_IPS=203.0.113.5
//   OFFICE_ALLOWED_IPS=203.0.113.5,203.0.113.0/29
//
// IMPORTANT: this must be the office's PUBLIC IP (what a site like
// whatismyip.com shows when visited from an office computer), not the
// 192.168.x.x / 10.x.x.x address `ipconfig`/`ifconfig` shows — that private
// address only exists inside the office LAN and is never visible to a
// backend hosted outside it (Render, Vercel, etc). Every device behind the
// same office router shares one public IP.
//
// Requires `app.set("trust proxy", 1)` in server.js (already set) so
// req.ip reflects the real client IP rather than the proxy's own address.


const parseAllowedList = () =>
  (process.env.OFFICE_ALLOWED_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Some proxies report IPv4 clients as IPv4-mapped IPv6, e.g. "::ffff:203.0.113.5".
const normalizeIp = (ip) => (ip || "").replace(/^::ffff:/, "");

const isIpv4 = (ip) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);

const ipToLong = (ip) =>
  ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) + (parseInt(octet, 10) & 255), 0) >>>
  0;

const ipInCidr = (ip, cidr) => {
  const [range, bitsStr] = cidr.split("/");
  if (!isIpv4(ip) || !isIpv4(range)) return false;
  const bits = bitsStr === undefined ? 32 : parseInt(bitsStr, 10);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
};

/**
 * @param {import("express").Request} req
 * @returns {boolean} true if this request comes from an allowed office IP,
 * or from localhost (always allowed, for local dev/testing).
 */
export const isFromOfficeNetwork = (req) => {
  const ip = normalizeIp(req.ip);

  if (ip === "127.0.0.1" || ip === "::1") return true;

  const allowed = parseAllowedList();
  if (allowed.length === 0) return false; // not configured yet -> deny by default

  return allowed.some((entry) =>
    entry.includes("/") ? ipInCidr(ip, entry) : ip === entry,
  );
};
