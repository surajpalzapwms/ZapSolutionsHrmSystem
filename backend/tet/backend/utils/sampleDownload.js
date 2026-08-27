


import XLSX from "xlsx";

// ─── env flags ────────────────────────────────────────────────────────────────
export const isSampleDownloadEnabled =
  process.env.VITE_IS_SAMPLE_DOWNLOAD_FILE === "true";

export const isWithCustomerCode =
  isSampleDownloadEnabled &&
  process.env.VITE_IS_WITH_CUSTOMER_CODE === "true";

// ─── shared guard middleware ───────────────────────────────────────────────────
/**
 * Attach this as the first handler on every sample-download route.
 * Returns 404 when the feature flag is off so the endpoint simply
 * doesn't exist in production.
 */
export const sampleDownloadGuard = (req, res, next) => {
  if (!isSampleDownloadEnabled) {
    return res
      .status(404)
      .json({ message: "Sample download is disabled.", ok: false });
  }
  next();
};

// ─── xlsx helpers ─────────────────────────────────────────────────────────────
/**
 * Build and send an xlsx workbook from an array-of-arrays (header row first).
 *
 * @param {import("express").Response} res
 * @param {any[][]} aoa      – array of arrays, first row = headers
 * @param {string}  sheetName
 * @param {string}  filename – without extension
 */
export const sendXlsx = (res, aoa, sheetName, filename) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Auto-width columns
  const colWidths = aoa[0].map((header, colIdx) => {
    const maxLen = Math.max(
      String(header).length,
      ...aoa.slice(1).map((row) => String(row[colIdx] ?? "").length),
    );
    return { wch: Math.min(maxLen + 4, 40) };
  });
  ws["!cols"] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=${filename}_sample.xlsx`,
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.send(buf);
};

// ─── today helper ─────────────────────────────────────────────────────────────
export const today = () => new Date().toISOString().split("T")[0]; // YYYY-MM-DD

const nextYear = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split("T")[0];
};

// ══════════════════════════════════════════════════════════════════════════════
//  Per-table sample-data builders
//  Each function returns { headers: string[], rows: any[][] }
// ══════════════════════════════════════════════════════════════════════════════

// ─── Customers ────────────────────────────────────────────────────────────────
export const buildCustomerSample = () => {
  const withCode = isWithCustomerCode;
  const headers = [
    ...(withCode ? ["Customer Code"] : []),
    "Date",
    "Medical Representative Name",
    "Customer Name in English",
    "Types of Business",
    "Customer Number",
    "Customer Address",
    "Zone",
    "Province",
    "Remark",
  ];
  const rows = [
    [
      ...(withCode ? ["00001"] : []),
      today(),
      "John Smith",
      "Al-Noor Pharmacy",
      "Pharmacy",
      "0912345678",
      "Street 5, Khartoum",
      "Central Zone",
      "Khartoum",
      "Regular customer",
    ],
    [
      ...(withCode ? ["00002"] : []),
      today(),
      "Sara Ahmed",
      "Shifaa Medical Store",
      "Medical Store",
      "0923456789",
      "Block 3, Omdurman",
      "North Zone",
      "Omdurman",
      "",
    ],
  ];
  return { headers, rows };
};

// ─── Suppliers ────────────────────────────────────────────────────────────────
export const buildSupplierSample = () => {
  const headers = [
    "Supplier Name",
    "Address",
    "Site Registration Date",
    "Site Registration Expiry Date",
  ];
  const rows = [
    ["MedCo International", "Dubai, UAE", today(), nextYear()],
    ["PharmaWorld Ltd", "Cairo, Egypt", today(), nextYear()],
  ];
  return { headers, rows };
};

// ─── Staff ───────────────────────────────────────────────────────────────
export const buildStaffSample = () => {
  const headers = [
    "Staff Name",
    "Project Name",
    "Email",
    "Contact No",
    "Password",
    "Joining Date",
  ];
  const rows = [
    ["Ali Hassan", "Team A", "ali.hassan@company.com", "0911111111", "123456", today()],
    ["Mona Yousif", "Team B", "mona.yousif@company.com", "0922222222", "123456", today()],
  ];
  return { headers, rows };
};

// ─── Products ─────────────────────────────────────────────────────────────────
export const buildProductSample = () => {
  const headers = [
    "Product Name",
    "Type",
    "Packing",
    "Qty Per Box/Strip",
    "Supplier Name",
    "Drug License",
    "License Validity Date",
    "Selling Price (USD)",
    "LC (USD)",
    "FOB (USD)",
    "Tax Selling Price (USD)",
    "Remarks",
  ];
  const rows = [
    [
      "Amoxicillin 500mg",
      "Tablet",
      "10×10",
      100,
      "MedCo International",
      "DL-2024-001",
      nextYear(),
      5.5,
      4.2,
      4.0,
      6.0,
      "Store below 25°C",
    ],
    [
      "Paracetamol 250mg",
      "Syrup",
      "120ml",
      50,
      "PharmaWorld Ltd",
      "DL-2024-002",
      nextYear(),
      2.0,
      1.5,
      1.4,
      2.2,
      "",
    ],
  ];
  return { headers, rows };
};

// ─── Purchase / Inventory (flat rows — one product per row) ───────────────────
export const buildPurchaseSample = () => {
  const headers = [
    "Invoice Number",
    "Invoice Date",
    "Delivery Number",
    "Received Date",
    "Supplier Name",
    "Remarks",
    "Product Name",
    "Product Type",
    "Expiry Date",
    "Quantity Per Box/Strip",
    "FOB (USD)",
    "CIF (USD)",
    "LC (USD)",
    "Selling Price (USD)",
  ];
  const rows = [
    [
      "INV-2024-001",
      today(),
      "DN-001",
      today(),
      "MedCo International",
      "First batch",
      "Amoxicillin 500mg",
      "Tablet",
      nextYear(),
      100,
      4.0,
      4.1,
      4.2,
      5.5,
    ],
    [
      "INV-2024-001",   // same invoice, second product
      today(),
      "DN-001",
      today(),
      "MedCo International",
      "First batch",
      "Paracetamol 250mg",
      "Syrup",
      nextYear(),
      50,
      1.4,
      1.45,
      1.5,
      2.0,
    ],
    [
      "INV-2024-002",
      today(),
      "DN-002",
      today(),
      "PharmaWorld Ltd",
      "",
      "Vitamin C 1000mg",
      "Tablet",
      nextYear(),
      200,
      1.0,
      1.05,
      1.1,
      1.8,
    ],
  ];
  return { headers, rows };
};

// ─── Sales (flat rows — one product per row) ──────────────────────────────────
export const buildSaleSample = () => {
  const withCode = isWithCustomerCode;
  const headers = [
    "Invoice Number",
    "Invoice Date",
    "Staff Name",
    "Customer Name",
    ...(withCode ? ["Customer Code"] : []),
    "Payment Status",
    "Credit Days",
    "Paid Amount",
    "Product Name",
    "Sales Qty",
    "Bonus Qty",
    "Selling Price (USD)",
    "Discount",
    "Remark",
  ];
  const rows = [
    [
      "SI-2024-001",
      today(),
      "Ali Hassan",
      "Al-Noor Pharmacy",
      ...(withCode ? ["00001"] : []),
      "Credit",
      30,
      0,
      "Amoxicillin 500mg",
      10,
      0,
      5.5,
      0,
      "",
    ],
    [
      "SI-2024-001",   // same invoice, second product
      today(),
      "Ali Hassan",
      "Al-Noor Pharmacy",
      ...(withCode ? ["00001"] : []),
      "Credit",
      30,
      0,
      "Paracetamol 250mg",
      5,
      1,
      2.0,
      0,
      "",
    ],
    [
      "SI-2024-002",
      today(),
      "Mona Yousif",
      "Shifaa Medical Store",
      ...(withCode ? ["00002"] : []),
      "Cash",
      0,
      110,
      "Vitamin C 1000mg",
      20,
      0,
      1.8,
      10,
      "Promo discount",
    ],
  ];
  return { headers, rows };
};

// ─── Sales Return ─────────────────────────────────────────────────────────────
export const buildSaleReturnSample = () => {
  const headers = [
    "Recording Date",
    "Invoice Number",
    "Invoice Date",
    "Staff Name",
    "Customer Name",
    "Payment Status",
    "Credit Days",
    "Paid Amount",
    "Delivery Date",
    "Remark",
    "Product Name",
    "Sales Qty",
    "Bonus Qty",
    "Selling Price (USD)",
    "Discount",
    "LC (USD)",
    "Return Quantity",
  ];
  const rows = [
    [
      today(),
      "SI-2024-001",
      today(),
      "Ali Hassan",
      "Al-Noor Pharmacy",
      "Credit",
      30,
      0,
      today(),
      "Damaged box",
      "Amoxicillin 500mg",
      10,
      0,
      5.5,
      0,
      4.2,
      2,
    ],
  ];
  return { headers, rows };
};

// ─── Stock Adjustment — NOTE: requires productId (ObjectId), ──────────────────
//     so the sample shows a placeholder and a guidance note.
export const buildStockAdjustmentSample = () => {
  const headers = [
    "Product Name (reference only)",
    "Product ID (MongoDB ObjectId — required)",
    "Adjustment Type (add / remove)",
    "Boxes",
    "LC (USD)",
    "Amount (USD)",
    "Reason",
    "Notes",
  ];
  const rows = [
    [
      "Amoxicillin 500mg",
      "<paste ObjectId from /api/products>",
      "add",
      10,
      4.2,
      42,
      "Opening stock",
      "Initial import",
    ],
    [
      "Paracetamol 250mg",
      "<paste ObjectId from /api/products>",
      "remove",
      3,
      1.5,
      4.5,
      "Damaged goods",
      "",
    ],
  ];
  return { headers, rows };
};
