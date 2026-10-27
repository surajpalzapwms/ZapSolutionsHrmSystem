import { formatDateToDDMMMYYYY } from "./dateUtils";
import { formatNumber } from "./numberUtils";
import { getBrand, formatMoneyPdf, formatPlainNumber } from "./brand";
import { monthBreakdownLines, monthTotals } from "./settlementBreakdown";

// Company name and logo come from src/utils/brand.js.

const COLORS = {
  navy: [21, 58, 105],
  navyText: [21, 58, 105],
  headerBand: [31, 74, 130],
  rowAlt: [245, 248, 252],
  amber: [253, 240, 209],
  amberText: [120, 80, 10],
  textDark: [45, 45, 45],
  plTaken: [220, 38, 38],
  plNotTaken: [22, 163, 74],
  textMuted: [120, 120, 120],
  border: [222, 228, 236],
  warnBorder: [237, 189, 130],
  warnBg: [253, 243, 227],
  warnText: [150, 90, 10],
};

// Amount in the company currency chosen in Settings (PDF-safe text).
const money = (value) => formatMoneyPdf(value);

const days = (value, decimals = 1) => `${formatNumber(value, decimals)} days`;

/**
 * Normalizes the raw API settlement payload (see computeFinalSettlement)
 * into the flat shape this generator + the on-screen modal both read.
 */
export const buildSettlementData = (raw) => raw;

// Fetches a same-origin static asset and resolves it to a base64 data URL,
// so it can be embedded in the PDF with doc.addImage.
const loadImageAsDataURL = (url) =>
  new Promise((resolve, reject) => {
    fetch(url)
      .then((res) => res.blob())
      .then(
        (blob) =>
          new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result);
            reader.onerror = rej;
            reader.readAsDataURL(blob);
          }),
      )
      .then(resolve)
      .catch(reject);
  });

// Draws a "Particulars / Details"-style two-column table with a navy
// header band, alternating row shading, and an optional amber highlight
// on specific rows — matching the paper template's table styling.
// rows: [label, value, { highlight?: boolean }]
// Returns the y position just below the table.
function drawTable(
  doc,
  { x, y, width, colSplit, headers, rows, pageHeight, margin },
) {
  const rowHeight = 20;
  const headerHeight = 22;

  const ensureSpace = (needed) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  ensureSpace(headerHeight);

  // Header band
  doc.setFillColor(...COLORS.headerBand);
  doc.rect(x, y, width, headerHeight, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(headers[0], x + 10, y + headerHeight / 2 + 3.5);
  doc.text(headers[1], x + colSplit + 10, y + headerHeight / 2 + 3.5);
  y += headerHeight;

  doc.setFontSize(10);
  rows.forEach(([label, value, opts = {}], idx) => {
    ensureSpace(rowHeight);
    if (opts.highlight) {
      doc.setFillColor(...COLORS.amber);
    } else if (idx % 2 === 1) {
      doc.setFillColor(...COLORS.rowAlt);
    } else {
      doc.setFillColor(255, 255, 255);
    }
    doc.rect(x, y, width, rowHeight, "F");
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.5);
    doc.rect(x, y, width, rowHeight, "S");

    doc.setFont("helvetica", opts.highlight ? "bold" : "normal");
    doc.setTextColor(...(opts.highlight ? COLORS.amberText : COLORS.textDark));
    doc.text(String(label), x + 10, y + rowHeight / 2 + 3.5);
    doc.text(String(value), x + width - 10, y + rowHeight / 2 + 3.5, {
      align: "right",
    });
    y += rowHeight;
  });

  return y + 18; // gap before next section
}

const n2 = (v) => String(Math.round((Number(v) || 0) * 100) / 100);
const nz = (v) => (Number(v) ? n2(v) : "-");

const m2 = (v) => formatPlainNumber(v);
const mz = (v) => (Number(v) ? m2(v) : "-");

// Month-wise leave statement, Sick + Casual FIRST then Paid:
// Month | Earned S C P | Taken S C P Total | Deducted S+C Paid | PL left
// Days, Per day, PL Amount. Returns the y position just below the table.
function drawLeaveLedger(
  doc,
  { x, y, width, pageHeight, margin, leaveBalance },
) {
  const months = leaveBalance.monthly || [];
  const yearly = leaveBalance.yearly || [];
  const totals = leaveBalance.totals;
  const rowH = 15;
  const monthW = 56;
  // Relative widths of the 12 data columns (money columns are wider).
  const weights = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.35, 1.6];
  const unit = (width - monthW) / weights.reduce((a, b) => a + b, 0);
  const colX = [];
  let cx = x + monthW;
  weights.forEach((w) => {
    colX.push(cx);
    cx += w * unit;
  });
  const colRight = (i) => colX[i] + weights[i] * unit - 3;
  const groupStarts = [0, 3, 7, 9]; // Earned / Taken / Deducted / PL left

  const header = () => {
    doc.setFillColor(...COLORS.headerBand);
    doc.rect(x, y, width, 34, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("Month", x + 5, y + 26);
    [
      ["Earned", 0, 3],
      ["Taken", 3, 4],
      ["Deducted", 7, 2],
      ["Paid Leave left", 9, 3],
    ].forEach(([t, i, span]) => {
      const start = colX[i];
      const end = colX[i + span - 1] + weights[i + span - 1] * unit;
      doc.text(t, (start + end) / 2, y + 12, { align: "center" });
    });
    [
      "Sick",
      "Casual",
      "Paid",
      "Sick",
      "Casual",
      "Paid",
      "Total",
      "S+C",
      "Paid",
      "Days",
      "Per day",
      "PL Amt",
    ].forEach((t, i) => doc.text(t, colRight(i), y + 26, { align: "right" }));
    y += 34;
  };

  // Page break inside the ledger table: repeats the column header.
  const ensure = (h) => {
    if (y + h > pageHeight - margin) {
      doc.addPage();
      y = margin;
      header();
    }
  };

  // A cell is either plain text, or an array of [text, rgbColor] lines that
  // are stacked inside the cell (used for the green + red PL Amount).
  const drawRow = (
    label,
    cells,
    { fill = null, bold = false, color = COLORS.textDark } = {},
  ) => {
    const lines = Math.max(
      1,
      ...cells.map((c) => (Array.isArray(c) ? c.length : 1)),
    );
    const h = rowH + (lines - 1) * 9;
    ensure(h);
    if (fill) {
      doc.setFillColor(...fill);
      doc.rect(x, y, width, h, "F");
    }
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.4);
    doc.line(x, y + h, x + width, y + h);
    groupStarts.forEach((i) => doc.line(colX[i], y, colX[i], y + h));
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(7);
    doc.setTextColor(...color);
    doc.text(String(label), x + 5, y + rowH / 2 + 3);
    cells.forEach((c, i) => {
      const parts = Array.isArray(c) ? c : [[c, color]];
      parts.forEach(([t, col], li) => {
        doc.setTextColor(...(col || color));
        doc.text(String(t), colRight(i), y + rowH / 2 + 3 + li * 9, {
          align: "right",
        });
      });
    });
    y += h;
  };

  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  // GREEN = Paid Leave left in the month (Bal Payable);
  // RED   = Paid Leave taken from it (Balance Taken).
  const plLeft = (m) =>
    r2(m.plAmount ?? Number(m.plRemaining) * Number(m.perDaySalary));
  const plTaken = (m) => r2(Number(m.deducted?.paid) * Number(m.perDaySalary));
  const plCell = (m) => {
    const parts = [];
    if (plLeft(m) > 0) parts.push([m2(plLeft(m)), COLORS.plNotTaken]);
    if (plTaken(m) > 0) parts.push([m2(plTaken(m)), COLORS.plTaken]);
    return parts.length ? parts : "-";
  };
  const takenTotal = r2(months.reduce((s, m) => s + plTaken(m), 0));

  const drawNote = (text, fill, color) => {
    ensure(rowH);
    doc.setFillColor(...fill);
    doc.rect(x, y, width, rowH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...color);
    doc.text(text, x + 5, y + rowH / 2 + 3);
    y += rowH;
  };

  if (y + 34 + rowH * 3 > pageHeight - margin) {
    doc.addPage();
    y = margin;
  }
  header();

  months.forEach((m, idx) => {
    let label = m.label;
    if (m.beforeConfirmation) label += " (pre)";
    else if (!m.credited) label += " *";
    drawRow(
      label,
      [
        nz(m.earned.sick),
        nz(m.earned.casual),
        nz(m.earned.paid),
        nz(m.taken.sick),
        nz(m.taken.casual),
        nz(m.taken.paid),
        nz(m.taken.total),
        nz(m.deducted.sickCasual),
        nz(m.deducted.paid),
        nz(m.plRemaining),
        mz(m.perDaySalary),
        plCell(m),
      ],
      { fill: idx % 2 ? COLORS.rowAlt : null },
    );
    const next = months[idx + 1];
    if (!next || next.year !== m.year) {
      const t = yearly.find((r) => r.year === m.year);
      if (t) {
        let note = `${m.year}: leave taken ${n2(t.taken.total)} -> ${n2(t.fromSickCasual)} from Sick + Casual`;
        if (t.toPaid > 0) note += `, ${n2(t.toPaid)} from Paid Leave`;
        if (t.sickCasualLapsed > 0)
          note += `  |  Sick + Casual unused ${n2(t.sickCasualLapsed)} (lapsed, not paid)`;
        drawNote(note, [232, 240, 252], [21, 58, 105]);
      }
    }
  });

  if (totals) {
    drawRow(
      "Grand total",
      [
        n2(totals.earned.sick),
        n2(totals.earned.casual),
        n2(totals.earned.paid),
        n2(totals.taken.sick),
        n2(totals.taken.casual),
        n2(totals.taken.paid),
        n2(totals.taken.total),
        n2(totals.deducted.sickCasual),
        n2(totals.deducted.paid),
        n2(totals.plRemaining),
        "",
        takenTotal > 0
          ? [
              [`PL Used: ${m2(takenTotal)}`, COLORS.plTaken],
              [`PL Payable: ${m2(totals.encashment)}`, COLORS.plNotTaken],
            ]
          : [[`PL Payable: ${m2(totals.encashment)}`, COLORS.plNotTaken]],
      ],
      { fill: COLORS.amber, bold: true, color: COLORS.amberText },
    );
  }

  const newPageIfNeeded = (h) => {
    if (y + h > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const LINE = 10;
  const NUM_X = x + 2; // "1."
  const NUM_TEXT_X = x + 14; // text after "1."
  const BULLET_X = x + 20; // bullet for sub-points
  const BULLET_TEXT_X = x + 28; // text after the bullet

  // Wrapped item with a hanging indent. `lead` = optional [text, rgb]
  // drawn bold + coloured at the start of the first line (e.g. "Green").
  const drawItem = (marker, markerX, textX, text, lead) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    const full = lead ? `${lead[0]} ${text}` : text;
    const lines = doc.splitTextToSize(full, x + width - textX - 4);
    newPageIfNeeded(lines.length * LINE + 4);

    y += LINE;
    doc.setTextColor(...COLORS.textDark);
    doc.text(marker, markerX, y);

    lines.forEach((line, i) => {
      if (i > 0) y += LINE;
      if (i === 0 && lead) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...lead[1]);
        doc.text(lead[0], textX, y);
        const leadW = doc.getTextWidth(`${lead[0]} `);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...COLORS.textDark);
        doc.text(line.slice(lead[0].length + 1), textX + leadW, y);
      } else {
        doc.text(line, textX, y);
      }
    });
  };

  // Heading
  y += 16;
  newPageIfNeeded(40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.navyText);
  doc.text("Notes on Leave Deduction and Paid Leave Valuation", x, y);
  y += 2;

  const notes = [
    "Leave taken is adjusted first against the Sick Leave and Casual Leave balances. These leave types are not encashable and are not paid out.",
    "Once the Sick and Casual Leave balances are exhausted, the remaining leave is adjusted against the Paid Leave balance, starting with the oldest month.",
    "Unutilised Paid Leave for a month is paid out at that month's salary divided by the number of days in that month.",
  ];
  notes.forEach((t, i) => drawItem(`${i + 1}.`, NUM_X, NUM_TEXT_X, t));

  drawItem("4.", NUM_X, NUM_TEXT_X, "In the PL Amount column:");
  drawItem(
    "\u2022",
    BULLET_X,
    BULLET_TEXT_X,
    "(Bal Payable) indicates the value of Paid Leave remaining for that month, which is payable.",
    ["Green", COLORS.plNotTaken],
  );
  drawItem(
    "\u2022",
    BULLET_X,
    BULLET_TEXT_X,
    "(Balance Taken) indicates the value of Paid Leave utilised from that month, which is not payable.",
    ["Red", COLORS.plTaken],
  );

  // Conditional notes continue the numbering (5, 6, ...).
  const extras = [];
  if (months.some((m) => !m.credited && !m.beforeConfirmation)) {
    extras.push(
      "* Month not earned - fewer than 20 days worked (holidays included) in the final month.",
    );
  }
  if (totals && Number(totals.taken.unpaid) > 0) {
    extras.push(
      `Unpaid leave (${n2(totals.taken.unpaid)} day(s)) is not deducted from any balance.`,
    );
  }
  if (totals && Number(totals.overdrawn) > 0) {
    extras.push(
      `${n2(totals.overdrawn)} day(s) taken beyond all leave earned.`,
    );
  }
  extras.forEach((t, i) => drawItem(`${5 + i}.`, NUM_X, NUM_TEXT_X, t));

  return y + 18;
}

// Month-wise salary with the full "how this month's amount came" breakdown
// under every month (same lines as the View details button on screen).
function drawMonthSalaryDetails(doc, { x, y, width, title, months, pageHeight, margin }) {
  const ensureSpace = (needed) => {
    if (y + needed > pageHeight - margin - 20) {
      doc.addPage();
      y = margin;
    }
  };
  const right = x + width - 10;
  const cols = { unpaid: x + width * 0.46, earned: x + width * 0.62, paid: x + width * 0.78 };

  ensureSpace(44);
  doc.setFillColor(...COLORS.headerBand);
  doc.rect(x, y, width, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(title, x + 10, y + 14.5);
  y += 22;

  const header = () => {
    doc.setFillColor(...COLORS.rowAlt);
    doc.rect(x, y, width, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.textMuted);
    doc.text("Month", x + 10, y + 12);
    doc.text("Unpaid leave", cols.unpaid, y + 12, { align: "right" });
    doc.text("Earned", cols.earned, y + 12, { align: "right" });
    doc.text("Paid", cols.paid, y + 12, { align: "right" });
    doc.text("Pending", right, y + 12, { align: "right" });
    y += 18;
  };
  header();

  months.forEach((m) => {
    const lines = monthBreakdownLines(m);
    ensureSpace(22 + Math.min(lines.length, 4) * 13);
    // Month summary row
    doc.setFillColor(...(m.pending > 0 ? COLORS.amber : [255, 255, 255]));
    doc.rect(x, y, width, 20, "F");
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.5);
    doc.line(x, y, x + width, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.textDark);
    doc.text(
      `${m.label}  (${formatNumber((m.payableDays || 0) - (m.unpaidDays || 0), 1)}/${m.totalDays || 0} days paid)`,
      x + 10,
      y + 13,
    );
    doc.setTextColor(...(Number(m.unpaidDays) ? COLORS.plTaken : COLORS.textMuted));
    doc.text(Number(m.unpaidDays) ? `${n2(m.unpaidDays)} d` : "-", cols.unpaid, y + 13, { align: "right" });
    doc.setTextColor(...COLORS.textDark);
    doc.text(m2(m.earned), cols.earned, y + 13, { align: "right" });
    doc.text(m2(m.paid), cols.paid, y + 13, { align: "right" });
    doc.setTextColor(...(m.pending > 0 ? COLORS.amberText : COLORS.plNotTaken));
    doc.text(m.pending > 0 ? m2(m.pending) : "Settled", right, y + 13, { align: "right" });
    y += 20;

    // Breakdown lines
    lines.forEach((l) => {
      const label = `${l.sign && l.sign !== "=" ? `${l.sign} ` : ""}${l.label}`;
      doc.setFontSize(8.5);
      const subLines = l.sub ? doc.splitTextToSize(String(l.sub), width * 0.6) : [];
      const h = 12 + subLines.length * 10;
      ensureSpace(h);
      doc.setFont("helvetica", l.kind === "total" ? "bold" : "normal");
      doc.setTextColor(...(l.kind === "muted" ? COLORS.textMuted : COLORS.textDark));
      doc.text(label, x + 24, y + 9);
      const color =
        l.sign === "-" ? COLORS.plTaken : l.kind === "pending" ? COLORS.amberText : COLORS.textDark;
      doc.setTextColor(...color);
      doc.text(`${l.sign === "-" ? "- " : ""}${money(l.amount)}`, right, y + 9, { align: "right" });
      if (subLines.length) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...COLORS.textMuted);
        doc.text(subLines, x + 32, y + 19);
      }
      y += h;
    });
    y += 4;
  });

  // Totals
  const t = monthTotals(months);
  ensureSpace(20);
  doc.setFillColor(...COLORS.rowAlt);
  doc.rect(x, y, width, 20, "F");
  doc.setDrawColor(...COLORS.border);
  doc.line(x, y, x + width, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.textDark);
  doc.text("Total", x + 10, y + 13);
  doc.setTextColor(...COLORS.plTaken);
  doc.text(t.unpaidDays ? `${n2(t.unpaidDays)} d` : "-", cols.unpaid, y + 13, { align: "right" });
  doc.setTextColor(...COLORS.textDark);
  doc.text(m2(t.earned), cols.earned, y + 13, { align: "right" });
  doc.text(m2(t.paid), cols.paid, y + 13, { align: "right" });
  doc.setTextColor(...COLORS.amberText);
  doc.text(m2(t.pending), right, y + 13, { align: "right" });
  y += 20;
  return y + 18;
}

/**
 * Renders the Full & Final Settlement Statement and saves it as a PDF.
 * @param {object} data - the settlement payload as returned by the API
 *   ({ staff, monthlySalary, perDaySalary, leaveBalance, salaryPeriod, months, pendingMonths, finalSettlement })
 */
export const generateSettlementPDF = async (data) => {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;

  let y = margin;
  // Left during probation: no salary rate rows, no leave sections.
  const probation = !!data.probationExit;

  // ---- Header: logo + title ------------------------------------------------
  try {
    const logoSrc = getBrand().logoUrl;
    if (!logoSrc) throw new Error("no logo configured");
    const logoDataUrl = await loadImageAsDataURL(logoSrc);
    // Preserve the logo's natural aspect ratio at a fixed display height.
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = logoDataUrl;
    });
    const logoHeight = 44;
    const logoWidth = (img.width / img.height) * logoHeight;
    doc.addImage(logoDataUrl, "PNG", margin, y, logoWidth, logoHeight);
  } catch {
    // Logo is a nice-to-have — the statement is still complete without it.
  }
  y += 60;

  doc.setTextColor(...COLORS.navyText);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.text("Full & Final Settlement Statement", margin, y);
  y += 8;
  doc.setDrawColor(...COLORS.navy);
  doc.setLineWidth(1.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(
    `Salary ${data.salaryPeriod.fromLabel} to ${formatDateToDDMMMYYYY(data.staff.relievingDate)}`,
    margin,
    y,
  );
  y += 26;

  const colSplit = contentWidth * 0.55;

  // ---- Overview --------------------------------------------------------
  y = drawTable(doc, {
    x: margin,
    y,
    width: contentWidth,
    colSplit,
    headers: ["Overview", ""],
    pageHeight,
    margin,
    rows: [
      ["Staff Name", data.staff.staffName || "\u2014"],
      ...(data.staff.staffId ? [["Staff ID", data.staff.staffId]] : []),
      [
        probation ? "Joining Date (Probation)" : "Joining Date",
        formatDateToDDMMMYYYY(data.staff.joiningDate) || "\u2014",
      ],
      [
        "Date of Confirmation",
        probation
          ? "\u2014 (left during probation)"
          : formatDateToDDMMMYYYY(data.staff.confirmationDate) || "\u2014",
      ],
      [
        probation ? "Termination / Relieving Date" : "Relieving Date",
        formatDateToDDMMMYYYY(data.staff.relievingDate) || "\u2014",
      ],
      ...(probation
        ? []
        : [
            ["Monthly Salary", money(data.monthlySalary)],
            ["Per Day Salary", money(data.perDaySalary)],
          ]),
    ],
  });

  // ---- Leave Summary -----------------------------------------------------
  if (!probation) y = drawTable(doc, {
    x: margin,
    y,
    width: contentWidth,
    colSplit,
    headers: ["Leave Summary", ""],
    pageHeight,
    margin,
    rows: (() => {
      const lb = data.leaveBalance;
      const t = lb.totals;
      const rows = [];
      if (lb.policy) {
        rows.push([
          "Leave earned per month (Leave Policy)",
          `Sick ${n2(lb.policy.sickPerMonth)} / Casual ${n2(lb.policy.casualPerMonth)} / Paid ${n2(lb.policy.paidPerMonth)}`,
        ]);
      }
      if (t) {
        rows.push(["Sick Leave earned", `${n2(t.earned.sick)} days`]);
        rows.push(["Casual Leave earned", `${n2(t.earned.casual)} days`]);
        rows.push(["Paid Leave earned", `${n2(t.earned.paid)} days`]);
        rows.push([
          `Total Leave earned (Sick ${n2(t.earned.sick)} + Casual ${n2(t.earned.casual)} + Paid ${n2(t.earned.paid)})`,
          `${n2(t.earned.sick + t.earned.casual + t.earned.paid)} days`,
        ]);
        rows.push(["Sick Leave taken", `${n2(t.taken.sick)} days`]);
        rows.push(["Casual Leave taken", `${n2(t.taken.casual)} days`]);
        rows.push(["Paid Leave taken", `${n2(t.taken.paid)} days`]);
        rows.push([
          `Total Leave taken (Sick ${n2(t.taken.sick)} + Casual ${n2(t.taken.casual)} + Paid ${n2(t.taken.paid)})`,
          `${n2(t.taken.total)} days`,
        ]);
        rows.push([
          "Deducted from Sick + Casual first",
          `- ${n2(t.deducted.sickCasual)} days`,
        ]);
        rows.push([
          "Then deducted from Paid Leave (oldest month first)",
          `- ${n2(t.deducted.paid)} days`,
        ]);
        rows.push([
          "Sick + Casual unused (lapsed - not paid)",
          `${n2(t.sickCasualUnused)} days`,
        ]);
      }
      rows.push([
        "Paid Leave Remaining (encashed)",
        days(lb.paidRemaining, 2),
        { highlight: true },
      ]);
      return rows;
    })(),
  });

  // ---- Month-wise leave statement ----------------------------------------
  const ledgerMonths = probation ? [] : data.leaveBalance?.monthly || [];
  if (ledgerMonths.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...COLORS.navyText);
    if (y + 60 > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(
      `Month-wise Leave (${ledgerMonths[0].label} - ${ledgerMonths[ledgerMonths.length - 1].label})`,
      margin,
      y,
    );
    y += 8;
    y = drawLeaveLedger(doc, {
      x: margin,
      y,
      width: contentWidth,
      pageHeight,
      margin,
      leaveBalance: data.leaveBalance,
    });
  }

  // ---- Warning note (relieving month didn't qualify for accrual) --------
  if (!probation && data.leaveBalance?.relievingMonthAccrualQualified === false) {
    const note =
      "The staff member worked fewer than 20 days (holidays included) in their final calendar month, so that month did not earn any additional Paid/Sick/Casual leave.";
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(note, contentWidth - 24);
    const boxHeight = lines.length * 13 + 16;
    if (y + boxHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.setFillColor(...COLORS.warnBg);
    doc.setDrawColor(...COLORS.warnBorder);
    doc.setLineWidth(0.8);
    doc.roundedRect(margin, y, contentWidth, boxHeight, 4, 4, "FD");
    doc.setTextColor(...COLORS.warnText);
    doc.setFont("helvetica", "normal");
    doc.text(lines, margin + 12, y + 16);
    y += boxHeight + 18;
  }

  // ---- Month-wise salary (with how each month's amount came) --------------
  y = drawMonthSalaryDetails(doc, {
    x: margin,
    y,
    width: contentWidth,
    title: `Month-wise Salary (${data.salaryPeriod.fromLabel} - ${data.salaryPeriod.toLabel})`,
    months: data.months || [],
    pageHeight,
    margin,
  });

  // ---- Final Settlement Amount --------------------------------------------
  const fs = data.finalSettlement;
  const settlementRows = [];
  if (!data.pendingMonths.length)
    settlementRows.push(["Pending Salary", money(0)]);
  data.pendingMonths.forEach((m) => {
    settlementRows.push([
      m.beforeConfirmation
        ? `${m.label} salary (pending from before confirmation)`
        : `${m.label} salary (${formatNumber(m.payableDays - m.unpaidDays, 1)} of ${m.totalDays} days)`,
      money(m.pending),
    ]);
  });
  (probation ? [] : fs.leaveEncashmentMonths || []).forEach((m) => {
    settlementRows.push([
      `Paid Leave ${m.label} (${n2(m.days)} days x ${money(m.perDaySalary)})`,
      money(m.amount),
    ]);
  });
  if (!probation)
    settlementRows.push([
      `Leave encashment - Paid Leave only (${formatNumber(fs.leaveEncashmentDays, 2)} days)`,
      money(fs.leaveEncashment),
    ]);
  settlementRows.push(["Total Amount Payable", money(fs.totalAmountPayable)]);
  if (fs.outstandingAdvance > 0) {
    settlementRows.push([
      "Less: Outstanding Advance",
      `- ${money(fs.outstandingAdvance)}`,
    ]);
  }
  settlementRows.push([
    "Balance Payable - Full & Final Settlement",
    money(fs.balancePayable),
    { highlight: true },
  ]);
  y = drawTable(doc, {
    x: margin,
    y,
    width: contentWidth,
    colSplit,
    headers: ["Final Settlement Amount", ""],
    pageHeight,
    margin,
    rows: settlementRows,
  });

  // ---- Note + signature block --------------------------------------------
  if (y + 130 > pageHeight - margin) {
    doc.addPage();
    y = margin;
  }
  const pendingText = data.pendingMonths.length
    ? `salary for ${data.pendingMonths.map((m) => m.label).join(", ")}`
    : "no pending salary";
  const notePoints = probation
    ? [
        "Salary up to the last paid month has already been disbursed.",
        `The balance of ${money(fs.balancePayable)} covers ${pendingText}, after unpaid leave and other deductions shown month by month above.`,
        "The staff member left during the probation period, so no leave was earned and there is no leave encashment. The balance is payable as full and final settlement.",
      ]
    : [
        "Salary up to the last paid month has already been disbursed.",
        `The balance of ${money(fs.balancePayable)} covers ${pendingText} and encashment of ${formatNumber(
          fs.leaveEncashmentDays,
          2,
        )} days of unused Paid Leave.`,
        "Sick and Casual leave are not encashed, and the balance is payable as full and final settlement.",
      ];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.textDark);

  const NUM_W = 16; // space for "1." before the text
  notePoints.forEach((point, i) => {
    const lines = doc.splitTextToSize(point, contentWidth - NUM_W);
    if (y + lines.length * 13 > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(`${i + 1}.`, margin, y);
    doc.text(lines, margin + NUM_W, y); // wrapped lines stay indented under the text
    y += lines.length * 13 + 4;
  });
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.text(
    "Please acknowledge the same so that we can process the balance amount.",
    margin,
    y,
  );
  y += 26;

  doc.setFont("helvetica", "bold");
  doc.text("Regards,", margin, y);
  y += 16;
  doc.text("Accounts Team", margin, y);
  y += 16;
  doc.setTextColor(...COLORS.navyText);
  doc.text(getBrand().name, margin, y);

  // ---- Footer: generated-live disclaimer (every page) ----------------------
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.textMuted);
    doc.text(
      "Figures are calculated live from attendance, leave and payroll records as of the generation date.",
      margin,
      pageHeight - 28,
    );
    doc.text(`Page ${p} of ${pageCount}`, pageWidth - margin, pageHeight - 28, {
      align: "right",
    });
  }

  const filename = `Full_Final_Settlement_${(data.staff.staffName || "staff").replace(/\s+/g, "_")}.pdf`;
  doc.save(filename);
};
