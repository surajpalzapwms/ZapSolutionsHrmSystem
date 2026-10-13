import mongoose from "mongoose";

// An office network address (Wi-Fi router's public IP / range).
//
//  - Manual entries: saved by an admin ("Save this Wi-Fi as office network"
//    or typed by hand). They never expire.
//  - Learned entries (learned: true): saved AUTOMATICALLY when a phone or
//    PC that is connected to a saved office Wi-Fi NAME checks in from a new
//    public IP. Because the office IP is dynamic, this keeps the website
//    (which can't read the Wi-Fi name) working after the IP changes. They
//    expire on their own (expiresAt, TTL index) once no office device has
//    confirmed them for a while, so old IPs don't pile up.
// See utils/officeNetwork.js.
const officeNetworkSchema = new mongoose.Schema(
  {
    // Exact IP (public office IP) or CIDR range (e.g. "192.168.1.0/24").
    ip: { type: String, required: true, trim: true },
    name: { type: String, trim: true, maxlength: 80 },
    enabled: { type: Boolean, default: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    learned: { type: Boolean, default: false },
    // Wi-Fi name that confirmed a learned IP (shown in the admin screen).
    ssid: { type: String, trim: true },
    lastConfirmedAt: { type: Date },
    // Only set on learned entries; MongoDB deletes the row after this time.
    expiresAt: { type: Date },
  },
  { timestamps: true },
);

officeNetworkSchema.index({ ip: 1 }, { unique: true });
officeNetworkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OfficeNetwork = mongoose.model("OfficeNetwork", officeNetworkSchema);
export default OfficeNetwork;
