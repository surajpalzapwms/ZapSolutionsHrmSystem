// src/utils/payslipGenerator.js
// Builds a single "Employee Payslip" PDF (styled after the company payslip
// template) from a Payroll record and triggers a browser download.
import jsPDF from "jspdf";
import { getMonthName } from "./dateUtils";

// Edit this to match your organization.
const COMPANY_NAME = "ZAP Solutionz";

const COLORS = {
  navy: [15, 42, 74],
  blueMid: [45, 116, 167],
  blueLight: [92, 168, 209],
  gold: [212, 184, 138],
  cream: [250, 240, 214],
  creamDark: [240, 222, 175],
  textDark: [40, 40, 40],
  textMuted: [130, 130, 130],
};

const money = (value) => {
  const num = Number(value) || 0;
  return `Rs. ${num.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

/** "2026-06" -> "Jun 2026" */
export const formatPeriodLabel = (period, short = false) => {
  if (!period) return "";
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  const name = getMonthName(m - 1);
  return `${short ? name.slice(0, 3) : name} ${y}`;
};

/**
 * Normalizes a raw Payroll API record (populated with employeeId) plus the
 * staff basic payroll record it belongs to, into the flat shape the PDF
 * renderer expects.
 */
export const buildPayslipData = (payroll, staffRecord = {}) => {
  const staff = payroll.employeeId || {};
  return {
    period: payroll.period,
    employeeName: staff.staffName || staffRecord.staffName || "NA",
    employeeCode: staff.staffId || staffRecord.staffId || "NA",
    department: staffRecord.projectName || staff.projectName || "Development",
    designation: "Programming Team",
    payDate: payroll.paymentDate || null,
    basicSalary: payroll.adjustedBasicSalary ?? payroll.basicSalary ?? 0,
    allowances: payroll.allowances || [],
    totalAllowance: payroll.totalAllowance || 0,
    deductions: payroll.deductions || [],
    totalDeduction: payroll.totalDeduction || 0,
    advanceDeduction: payroll.advanceDeduction || 0,
    leaveDeduction: payroll.attendanceInfo?.leaveDeduction || 0,
    netSalary: payroll.netSalary || 0,
    bankAccount: payroll.bankAccount || "NA",
    paymentMethod: payroll.paymentMethod || "bank",
    status: payroll.status || "pending",
  };
};

// Draws the diagonal 3-band ribbon corner decoration.
// corner: 'tr' (top-right) or 'bl' (bottom-left)
function drawCornerRibbon(doc, pageWidth, pageHeight, corner) {
  const size = 130; // bounding box of the decoration
  const bandWidth = 16;
  const gap = 5;
  const colors = [COLORS.blueLight, COLORS.blueMid, COLORS.navy];

  // Draw largest-to-smallest so each subsequent (smaller, darker) triangle
  // sits on top, leaving a diagonal band of the previous color visible —
  // this is what produces the striped ribbon look.
  for (let i = 0; i < colors.length; i++) {
    const s = size - i * (bandWidth + gap);
    if (s <= 0) continue;
    doc.setFillColor(...colors[i]);
    if (corner === "tr") {
      doc.triangle(pageWidth - s, 0, pageWidth, 0, pageWidth, s, "F");
    } else {
      doc.triangle(0, pageHeight - s, 0, pageHeight, s, pageHeight, "F");
    }
  }
}

/**
 * Renders one payslip and saves it as a PDF.
 * @param {ReturnType<typeof buildPayslipData>} data
 */
export const generatePayslipPDF = (data) => {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;

  // ---- Corner ribbon decorations -----------------------------------------
  drawCornerRibbon(doc, pageWidth, doc.internal.pageSize.getHeight(), "tr");
  drawCornerRibbon(doc, pageWidth, doc.internal.pageSize.getHeight(), "bl");

  // ---- Title + gold divider ----------------------------------------------
  let y = 60;
  doc.setTextColor(...COLORS.navy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text("EMPLOYEE PAYSLIP", pageWidth / 2, y, { align: "center" });

  y += 22;
  const lineHalf = 80;
  doc.setDrawColor(...COLORS.gold);
  doc.setLineWidth(1.2);
  doc.line(pageWidth / 2 - lineHalf - 14, y, pageWidth / 2 - 6, y);
  doc.line(pageWidth / 2 + 6, y, pageWidth / 2 + lineHalf + 14, y);
  doc.setFillColor(...COLORS.gold);
  doc.circle(pageWidth / 2, y, 1.4, "F");

  y += 40;

  // ---- Employee info ------------------------------------------------------
  const infoRows = [
    ["Month", formatPeriodLabel(data.period)],
    ["Employee Name", data.employeeName],
    ["Employee ID", data.employeeCode],
    ["Department", data.department],
    ["Designation", data.designation],
    [
      "Pay Date",
      data.payDate
        ? new Date(data.payDate).toLocaleDateString("en-IN")
        : "10th/month",
    ],
  ];

  doc.setTextColor(...COLORS.textDark);
  doc.setFontSize(10);
  infoRows.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(`: ${value}`, margin + 118, y);
    y += 18;
  });

  y += 24;

  // ---- Section helper: navy tab header + cream body ----------------------
  // Body rows always start BELOW the tab (bodyTop + rowHeight), so the first
  // row's label/amount can never sit underneath the tab — this fixes the
  // "hidden first row" bug from the previous version.
  function drawSection(title, rows, totalLabel, totalValue, startY) {
    const tabHeight = 22;
    const tabWidth = 140;
    const rowHeight = 22;

    const bodyTop = startY + tabHeight / 2;
    const bodyHeight = (rows.length + 1) * rowHeight; // + total row

    doc.setFillColor(...COLORS.cream);
    doc.rect(margin, bodyTop, contentWidth, bodyHeight, "F");

    doc.setFillColor(...COLORS.navy);
    doc.roundedRect(margin, startY, tabWidth, tabHeight, 4, 4, "F");
    doc.rect(margin, startY, 14, tabHeight, "F"); // square off the left edge

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text(title, margin + 14, startY + tabHeight / 2 + 3.5);

    let rowY = bodyTop + rowHeight;
    doc.setFontSize(10);
    rows.forEach(([label, value]) => {
      doc.setTextColor(...COLORS.textDark);
      doc.setFont("helvetica", "normal");
      doc.text(label, margin + 14, rowY);
      doc.text(":", margin + 150, rowY);
      doc.text(value, pageWidth - margin - 14, rowY, { align: "right" });
      rowY += rowHeight;
    });

    doc.setFillColor(...COLORS.creamDark);
    doc.rect(margin, rowY - rowHeight + 4, contentWidth, rowHeight, "F");
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLORS.textDark);
    doc.text(totalLabel, margin + 14, rowY);
    doc.text(totalValue, pageWidth - margin - 14, rowY, { align: "right" });

    return bodyTop + bodyHeight + 20; // next section's startY
  }

  const earningsRows = [["Basic Salary", money(data.basicSalary)]];
  data.allowances.forEach((a) => earningsRows.push([a.type, money(a.amount)]));
  const totalEarnings = Number(data.basicSalary) + Number(data.totalAllowance);

  y = drawSection(
    "Earnings",
    earningsRows,
    "Total Earnings",
    money(totalEarnings),
    y,
  );

  // Always show every deduction category the schema tracks — even when an
  // amount is 0 — so the section keeps a consistent multi-row layout that
  // matches the reference template instead of collapsing to a single
  // "No deductions" line whenever nothing happens to be non-zero.
  const deductionRows = [
    ...data.deductions.map((d) => [d.type, money(d.amount)]),
    ["Advance Deduction", money(data.advanceDeduction)],
    ["Leave Deduction", money(data.leaveDeduction)],
  ];
  const totalDeductions =
    Number(data.totalDeduction) +
    Number(data.advanceDeduction) +
    Number(data.leaveDeduction);

  y = drawSection(
    "Deductions",
    deductionRows,
    "Total Deductions",
    money(totalDeductions),
    y,
  );

  // ---- Net salary banner ---------------------------------------------------
  doc.setFillColor(...COLORS.cream);
  doc.roundedRect(margin, y, contentWidth, 34, 5, 5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.setTextColor(...COLORS.textDark);
  doc.text("Net Salary Received", margin + 14, y + 22);
  doc.text(money(data.netSalary), pageWidth - margin - 14, y + 22, {
    align: "right",
  });

  y += 60;

  // ---- Payment details -------------------------------------------------------
  doc.setFontSize(10);
  const payRows = [
    ["Net Pay", money(data.netSalary)],
    ["Bank Account", data.bankAccount],
    [
      "Payment Mode",
      data.paymentMethod === "bank" ? "Bank Transfer" : data.paymentMethod,
    ],
  ];
  const payStartY = y;
  payRows.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLORS.textDark);
    doc.text(label, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(`: ${value}`, margin + 118, y);
    y += 18;
  });

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.textMuted);
  doc.setFontSize(10);
  doc.text("Prepared by:", pageWidth - margin, payStartY, { align: "right" });

  y += 26;

  // ---- Footer / signatures -----------------------------------------------
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.textDark);
  doc.text("Authorized by:", margin, y);
  doc.setTextColor(...COLORS.textMuted);
  doc.text("Accounts Team", pageWidth - margin, y, { align: "right" });
  y += 13;
  doc.setTextColor(...COLORS.textDark);
  doc.text(`Finance Manager – ${COMPANY_NAME}`, margin, y);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(COMPANY_NAME, pageWidth - margin, y, { align: "right" });
  y += 20;
  doc.text("Created by - Accounts team", margin, y);
  y += 14;
  doc.text("Approved by Admin", margin, y);

  const filename = `Payslip_${data.employeeName.replace(/\s+/g, "_")}_${data.period}.pdf`;
  doc.save(filename);
};