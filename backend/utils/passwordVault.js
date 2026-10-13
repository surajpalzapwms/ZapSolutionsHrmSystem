// utils/passwordVault.js
//
// Reversible (AES-256-GCM) storage for the password an admin typed when
// creating/resetting a staff login, so it can be shown again in the staff
// History view. The bcrypt hash is still what login checks — this copy is
// ONLY for admin display.
//
// Key: PASSWORD_VIEW_KEY (falls back to JWT_SECRET). If the key was ever
// changed, put the old value(s) in PASSWORD_VIEW_KEY_OLD (comma-separated)
// so passwords saved under the old key can still be read.
import crypto from "crypto";

const toKey = (secret) => crypto.createHash("sha256").update(secret).digest();

// Key used for new encryptions.
const getKey = () => {
  const secret = process.env.PASSWORD_VIEW_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error("PASSWORD_VIEW_KEY or JWT_SECRET must be set");
  return toKey(secret);
};

// Every key a stored password might have been encrypted with: the current
// one, JWT_SECRET (the fallback used before PASSWORD_VIEW_KEY was set), and
// any old keys listed in PASSWORD_VIEW_KEY_OLD.
const getReadKeys = () => {
  const secrets = [
    process.env.PASSWORD_VIEW_KEY,
    process.env.JWT_SECRET,
    ...(process.env.PASSWORD_VIEW_KEY_OLD || "").split(","),
  ]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  return [...new Set(secrets)].map(toKey);
};

export const encryptPassword = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(":");
};

export const decryptPassword = (payload) => {
  if (!payload) return null;
  const parts = String(payload).split(":");
  if (parts.length !== 3) return null;
  const [iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64"));
  for (const key of getReadKeys()) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    } catch {
      /* wrong key — try the next one */
    }
  }
  return null; // none of the keys fit, or the data is corrupted
};
