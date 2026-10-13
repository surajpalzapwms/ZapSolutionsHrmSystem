import mongoose from "mongoose";

// An office Wi-Fi saved by NAME (SSID), set by an admin from the website's
// "Office Wi-Fi settings" modal or the mobile app's office card.
//
// Why by name: most office internet connections in India get a DYNAMIC
// public IP (it changes every few hours/days), so an IP saved today stops
// matching tomorrow. The Wi-Fi name never changes. The mobile app and the
// Windows PC agent read the Wi-Fi name they are connected to and send it
// with every heartbeat; when it matches, the user is in the office.
//
// Optional BSSIDs (router MAC addresses) make it stricter: when any are
// saved, the device must be on one of those exact routers, not just any
// network with the same name.
const officeWifiSchema = new mongoose.Schema(
  {
    ssid: { type: String, required: true, trim: true, maxlength: 64 },
    // lower-case copy used for matching (Wi-Fi names are matched ignoring case)
    ssidKey: { type: String, required: true, lowercase: true, trim: true },
    bssids: [{ type: String, lowercase: true, trim: true }],
    name: { type: String, trim: true, maxlength: 80 },
    enabled: { type: Boolean, default: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

officeWifiSchema.index({ ssidKey: 1 }, { unique: true });

const OfficeWifi = mongoose.model("OfficeWifi", officeWifiSchema);
export default OfficeWifi;
