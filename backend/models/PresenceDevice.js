import mongoose from "mongoose";

// One row per device that reports office presence for a user: the mobile
// app, a browser with the website open, or a Windows PC running the HRM
// presence agent. See services/presence.js.
const presenceDeviceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Stable id generated on the device (phone/browser) or by the server
    // (PC agent installer). Unique per user.
    deviceId: {
      type: String,
      required: true,
    },
    platform: {
      type: String,
      enum: ["pc", "android", "ios", "web", "other"],
      default: "other",
    },
    name: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    // PC agents authenticate with a long-lived device token instead of a
    // login JWT (which expires). Only the SHA-256 hash is stored.
    tokenHash: {
      type: String,
      index: true,
      sparse: true,
    },
    revoked: {
      type: Boolean,
      default: false,
    },
    lastSeenAt: { type: Date },
    lastIp: { type: String },
    lastEvent: { type: String },
    // Was the last check-in from the office network?
    inOffice: { type: Boolean, default: false },
    lastInOfficeAt: { type: Date },
  },
  { timestamps: true },
);

presenceDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

const PresenceDevice = mongoose.model("PresenceDevice", presenceDeviceSchema);
export default PresenceDevice;
