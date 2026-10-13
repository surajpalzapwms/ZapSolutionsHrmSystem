// utils/fileSigning.js
//
// Signed links for staff photos and documents, so the mobile app's <Image>
// and the website's <img>/"Open" link can load them without sending the
// login token in a header.
//
//   Photo    — /api/documents/photo/:staffId?v=<version>&s=<signature>
//              Never expires; a new photo gets a new version (and URL), so
//              phones can cache it safely.
//   Document — /api/documents/file/:docId?e=<expiry>&s=<signature>
//              Aadhaar / PAN / light bill: the link stops working after
//              DOC_LINK_TTL_SECONDS (2 hours).
import crypto from "crypto";

const DOC_LINK_TTL_SECONDS = 2 * 60 * 60;

const secret = () => `${process.env.JWT_SECRET || ""}::staff-files`;

const sign = (value) =>
  crypto.createHmac("sha256", secret()).update(value).digest("base64url").slice(0, 32);

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Relative URL of a staff member's profile photo, or null if none. */
export const photoUrlFor = (staff) => {
  if (!staff?._id || !staff.photoUpdatedAt) return null;
  const id = String(staff._id);
  const v = new Date(staff.photoUpdatedAt).getTime();
  return `/api/documents/photo/${id}?v=${v}&s=${sign(`photo:${id}:${v}`)}`;
};

export const verifyPhotoSignature = (staffId, v, s) =>
  safeEqual(s, sign(`photo:${staffId}:${v}`));

/** Relative, short-lived URL of one uploaded document. */
export const documentUrlFor = (doc) => {
  if (!doc?._id) return null;
  const id = String(doc._id);
  const e = Math.floor(Date.now() / 1000) + DOC_LINK_TTL_SECONDS;
  return `/api/documents/file/${id}?e=${e}&s=${sign(`doc:${id}:${e}`)}`;
};

export const verifyDocumentSignature = (docId, e, s) => {
  const exp = Number(e);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  return safeEqual(s, sign(`doc:${docId}:${exp}`));
};

/** Adds `photoUrl` to a plain staff object (or each one in an array). */
export const withPhotoUrl = (staff) => {
  if (Array.isArray(staff)) return staff.map(withPhotoUrl);
  if (!staff) return staff;
  return { ...staff, photoUrl: photoUrlFor(staff) };
};
