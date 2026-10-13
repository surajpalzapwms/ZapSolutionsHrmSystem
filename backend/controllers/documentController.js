// controllers/documentController.js
//
// Staff documents (Aadhaar card, PAN card, light bill) and profile photo.
//
//   Staff (own):  GET/POST /api/documents/me, DELETE /api/documents/me/:type
//   Admin:        GET /api/documents/summary
//                 GET/POST /api/documents/staff/:staffId
//                 DELETE /api/documents/staff/:staffId/:type
//   Files:        GET /api/documents/photo/:staffId?v=&s=   (signed, no login)
//                 GET /api/documents/file/:docId?e=&s=      (signed, expires)
//
// Upload body (JSON): { type, data: <base64 or data: URI>, mimeType, fileName, number }
import mongoose from "mongoose";
import Staff from "../models/Staff.js";
import StaffDocument, { DOCUMENT_LABELS, DOCUMENT_TYPES } from "../models/StaffDocument.js";
import { asyncHandler, ApiError } from "../utils/asyncHandler.js";
import {
  documentUrlFor,
  photoUrlFor,
  verifyDocumentSignature,
  verifyPhotoSignature,
} from "../utils/fileSigning.js";

const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"];
const FILE_TYPES = [...IMAGE_TYPES, "application/pdf"];

const userName = (u) =>
  u?.name || `${u?.firstName || ""} ${u?.lastName || ""}`.trim() || u?.email || "";

const ownStaff = async (req) => {
  const email = req.user?.email?.toLowerCase().trim();
  const staff = email ? await Staff.findOne({ email }) : null;
  if (!staff) {
    throw new ApiError(404, "No staff profile is linked to your account yet. Contact your admin.");
  }
  return staff;
};

const staffById = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(400, "Invalid staff ID");
  const staff = await Staff.findById(id);
  if (!staff) throw new ApiError(404, "Staff member not found");
  return staff;
};

const checkType = (raw) => {
  const type = String(raw || "").toLowerCase();
  if (!DOCUMENT_TYPES.includes(type)) {
    throw new ApiError(400, `Unknown document type. Use one of: ${DOCUMENT_TYPES.join(", ")}`);
  }
  return type;
};

const describe = (doc) => ({
  _id: doc._id,
  type: doc.type,
  label: DOCUMENT_LABELS[doc.type] || doc.type,
  number: doc.number || "",
  fileName: doc.fileName || "",
  mimeType: doc.mimeType,
  isImage: String(doc.mimeType).startsWith("image/"),
  size: doc.size || 0,
  uploadedAt: doc.updatedAt || doc.createdAt,
  uploadedByName: doc.uploadedByName || "",
  url: documentUrlFor(doc),
});

const listFor = async (staff) => {
  const docs = await StaffDocument.find({ staff: staff._id }).lean();
  const byType = new Map(docs.map((d) => [d.type, d]));
  return {
    staffId: staff._id,
    staffName: staff.staffName,
    staffCode: staff.staffId || "",
    photoUrl: photoUrlFor(staff),
    documents: DOCUMENT_TYPES.map((type) => {
      const d = byType.get(type);
      return d
        ? { ...describe(d), uploaded: true }
        : { type, label: DOCUMENT_LABELS[type], uploaded: false };
    }),
  };
};

const saveUpload = async (req, staff) => {
  const type = checkType(req.body?.type);
  let { data, mimeType, fileName, number } = req.body || {};
  if (!data || typeof data !== "string") throw new ApiError(400, "File data is required");

  // Accept "data:image/jpeg;base64,...." as well as plain base64.
  const m = /^data:([^;]+);base64,(.*)$/s.exec(data);
  if (m) {
    mimeType = mimeType || m[1];
    data = m[2];
  }
  mimeType = String(mimeType || "").toLowerCase();
  if (mimeType === "image/jpg") mimeType = "image/jpeg";
  const allowed = type === "photo" ? IMAGE_TYPES : FILE_TYPES;
  if (!allowed.includes(mimeType)) {
    throw new ApiError(
      400,
      type === "photo" ? "Profile photo must be an image (JPG / PNG)." : "Upload a photo (JPG / PNG) or a PDF file.",
    );
  }

  const buffer = Buffer.from(data, "base64");
  if (!buffer.length) throw new ApiError(400, "The file is empty");
  if (buffer.length > MAX_BYTES) throw new ApiError(400, "File is too large (max 8 MB)");

  const cleanNumber = String(number || "").trim().slice(0, 40);
  if (type === "pan" && cleanNumber && !/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/.test(cleanNumber)) {
    throw new ApiError(400, "PAN number should look like ABCDE1234F");
  }
  if (type === "aadhaar" && cleanNumber && !/^\d{12}$/.test(cleanNumber.replace(/\s+/g, ""))) {
    throw new ApiError(400, "Aadhaar number should be 12 digits");
  }

  await StaffDocument.findOneAndUpdate(
    { staff: staff._id, type },
    {
      staff: staff._id,
      type,
      number: type === "pan" ? cleanNumber.toUpperCase() : cleanNumber.replace(/\s+/g, ""),
      fileName: String(fileName || `${type}`).slice(0, 120),
      mimeType,
      size: buffer.length,
      data: buffer,
      uploadedBy: req.user?._id,
      uploadedByName: userName(req.user),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (type === "photo") {
    // updateOne (not save) so an old staff record that fails some newer
    // validation rule can still get a photo.
    staff.photoUpdatedAt = new Date();
    await Staff.updateOne({ _id: staff._id }, { $set: { photoUpdatedAt: staff.photoUpdatedAt } });
  }
  return type;
};

const removeType = async (staff, rawType) => {
  const type = checkType(rawType);
  const removed = await StaffDocument.findOneAndDelete({ staff: staff._id, type });
  if (!removed) throw new ApiError(404, `${DOCUMENT_LABELS[type]} is not uploaded`);
  if (type === "photo") {
    staff.photoUpdatedAt = null;
    await Staff.updateOne({ _id: staff._id }, { $set: { photoUpdatedAt: null } });
  }
  return type;
};

// ── Staff: own documents ──────────────────────────────────────────────────
export const getMyDocuments = asyncHandler(async (req, res) => {
  const staff = await ownStaff(req);
  res.json({ success: true, data: await listFor(staff) });
});

export const uploadMyDocument = asyncHandler(async (req, res) => {
  const staff = await ownStaff(req);
  const type = await saveUpload(req, staff);
  res.status(201).json({
    success: true,
    message: `${DOCUMENT_LABELS[type]} uploaded`,
    data: await listFor(staff),
  });
});

export const deleteMyDocument = asyncHandler(async (req, res) => {
  const staff = await ownStaff(req);
  const type = await removeType(staff, req.params.type);
  res.json({ success: true, message: `${DOCUMENT_LABELS[type]} removed`, data: await listFor(staff) });
});

// ── Admin / super admin ──────────────────────────────────────────────────
export const getStaffDocuments = asyncHandler(async (req, res) => {
  const staff = await staffById(req.params.staffId);
  res.json({ success: true, data: await listFor(staff) });
});

export const uploadStaffDocument = asyncHandler(async (req, res) => {
  const staff = await staffById(req.params.staffId);
  const type = await saveUpload(req, staff);
  res.status(201).json({
    success: true,
    message: `${DOCUMENT_LABELS[type]} uploaded for ${staff.staffName}`,
    data: await listFor(staff),
  });
});

export const deleteStaffDocument = asyncHandler(async (req, res) => {
  const staff = await staffById(req.params.staffId);
  const type = await removeType(staff, req.params.type);
  res.json({ success: true, message: `${DOCUMENT_LABELS[type]} removed`, data: await listFor(staff) });
});

// Every staff member with which documents they have uploaded.
export const getDocumentSummary = asyncHandler(async (req, res) => {
  const [staff, docs] = await Promise.all([
    Staff.find({}).select("staffName staffId status relievingDate photoUpdatedAt enabled").sort({ staffName: 1 }).lean(),
    StaffDocument.find({}).select("staff type updatedAt").lean(),
  ]);
  const byStaff = new Map();
  docs.forEach((d) => {
    const k = String(d.staff);
    if (!byStaff.has(k)) byStaff.set(k, []);
    byStaff.get(k).push(d.type);
  });
  const required = DOCUMENT_TYPES.filter((t) => t !== "photo");
  res.json({
    success: true,
    data: staff.map((s) => {
      const types = byStaff.get(String(s._id)) || [];
      return {
        staffId: s._id,
        staffName: s.staffName,
        staffCode: s.staffId || "",
        status: s.status,
        photoUrl: photoUrlFor(s),
        uploaded: types,
        missing: required.filter((t) => !types.includes(t)),
      };
    }),
  });
});

// ── Signed file links (no login header needed) ───────────────────────────
// Stored file bytes as a real Node Buffer. Read with .lean(), MongoDB hands
// the `data` field back as a BSON Binary — its `.length` is a FUNCTION, not
// a number, so "Content-Length" became the function's text and Node threw
// ERR_INVALID_CHAR ("Invalid character in header content") on every photo /
// document link. That is why photos showed as initials everywhere.
const toBuffer = (data) => {
  if (!data) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (data._bsontype === "Binary" || (data.buffer && typeof data.position === "number")) {
    const bytes = data.buffer;
    return Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, data.position ?? bytes.length);
  }
  if (data.buffer instanceof ArrayBuffer || ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset || 0, data.byteLength);
  if (Array.isArray(data.data)) return Buffer.from(data.data); // { type: "Buffer", data: [...] }
  return Buffer.from(data);
};

const sendFile = (res, doc, inline = true) => {
  const body = toBuffer(doc.data);
  res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
  res.setHeader("Content-Length", body.length);
  // Website and app are on another origin — let them embed the image.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  const name = String(doc.fileName || doc.type).replace(/[^\w.-]+/g, "_");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${name}"`);
  res.end(body);
};

export const getPhotoFile = asyncHandler(async (req, res) => {
  const { staffId } = req.params;
  const { v, s } = req.query;
  if (!mongoose.Types.ObjectId.isValid(staffId) || !verifyPhotoSignature(staffId, v, s)) {
    throw new ApiError(403, "Invalid photo link");
  }
  const doc = await StaffDocument.findOne({ staff: staffId, type: "photo" }).select("+data").lean();
  if (!doc) throw new ApiError(404, "No photo");
  // The URL changes whenever the photo changes, so it can be cached for long.
  res.setHeader("Cache-Control", "private, max-age=2592000, immutable");
  sendFile(res, doc);
});

export const getDocumentFile = asyncHandler(async (req, res) => {
  const { docId } = req.params;
  const { e, s, download } = req.query;
  if (!mongoose.Types.ObjectId.isValid(docId) || !verifyDocumentSignature(docId, e, s)) {
    throw new ApiError(403, "This link has expired. Open the document again from the app.");
  }
  const doc = await StaffDocument.findById(docId).select("+data").lean();
  if (!doc) throw new ApiError(404, "Document not found");
  res.setHeader("Cache-Control", "private, no-store");
  sendFile(res, doc, download !== "1");
});