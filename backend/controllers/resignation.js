import Staff from "../models/Staff.js";
import Resignation from "../models/Resignation.js";
import mongoose from "mongoose";
import { relievingLetterDate } from "../utils/letterFields.js";

// Strict "YYYY-MM-DD" check that also rejects impossible dates like 2026-02-31.
const isRealYMD = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

// A last working day in the PAST is allowed (e.g. the staff member already
// left on 10 Sep and the resignation is being recorded now). Only a typo-sized
// window is blocked: nothing older than this many days.
const MAX_BACKDATE_DAYS = 365;
const ymdDaysAgo = (days) =>
  new Date(Date.now() - days * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

async function staffForRequest(req) {
  const email = req.user?.email?.toLowerCase().trim();
  return email ? Staff.findOne({ email }).lean() : null;
}

// GET /me — the caller's current (non-withdrawn) resignation, if any.
export const getMyResignation = async (req, res) => {
  try {
    const staff = await staffForRequest(req);
    if (!staff) return res.json({ success: true, data: null });
    const resignation = await Resignation.findOne({
      userId: staff._id,
      status: { $ne: "withdrawn" },
    })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: resignation || null });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
};

// POST /me — submit a resignation. Blocks a second active one.
export const submitResignation = async (req, res) => {
  try {
    const staff = await staffForRequest(req);
    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "No staff profile is linked to your account yet. Contact your admin.",
      });
    }
    const { lastWorkingDay, reason, noticePeriodDays } = req.body;
    if (!lastWorkingDay || !reason) {
      return res.status(400).json({ success: false, message: "Last working day and reason are required" });
    }
    if (!isRealYMD(lastWorkingDay)) {
      return res.status(400).json({ success: false, message: "Invalid date. Use YYYY-MM-DD" });
    }
    if (lastWorkingDay < ymdDaysAgo(MAX_BACKDATE_DAYS)) {
      return res.status(400).json({
        success: false,
        message: `Last working day can't be more than ${MAX_BACKDATE_DAYS} days in the past`,
      });
    }
    const active = await Resignation.findOne({
      userId: staff._id,
      status: { $in: ["pending", "approved"] },
    });
    if (active) {
      return res.status(400).json({ success: false, message: "You already have an active resignation request." });
    }
    const resignation = await Resignation.create({
      userId: staff._id,
      lastWorkingDay: new Date(`${lastWorkingDay}T00:00:00.000Z`),
      reason,
      noticePeriodDays: Number(noticePeriodDays) || 60,
      status: "pending",
    });
    res.status(201).json({ success: true, message: "Resignation submitted.", data: resignation });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
};

// DELETE /me — withdraw the caller's pending resignation.
export const withdrawResignation = async (req, res) => {
  try {
    const staff = await staffForRequest(req);
    if (!staff) return res.status(404).json({ success: false, message: "No staff profile linked." });
    const resignation = await Resignation.findOne({ userId: staff._id, status: "pending" }).sort({ createdAt: -1 });
    if (!resignation) {
      return res.status(404).json({ success: false, message: "No pending resignation to withdraw." });
    }
    resignation.status = "withdrawn";
    await resignation.save();
    res.json({ success: true, message: "Resignation withdrawn.", data: resignation });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
};

// ── Admin ────────────────────────────────────────────────────────────────

// GET /all — admin: every staff member's resignation requests, any status.
// Supports ?status=pending to filter. This is what the website's
// "Resignations" admin page reads — including requests submitted from the
// mobile app, since both write to the same Resignation collection.
export const getAllResignations = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const resignations = await Resignation.find(filter)
      .sort({ createdAt: -1 })
      .populate("userId", "staffName email staffId")
      .lean();
    res.json({ success: true, data: resignations });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
};

// PUT /:id/approve — admin approves a pending resignation.
export const approveResignation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid resignation ID" });
    }
    const resignation = await Resignation.findById(id);
    if (!resignation) {
      return res.status(404).json({ success: false, message: "Resignation request not found" });
    }
    if (resignation.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `This request is already ${resignation.status}`,
      });
    }
    // The admin may move the last working day while approving.
    const override = req.body?.lastWorkingDay;
    if (override) {
      if (!isRealYMD(override)) {
        return res.status(400).json({ success: false, message: "Invalid date. Use YYYY-MM-DD" });
      }
      resignation.lastWorkingDay = new Date(`${override}T00:00:00.000Z`);
    }
    resignation.status = "approved";
    await resignation.save();

    // The staff member's Relieved date = the LAST WORKING DAY they asked for
    // (not the day the request was approved). Until that day they are on
    // notice period and keep working normally; from the day after, the app
    // treats them as having left the organization.
    await Staff.updateOne(
      { _id: resignation.userId },
      { $set: { status: "Relieved", relievingDate: resignation.lastWorkingDay } },
    );

    // A Leaving / Experience letter generated earlier carries the last
    // working day HR picked then — move it to the date just approved so the
    // letter always shows the resignation's last working day.
    const lwd = new Date(resignation.lastWorkingDay.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const staffDoc = await Staff.findById(resignation.userId).select("issuedLetters");
    if (staffDoc?.issuedLetters?.length) {
      let changed = false;
      staffDoc.issuedLetters.forEach((l) => {
        if (!["leaving", "experience"].includes(l.type) || !l.details) return;
        const auto = (d) => relievingLetterDate(d);
        const autoDated = !l.details.letterDate || l.details.letterDate === auto(l.details.lastWorkingDay);
        l.details = { ...l.details, lastWorkingDay: lwd, ...(autoDated ? { letterDate: auto(lwd) } : {}) };
        changed = true;
      });
      if (changed) {
        staffDoc.markModified("issuedLetters");
        await staffDoc.save().catch(() => {});
      }
    }

    res.json({ success: true, message: "Resignation approved", data: resignation });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
};

// PUT /:id/reject — admin rejects a pending resignation.
export const rejectResignation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid resignation ID" });
    }
    const resignation = await Resignation.findById(id);
    if (!resignation) {
      return res.status(404).json({ success: false, message: "Resignation request not found" });
    }
    if (resignation.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `This request is already ${resignation.status}`,
      });
    }
    resignation.status = "rejected";
    if (req.body?.remarks) {
      resignation.reason = `${resignation.reason} [Admin: ${req.body.remarks}]`;
    }
    await resignation.save();
    res.json({ success: true, message: "Resignation rejected", data: resignation });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
};