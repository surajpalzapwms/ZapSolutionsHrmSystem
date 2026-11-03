/**
 * Check MR advances that are "adjusted" although the payroll for their month
 * has not been made (bug fixed 3 Nov 2026: any payroll used to take ALL
 * pending advances, even ones given after its month).
 *
 *   node scripts/checkAdvanceStatus.js           # report only (changes nothing)
 *   node scripts/checkAdvanceStatus.js --apply   # set ORPHAN advances back to "pending"
 *
 * Two kinds of problems are reported:
 *  1. ORPHAN  - "adjusted" but no payroll lists it. Nothing was deducted, so
 *               --apply safely puts it back to "pending".
 *  2. WRONG MONTH - deducted by a payroll of an EARLIER month (e.g. a 30 Oct
 *               advance taken by the September payroll). The money WAS cut from
 *               that salary, so this script does not touch it. To correct it:
 *               delete that payroll in the app (this puts its advances back to
 *               "pending" and restores the account balance) and generate it
 *               again - the fixed code then takes only that month's advances.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import MrAdvance from "../models/Hrm/MrAdvance.js";
import Payroll from "../models/Hrm/Payroll.js";
import "../models/staffMember/staff.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

const periodEnd = (period) => {
  const [y, m] = String(period).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
};
const day = (d) => new Date(d).toISOString().slice(0, 10);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const adjusted = await MrAdvance.find({ status: "adjusted" })
    .populate("employeeId", "medicalRepName name")
    .lean();

  const payrolls = await Payroll.find({ "advances.0": { $exists: true } })
    .select("payrollCode period advances employeeId")
    .lean();
  const takenBy = new Map(); // advanceId -> payroll
  payrolls.forEach((p) =>
    (p.advances || []).forEach((a) => takenBy.set(String(a.advanceId), p))
  );

  const orphans = [];
  const wrongMonth = [];
  for (const adv of adjusted) {
    const p = takenBy.get(String(adv._id));
    const who = adv.employeeId?.medicalRepName || adv.employeeId?.name || adv.employeeId?._id;
    const line = `${who} | ${day(adv.date)} | $${Number(adv.amount).toFixed(2)} | ${adv.remarks || "-"}`;
    if (!p) orphans.push({ adv, line });
    else if (new Date(adv.date) > periodEnd(p.period)) {
      wrongMonth.push(`${line}  ->  taken by ${p.payrollCode} (period ${p.period})`);
    }
  }

  console.log(`\nAdjusted advances: ${adjusted.length}`);
  console.log(`\n1) ORPHAN (adjusted, no payroll) : ${orphans.length}`);
  orphans.forEach((o) => console.log("   " + o.line));
  console.log(`\n2) WRONG MONTH (taken by an earlier month's payroll) : ${wrongMonth.length}`);
  wrongMonth.forEach((l) => console.log("   " + l));

  if (APPLY && orphans.length) {
    const res = await MrAdvance.updateMany(
      { _id: { $in: orphans.map((o) => o.adv._id) }, status: "adjusted" },
      { $set: { status: "pending" } }
    );
    console.log(`\n--apply: ${res.modifiedCount} orphan advance(s) set back to "pending".`);
  } else if (orphans.length) {
    console.log(`\nRun with --apply to set the ORPHAN advances back to "pending".`);
  }
  if (wrongMonth.length) {
    console.log(
      `\nWRONG MONTH: delete those payrolls in the app and generate them again (not changed by this script).`
    );
  }

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
