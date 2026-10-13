// models/StaffDocument.js
//
// Files a staff member (or an admin on their behalf) uploads:
//   photo            — profile photo (shown on Home, birthdays, staff list)
//   aadhaar          — Aadhaar card
//   pan              — PAN card
//   electricity_bill — light bill (address proof)
//
// One record per staff member per type — uploading again replaces it.
// The file itself is stored in MongoDB (`data`, max ~8 MB) so no extra
// cloud storage account is needed. `data` is never selected by default:
// lists only return the metadata, the bytes are streamed by
// GET /api/documents/file/:id (see controllers/documentController.js).
import mongoose from "mongoose";

export const DOCUMENT_TYPES = ["photo", "aadhaar", "pan", "electricity_bill"];

export const DOCUMENT_LABELS = {
  photo: "Profile Photo",
  aadhaar: "Aadhaar Card",
  pan: "PAN Card",
  electricity_bill: "Light Bill",
};

const staffDocumentSchema = new mongoose.Schema(
  {
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true },
    type: { type: String, enum: DOCUMENT_TYPES, required: true },
    // Optional number typed in by the user (Aadhaar / PAN number).
    number: { type: String, trim: true, default: "" },
    fileName: { type: String, trim: true, default: "" },
    mimeType: { type: String, required: true },
    size: { type: Number, default: 0 },
    data: { type: Buffer, required: true, select: false },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadedByName: { type: String, default: "" },
  },
  { timestamps: true },
);

staffDocumentSchema.index({ staff: 1, type: 1 }, { unique: true });

export default mongoose.model("StaffDocument", staffDocumentSchema);
