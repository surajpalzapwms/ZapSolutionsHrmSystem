import Payroll from "../models/Payroll.js";
import Staff from "../models/Staff.js";
import StaffBasicPayroll from "../models/StaffBasicPayroll.js";
import StaffAdvance from "../models/StaffAdvance.js";
import Account from "../models/Account.js";
import Leave from "../models/Leave.js";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";
import { isAdminRole } from "../config/permissions.js";

// Helper functions
const toFixedAmount = (value) => {
  const num = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(num)) return 0;
  return Math.round(num * 100) / 100;
};

const toExactAmount = (value) => {
  const num = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(num)) return 0;
  return num;
};

const generatePayrollCode = async () => {
  const latest = await Payroll.findOne({}).sort({ createdAt: -1 });
  let nextNumber = 1;
  if (latest?.payrollCode) {
    const match = latest.payrollCode.match(/PR-(\d+)/);
    if (match) nextNumber = parseInt(match[1]) + 1;
  }
  return `PR-${nextNumber.toString().padStart(4, "0")}`;
};

// "YYYY-MM" -> previous "YYYY-MM"
const getPreviousPeriod = (period) => {
  const [year, month] = period.split("-").map(Number);
  const d = new Date(year, month - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const calculateSalary = async (
  employeeId,
  period,
  session,
  manualBasicSalary = null,
) => {
  const employee = await Staff.findById(employeeId).session(session);
  if (!employee) throw new Error("Employee not found");

  // A manually-entered basic salary (typed directly on the Add Payroll form)
  // takes priority and doesn't require a pre-existing Staff Basic Payroll
  // record. Otherwise fall back to the stored basic payroll record, as before.
  let fullBasicSalary;
  if (manualBasicSalary !== null && manualBasicSalary !== undefined) {
    fullBasicSalary = toExactAmount(manualBasicSalary);
  } else {
    const basicPayroll = await StaffBasicPayroll.findOne({
      employeeId,
    }).session(session);
    if (!basicPayroll) throw new Error("Basic payroll not found");
    fullBasicSalary = toExactAmount(basicPayroll.currentBasicSalary || 0);
  }
  const [year, month] = period.split("-").map(Number);
  const totalDaysInMonth = new Date(year, month, 0).getDate();
  const perDaySalary = fullBasicSalary / totalDaysInMonth;

  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month, 0);

  // If this staff member's last working day falls inside (or before) this
  // period, only pay through that date instead of the full month.
  let payableDays = totalDaysInMonth;
  let effectivePeriodEnd = periodEnd;
  if (employee.relievingDate) {
    const relievingDate = new Date(employee.relievingDate);
    if (relievingDate < periodStart) {
      // Already left before this period started — nothing payable this month.
      payableDays = 0;
    } else if (relievingDate <= periodEnd) {
      payableDays = relievingDate.getDate();
      effectivePeriodEnd = relievingDate;
    }
  }

  // Calculate unpaid leaves (only up through the last payable day)
  const startDate = periodStart;
  const endDate =
    effectivePeriodEnd < periodEnd ? effectivePeriodEnd : periodEnd;
  const leaves =
    payableDays > 0
      ? await Leave.find({
          userId: employeeId,
          leaveDate: { $gte: startDate, $lte: endDate },
          status: "approved",
          leaveType: "unpaid",
        }).session(session)
      : [];

  const unpaidLeaveDays = leaves.length;
  const leaveDeduction = unpaidLeaveDays * perDaySalary;
  const effectiveDays = Math.max(0, payableDays - unpaidLeaveDays);
  const netSalary = Math.max(0, perDaySalary * effectiveDays);

  // Get pending advances (unpaid balance = amount - repaidAmount)
  const advances = await StaffAdvance.find({
    employeeId,
    status: { $in: ["pending", "approved"] },
  }).session(session);

  const outstandingAdvance = advances.reduce(
    (sum, a) =>
      sum +
      Math.max(0, toExactAmount(a.amount) - toExactAmount(a.repaidAmount)),
    0,
  );
  const advanceDeduction = Math.min(outstandingAdvance, netSalary);
  const finalSalary = Math.max(0, netSalary - advanceDeduction);

  // Any unpaid balance from last period's payroll rolls forward
  const previousPeriod = getPreviousPeriod(period);
  const previousPayroll = await Payroll.findOne({
    employeeId,
    period: previousPeriod,
    enabled: true,
  }).session(session);
  const previousPendingAmount = toExactAmount(
    previousPayroll?.pendingAmount || 0,
  );

  return {
    employee,
    basicSalary: fullBasicSalary,
    perDaySalary,
    totalDaysInMonth,
    payableDays,
    unpaidLeaveDays,
    leaveDeduction,
    effectiveDays,
    netSalary,
    advances,
    advanceDeduction,
    finalSalary,
    previousPendingAmount,
    totalPayable: toExactAmount(finalSalary + previousPendingAmount),
  };
};

// @desc    Export payroll records as CSV (same filters as getPayrolls, plus
//          employeeId for a single staff member's full salary history)
// @route   GET /api/hrm/payroll/export/csv
// @access  Private
export const exportPayrollsCSV = async (req, res) => {
  try {
    const { status, period, periodFrom, periodTo, search, employeeId } =
      req.query;
    const query = { enabled: true };

    if (status) query.status = status;
    if (employeeId) query.employeeId = employeeId;
    if (period) {
      query.period = period;
    } else if (periodFrom || periodTo) {
      query.period = {};
      if (periodFrom) query.period.$gte = periodFrom;
      if (periodTo) query.period.$lte = periodTo;
    }
    if (search) {
      const staff = await Staff.find({
        $or: [
          { staffName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      query.employeeId = { $in: staff.map((s) => s._id) };
    }

    const payrolls = await Payroll.find(query)
      .populate("employeeId", "staffName email projectName contactNo")
      .sort({ period: -1, createdAt: -1 });

    const header = [
      "Employee",
      "Period",
      "Basic Salary",
      "Total Allowance",
      "Deductions",
      "Advance Deduction",
      "Net Salary",
      "Paid Amount",
      "Pending Amount",
      "Status",
    ];

    const escapeCsv = (value) => {
      const str = String(value ?? "");
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const rows = payrolls.map((p) =>
      [
        p.employeeId?.staffName || "",
        p.period,
        p.adjustedBasicSalary ?? p.basicSalary,
        p.totalAllowance,
        p.totalDeduction,
        p.advanceDeduction,
        p.netSalary,
        p.paidAmount,
        p.pendingAmount,
        p.status,
      ]
        .map(escapeCsv)
        .join(","),
    );

    const csv = [header.join(","), ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="payroll_export.csv"`,
    );
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to export payroll",
      error: error.message,
    });
  }
};

// @desc    Get all payrolls
// @route   GET /api/payroll
// @access  Private
export const getPayrolls = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 1000,
      status,
      period,
      periodFrom,
      periodTo,
      search,
      employeeId,
    } = req.query;
    const query = { enabled: true };

    if (status) query.status = status;
    if (employeeId) query.employeeId = employeeId;
    // Exact single-period match (kept for backward compatibility) OR a
    // "YYYY-MM" range match — period strings sort lexically the same as
    // chronologically, so a plain $gte/$lte comparison works.
    if (period) {
      query.period = period;
    } else if (periodFrom || periodTo) {
      query.period = {};
      if (periodFrom) query.period.$gte = periodFrom;
      if (periodTo) query.period.$lte = periodTo;
    }

    if (search) {
      const staff = await Staff.find({
        $or: [
          { staffName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      query.employeeId = { $in: staff.map((s) => s._id) };
    }

    // Non-admin callers (staff self-service, e.g. the "My Payslips" screen)
    // may only ever see their own payroll records — regardless of what
    // employeeId/search they passed — never another staff member's. Staff
    // and User are only linked by email (no stored userId), same pattern
    // used throughout this codebase.
    if (!isAdminRole(req.user?.role)) {
      const ownStaff = await Staff.findOne({
        email: req.user?.email?.toLowerCase().trim(),
      }).select("_id");
      // No linked Staff profile → no records, not an error.
      query.employeeId = ownStaff ? ownStaff._id : null;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const payrolls = await Payroll.find(query)
      .populate("employeeId", "staffName email projectName contactNo staffId")
      .sort({ period: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Payroll.countDocuments(query);

    res.status(200).json({
      success: true,
      data: payrolls,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch payrolls",
      error: error.message,
    });
  }
};

// @desc    Get single payroll
// @route   GET /api/payroll/:id
// @access  Private
export const getPayroll = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id)
      .populate("employeeId", "staffName email projectName staffId")
      .populate("createdBy", "name email");

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: "Payroll not found",
      });
    }

    res.status(200).json({
      success: true,
      data: payroll,
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid payroll ID",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to fetch payroll",
      error: error.message,
    });
  }
};

// "YYYY-MM" -> "Month YYYY", e.g. "2026-07" -> "July 2026"
const formatPeriodLabel = (period) => {
  const [year, month] = period.split("-").map(Number);
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${monthNames[(month || 1) - 1] || ""} ${year}`.trim();
};

const formatCurrency = (value) =>
  `Rs. ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// @desc    Download a single payroll record as a PDF payslip
// @route   GET /api/hrm/payroll/:id/payslip-export
// @access  Private (self can only download their own; admins can download any)
export const exportPayslipPdf = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id).populate(
      "employeeId",
      "staffName email projectName staffId contactNo",
    );

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: "Payroll not found",
      });
    }

    // Same self-service scoping used by getPayrolls: non-admins may only
    // download their own payslip, matched by email -> Staff profile.
    if (!isAdminRole(req.user?.role)) {
      const ownStaff = await Staff.findOne({
        email: req.user?.email?.toLowerCase().trim(),
      }).select("_id");
      if (!ownStaff || String(ownStaff._id) !== String(payroll.employeeId?._id)) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to download this payslip",
        });
      }
    }

    const staff = payroll.employeeId || {};
    const periodLabel = formatPeriodLabel(payroll.period);
    const fileName = `Payslip-${(staff.staffName || "staff").replace(/\s+/g, "_")}-${payroll.period}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const doc = new PDFDocument({ size: "A4", margin: 0 });
    doc.pipe(res);

    // ── Palette (matches the "Employee Payslip" reference template) ────────
    const NAVY = "#1B3A5C";
    const GOLD = "#C9A24B";
    const CREAM = "#F5E9C8";
    const TEXT_DARK = "#1B1B1B";
    const TEXT_MUTED = "#555555";

    const pageWidth = doc.page.width; // 595.28 for A4
    const marginX = 50;
    const contentWidth = pageWidth - marginX * 2;

    // ── Decorative header band with a wavy bottom edge ──────────────────────
    const drawWaveBand = (topY, height, color, flip = false) => {
      const baseY = flip ? topY : topY + height;
      const amp = 14;
      doc.save();
      doc.moveTo(0, topY);
      doc.lineTo(pageWidth, topY);
      doc.lineTo(pageWidth, baseY - amp);
      doc.bezierCurveTo(
        pageWidth * 0.75, baseY + amp,
        pageWidth * 0.55, baseY - amp * 1.6,
        pageWidth * 0.35, baseY,
      );
      doc.bezierCurveTo(
        pageWidth * 0.2, baseY + amp,
        pageWidth * 0.08, baseY - amp,
        0, baseY - amp * 0.4,
      );
      doc.closePath();
      doc.fill(color);
      doc.restore();
    };

    drawWaveBand(0, 78, NAVY);

    // Title
    doc
      .fontSize(22)
      .fillColor(NAVY)
      .font("Helvetica-Bold")
      .text("EMPLOYEE PAYSLIP", marginX, 108, { width: contentWidth, align: "center" });

    // Gold accent line with small diamond ends, under the title
    const lineY = 140;
    doc.moveTo(marginX + 10, lineY).lineTo(pageWidth - marginX - 10, lineY).strokeColor(GOLD).lineWidth(1.5).stroke();
    [marginX, pageWidth - marginX].forEach((x) => {
      doc.polygon([x - 5, lineY], [x, lineY - 5], [x + 5, lineY], [x, lineY + 5]).fill(GOLD);
    });

    // ── Employee details ────────────────────────────────────────────────────
    let y = 162;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(TEXT_DARK);
    const detailRows = [
      ["Month", periodLabel],
      ["Employee Name", staff.staffName || "-"],
      ["Employee ID", staff.staffId || "NA"],
      ["Department", staff.projectName || "NA"],
      ["Designation", staff.employmentType || "NA"],
      ["Pay Date", "10th/month"],
    ];
    const labelX = marginX;
    const colonX = marginX + 120;
    detailRows.forEach(([label, value]) => {
      doc.font("Helvetica-Bold").fillColor(TEXT_DARK).text(label, labelX, y, { width: 118 });
      doc.font("Helvetica").fillColor(TEXT_DARK).text(`: ${value}`, colonX, y, { width: contentWidth - 120 });
      y += 16;
    });
    y += 10;

    // ── Section ribbon tab (flag-style navy tab with white label) ──────────
    const drawRibbon = (label, ribbonY) => {
      const w = 130;
      const h = 20;
      doc.save();
      doc.moveTo(marginX, ribbonY)
        .lineTo(marginX + w, ribbonY)
        .lineTo(marginX + w - 8, ribbonY + h / 2)
        .lineTo(marginX + w, ribbonY + h)
        .lineTo(marginX, ribbonY + h)
        .closePath()
        .fill(NAVY);
      doc.restore();
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor("#FFFFFF")
        .text(label, marginX + 14, ribbonY + 5, { width: w - 20 });
      return ribbonY + h;
    };

    // ── Cream line-item box: rows of "label : amount", ending in a bold total bar ──
    const drawLineItemBox = (rows, totalLabel, totalValueText, boxTopY) => {
      const rowH = 18;
      const boxHeight = rows.length * rowH + 10;
      doc.rect(marginX, boxTopY, contentWidth, boxHeight).fill(CREAM);

      let rowY = boxTopY + 6;
      doc.font("Helvetica").fontSize(9.5).fillColor(TEXT_DARK);
      rows.forEach(([label, amount]) => {
        doc.text(label, marginX + 14, rowY, { width: 220 });
        doc.text(":", marginX + 240, rowY);
        doc.text(amount, marginX + contentWidth - 110, rowY, { width: 96, align: "right" });
        rowY += rowH;
      });

      const totalY = boxTopY + boxHeight + 4;
      doc.rect(marginX, totalY, contentWidth, 22).fill(CREAM);
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(TEXT_DARK)
        .text(totalLabel, marginX + 14, totalY + 6, { width: 220 });
      doc.text(totalValueText, marginX + contentWidth - 110, totalY + 6, { width: 96, align: "right" });

      return totalY + 22;
    };

    // Earnings
    const basic = payroll.adjustedBasicSalary ?? payroll.basicSalary;
    const earningsRows = [["Basic Salary", formatCurrency(basic)]];
    (payroll.allowances || []).forEach((a) => earningsRows.push([a.type, formatCurrency(a.amount)]));
    if (earningsRows.length === 1) earningsRows.push(["No additional allowances", "NA"]);

    y = drawRibbon("Earnings", y);
    y = drawLineItemBox(
      earningsRows,
      "Total Earnings",
      formatCurrency(payroll.totalAllowance + basic),
      y + 4,
    );
    y += 14;

    // Deductions
    const deductionRows = (payroll.deductions || []).map((d) => [d.type, formatCurrency(d.amount)]);
    if (payroll.advanceDeduction) {
      deductionRows.push(["Advance Recovery", formatCurrency(payroll.advanceDeduction)]);
    }
    if (deductionRows.length === 0) deductionRows.push(["No deductions", "NA"]);

    y = drawRibbon("Deductions", y);
    const totalDeductions = payroll.totalDeduction + (payroll.advanceDeduction || 0);
    y = drawLineItemBox(deductionRows, "Total Deductions", formatCurrency(totalDeductions), y + 4);
    y += 18;

    // ── Net Salary Received bar ─────────────────────────────────────────────
    doc.rect(marginX, y, contentWidth, 26).fill(CREAM);
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(TEXT_DARK)
      .text("Net Salary Received", marginX + 14, y + 7, { width: 260 });
    doc.text(
      formatCurrency(payroll.netSalaryExact ?? payroll.netSalary),
      marginX + contentWidth - 130,
      y + 7,
      { width: 116, align: "right" },
    );
    y += 46;

    // ── Payment details (left) + Prepared by (right) ────────────────────────
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(TEXT_DARK);
    const paymentRows = [
      ["Net Pay", `: ${formatCurrency(payroll.netSalaryExact ?? payroll.netSalary)}`],
      ["Bank Account", `: ${payroll.bankAccount || "NA"}`],
      ["Payment Mode", `: ${payroll.paymentMethod === "bank" ? "Bank Transfer" : (payroll.paymentMethod || "NA")}`],
    ];
    let leftY = y;
    paymentRows.forEach(([label, value]) => {
      doc.font("Helvetica-Bold").text(label, marginX, leftY, { width: 90 });
      doc.font("Helvetica").text(value, marginX + 92, leftY, { width: 180 });
      leftY += 16;
    });

    doc.font("Helvetica").fontSize(9.5).fillColor(TEXT_DARK).text("Prepared by:", marginX + 330, y);

    y = Math.max(leftY, y + 16) + 26;

    doc.font("Helvetica-Bold").fontSize(9.5).text("Authorized by:", marginX, y);
    y += 14;
    doc.font("Helvetica").text("Finance Manager \u2013 Zap Solutionz", marginX, y);
    y += 26;

    doc.font("Helvetica").text("Created by \u2013 Accounts team", marginX, y);
    y += 14;
    doc.font("Helvetica").text("Approved by Admin", marginX, y);

    // Signature block, right-aligned, roughly level with "Authorized by"
    doc
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .text(req.user?.name || "Accounts Team", marginX + 330, y - 40, { width: 160 });
    doc.font("Helvetica").text("Zap Solutionz", marginX + 330, y - 26, { width: 160 });

    // ── Footer wave band ─────────────────────────────────────────────────────
    const footerHeight = 60;
    drawWaveBand(doc.page.height - footerHeight, footerHeight, NAVY, true);

    doc.end();
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid payroll ID",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to generate payslip PDF",
      error: error.message,
    });
  }
};

// @desc    Preview/calculate a staff member's salary for a period before saving
// @route   GET /api/hrm/payroll/calculate/:employeeId/:period
// @access  Private
export const previewPayroll = async (req, res) => {
  try {
    const { employeeId, period } = req.params;

    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({
        success: false,
        message: "Period must be in YYYY-MM format",
      });
    }

    const salaryData = await calculateSalary(employeeId, period, null);

    res.status(200).json({
      success: true,
      data: {
        basicSalary: toFixedAmount(salaryData.basicSalary),
        perDaySalary: toFixedAmount(salaryData.perDaySalary),
        totalDaysInMonth: salaryData.totalDaysInMonth,
        payableDays: salaryData.payableDays,
        unpaidLeaveDays: salaryData.unpaidLeaveDays,
        leaveDeduction: toFixedAmount(salaryData.leaveDeduction),
        effectiveDays: salaryData.effectiveDays,
        netSalary: toFixedAmount(salaryData.netSalary),
        advanceDeduction: toFixedAmount(salaryData.advanceDeduction),
        finalSalary: toFixedAmount(salaryData.finalSalary),
        previousPendingAmount: toFixedAmount(salaryData.previousPendingAmount),
        totalPayable: toFixedAmount(salaryData.totalPayable),
        employeeName: salaryData.employee.staffName,
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to calculate salary",
    });
  }
};

// @desc    Create payroll (supports partial payment — any unpaid balance
//          automatically rolls forward into next month's previousPendingAmount)
// @route   POST /api/payroll
// @access  Private/Admin
export const createPayroll = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      employeeId,
      period,
      basicSalary, // optional — manual override, doesn't require a Staff Basic Payroll record
      allowances = [],
      deductions = [], // itemized [{ type, amount }], e.g. Provident Fund, Professional Tax
      paymentMethod = "bank",
      bankAccount = "",
      remarks = "",
      paidAmount, // optional — defaults to full amount owed if omitted
      sourceAccountId = null,
    } = req.body;

    // Validate — Basic Salary is the only truly mandatory pay figure;
    // Staff and Period are required too since they identify the record.
    if (!employeeId || !period) {
      throw new Error("Employee ID and period are required");
    }

    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new Error("Period must be in YYYY-MM format");
    }

    const hasManualBasicSalary =
      basicSalary !== undefined && basicSalary !== null && basicSalary !== "";
    if (hasManualBasicSalary && (isNaN(basicSalary) || Number(basicSalary) < 0)) {
      throw new Error("Basic Salary must be a valid positive number");
    }

    // Check existing payroll
    const existing = await Payroll.findOne({ employeeId, period }).session(
      session,
    );
    if (existing) {
      throw new Error("Payroll already exists for this period");
    }

    // Calculate salary (includes leave deduction, advance deduction, and
    // any pending balance carried over from the previous period). If the
    // admin typed a Basic Salary directly, it overrides the stored Staff
    // Basic Payroll record — and no such record is required in that case.
    const salaryData = await calculateSalary(
      employeeId,
      period,
      session,
      hasManualBasicSalary ? Number(basicSalary) : null,
    );

    // Process allowances/deductions on top of the calculated basic salary
    const processedAllowances = allowances.map((a) => ({
      type: a.type,
      amount: toFixedAmount(a.amount),
    }));
    const totalAllowance = processedAllowances.reduce(
      (sum, a) => sum + a.amount,
      0,
    );
    const processedDeductions = deductions.map((d) => ({
      type: d.type,
      amount: toFixedAmount(d.amount),
    }));
    const deductionAmount = processedDeductions.reduce(
      (sum, d) => sum + d.amount,
      0,
    );

    const netSalaryExact = Math.max(
      0,
      salaryData.finalSalary + totalAllowance - deductionAmount,
    );
    const totalPayable = toFixedAmount(
      netSalaryExact + salaryData.previousPendingAmount,
    );

    // Partial payment support: paidAmount defaults to the full amount owed,
    // but can be any value from 0 up to totalPayable. Whatever isn't paid
    // becomes pendingAmount and rolls into next month automatically.
    let paidAmountValue =
      paidAmount === undefined || paidAmount === null || paidAmount === ""
        ? totalPayable
        : toFixedAmount(paidAmount);
    paidAmountValue = Math.min(Math.max(0, paidAmountValue), totalPayable);
    const pendingAmount = toFixedAmount(totalPayable - paidAmountValue);

    const status =
      pendingAmount <= 0 ? "paid" : paidAmountValue > 0 ? "partial" : "pending";

    // If a source account is provided, withdraw the amount actually paid
    let sourceAccountData = null;
    if (sourceAccountId && paidAmountValue > 0) {
      const account = await Account.findById(sourceAccountId).session(session);
      if (!account) throw new Error("Source account not found");
      if (account.totalAmount < paidAmountValue) {
        throw new Error(`Insufficient balance in ${account.name}`);
      }
      account.totalAmount = toExactAmount(
        account.totalAmount - paidAmountValue,
      );
      await account.save({ session });
      sourceAccountData = { accountId: account._id, accountName: account.name };
    }

    // Settle outstanding advances against this period's advanceDeduction
    let remainingToSettle = toExactAmount(salaryData.advanceDeduction);
    const usedAdvances = [];
    for (const advance of salaryData.advances) {
      if (remainingToSettle <= 0) break;
      const outstanding = Math.max(
        0,
        toExactAmount(advance.amount) - toExactAmount(advance.repaidAmount),
      );
      if (outstanding <= 0) continue;
      const applied = Math.min(outstanding, remainingToSettle);
      advance.repaidAmount = toExactAmount(
        toExactAmount(advance.repaidAmount) + applied,
      );
      advance.status =
        advance.repaidAmount >= advance.amount ? "repaid" : advance.status;
      await advance.save({ session });
      usedAdvances.push({
        advanceId: advance._id,
        amount: toFixedAmount(applied),
      });
      remainingToSettle = toExactAmount(remainingToSettle - applied);
    }

    const payrollCode = await generatePayrollCode();

    const payroll = new Payroll({
      payrollCode,
      employeeId,
      period,
      basicSalary: toFixedAmount(salaryData.basicSalary),
      adjustedBasicSalary: toFixedAmount(salaryData.finalSalary),
      allowances: processedAllowances,
      totalAllowance: toFixedAmount(totalAllowance),
      deductions: processedDeductions,
      totalDeduction: toFixedAmount(deductionAmount),
      netSalary: toFixedAmount(netSalaryExact),
      netSalaryExact,
      advanceDeduction: toFixedAmount(salaryData.advanceDeduction),
      previousPendingAmount: toFixedAmount(salaryData.previousPendingAmount),
      totalPayable,
      paidAmount: paidAmountValue,
      pendingAmount,
      status,
      paymentMethod,
      sourceAccount: sourceAccountData,
      bankAccount,
      paymentDate: paidAmountValue > 0 ? new Date() : null,
      remarks,
      advances: usedAdvances,
      createdBy: req.user.id,
      attendanceInfo: {
        totalWorkingDays: salaryData.totalDaysInMonth,
        payableDays: salaryData.payableDays,
        unpaidLeaves: salaryData.unpaidLeaveDays,
        perDaySalary: salaryData.perDaySalary,
        effectiveDays: salaryData.effectiveDays,
        leaveDeduction: toFixedAmount(salaryData.leaveDeduction),
        isFull:
          salaryData.unpaidLeaveDays === 0 &&
          salaryData.payableDays === salaryData.totalDaysInMonth,
      },
    });

    await payroll.save({ session });
    await session.commitTransaction();

    const populatedPayroll = await Payroll.findById(payroll._id).populate(
      "employeeId",
      "staffName email projectName",
    );

    res.status(201).json({
      success: true,
      message:
        status === "paid"
          ? "Payroll created and paid in full"
          : `Payroll created — ${pendingAmount.toLocaleString()} remains pending and will carry over to next month`,
      data: populatedPayroll,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({
      success: false,
      message: "Failed to create payroll",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// @desc    Update payroll — status/remarks, or record an additional payment
//          against the pendingAmount (e.g. paying off a previous partial payroll)
// @route   PUT /api/payroll/:id
// @access  Private/Admin
export const updatePayroll = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      status,
      paymentMethod,
      bankAccount,
      remarks,
      additionalPayment,
      sourceAccountId,
    } = req.body;
    const payroll = await Payroll.findById(req.params.id).session(session);

    if (!payroll) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Payroll not found",
      });
    }

    // Recording a further payment against the outstanding pendingAmount
    if (
      additionalPayment !== undefined &&
      additionalPayment !== null &&
      additionalPayment !== ""
    ) {
      let amount = toFixedAmount(additionalPayment);
      amount = Math.min(Math.max(0, amount), payroll.pendingAmount);

      if (amount > 0) {
        if (sourceAccountId) {
          const account =
            await Account.findById(sourceAccountId).session(session);
          if (!account) throw new Error("Source account not found");
          if (account.totalAmount < amount) {
            throw new Error(`Insufficient balance in ${account.name}`);
          }
          account.totalAmount = toExactAmount(account.totalAmount - amount);
          await account.save({ session });
          payroll.sourceAccount = {
            accountId: account._id,
            accountName: account.name,
          };
        }

        payroll.paidAmount = toFixedAmount(payroll.paidAmount + amount);
        payroll.pendingAmount = toFixedAmount(payroll.pendingAmount - amount);
        payroll.status = payroll.pendingAmount <= 0 ? "paid" : "partial";
        payroll.paymentDate = new Date();
      }
    } else if (status) {
      payroll.status = status;
      if (status === "paid") {
        payroll.pendingAmount = 0;
        payroll.paidAmount = payroll.totalPayable;
        payroll.paymentDate = new Date();
      }
    }

    if (paymentMethod) payroll.paymentMethod = paymentMethod;
    if (bankAccount !== undefined) payroll.bankAccount = bankAccount;
    if (remarks !== undefined) payroll.remarks = remarks;

    await payroll.save({ session });
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Payroll updated successfully",
      data: payroll,
    });
  } catch (error) {
    await session.abortTransaction();
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid payroll ID",
      });
    }
    res.status(400).json({
      success: false,
      message: "Failed to update payroll",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// @desc    Delete payroll
// @route   DELETE /api/payroll/:id
// @access  Private/Admin
export const deletePayroll = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payroll = await Payroll.findById(req.params.id).session(session);
    if (!payroll) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Payroll not found",
      });
    }

    // Restore the source account balance for whatever was actually paid out
    if (payroll.sourceAccount?.accountId && payroll.paidAmount > 0) {
      const account = await Account.findById(
        payroll.sourceAccount.accountId,
      ).session(session);
      if (account) {
        account.totalAmount = toExactAmount(
          account.totalAmount + payroll.paidAmount,
        );
        await account.save({ session });
      }
    }

    // Reverse any advance repayments this payroll had applied
    for (const used of payroll.advances) {
      const advance = await StaffAdvance.findById(used.advanceId).session(
        session,
      );
      if (advance) {
        advance.repaidAmount = Math.max(
          0,
          toExactAmount(advance.repaidAmount) - toExactAmount(used.amount),
        );
        advance.status = advance.repaidAmount <= 0 ? "pending" : advance.status;
        if (
          advance.status === "repaid" &&
          advance.repaidAmount < advance.amount
        ) {
          advance.status = "approved";
        }
        await advance.save({ session });
      }
    }

    await Payroll.findByIdAndDelete(req.params.id).session(session);

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Payroll deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid payroll ID",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to delete payroll",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};