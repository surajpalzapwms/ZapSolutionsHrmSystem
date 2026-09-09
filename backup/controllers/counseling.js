import Staff from "../models/Staff.js";
import Counseling from "../models/Counseling.js";

async function staffForRequest(req) {
  const email = req.user?.email?.toLowerCase().trim();
  return email ? Staff.findOne({ email }).lean() : null;
}

// GET /me — the caller's sessions, split into upcoming vs past.
export const getMyCounseling = async (req, res) => {
  try {
    const staff = await staffForRequest(req);
    if (!staff) return res.json({ success: true, upcoming: [], past: [] });
    const sessions = await Counseling.find({ userId: staff._id }).sort({ date: -1 }).lean();
    const now = new Date();
    const upcoming = [];
    const past = [];
    for (const s of sessions) {
      if (s.status === "completed" || s.status === "cancelled" || new Date(s.date) < now) past.push(s);
      else upcoming.push(s);
    }
    upcoming.sort((a, b) => new Date(a.date) - new Date(b.date)); // soonest first
    res.json({ success: true, upcoming, past });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
};

// POST /me — request/schedule a session.
export const scheduleCounseling = async (req, res) => {
  try {
    const staff = await staffForRequest(req);
    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "No staff profile is linked to your account yet. Contact your admin.",
      });
    }
    const { topic, date, time, mode } = req.body;
    if (!topic || !date) {
      return res.status(400).json({ success: false, message: "Topic and date are required" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: "Invalid date. Use YYYY-MM-DD" });
    }
    const validModes = ["video", "in-person", "phone"];
    if (mode && !validModes.includes(mode)) {
      return res.status(400).json({ success: false, message: "Invalid mode." });
    }
    const session = await Counseling.create({
      userId: staff._id,
      topic,
      date: new Date(`${date}T00:00:00.000Z`),
      time: time || "",
      mode: mode || "video",
      status: "requested",
    });
    res.status(201).json({ success: true, message: "Session requested.", data: session });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
};