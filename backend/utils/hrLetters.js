// utils/hrLetters.js
//
// Offer, Joining and Confirmation letters in the SAME layout as the
// company's own letters (ZAP Solutionz templates):
//
//   Offer        — blue wave bands top + bottom, logo, date / e-mail on the
//                  right, cover page, then the full terms (designation, work
//                  schedule, probation, salary table, policies…), and the
//                  candidate's details box for signing.
//   Confirmation — same bands, faded logo watermark, "Subject: Confirmation
//                  Letter", employment details (job title, department,
//                  start date, schedule, leaves, salary), acceptance page.
//   Joining      — plain Times layout: logo left, company + address right,
//                  "To," block, numbered clauses, acknowledgement.
//
// Every value comes from the staff record:
//   name, gender (Male → "Mr.", Female → "Ms."), designation, department,
//   joining / confirmation date, probation months, work schedule, permanent
//   + current address, mobile, e-mail, Aadhaar / PAN number (from My
//   Documents) and the salary (Staff Basic Payroll, incl. its history).
//
// Pure functions — the controller loads the data and passes it in.
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "letters");
const asset = (name) => {
  const p = path.join(ASSETS, name);
  return fs.existsSync(p) ? p : null;
};

const TZ = "Asia/Kolkata";
const BLUE = "#1F3A93"; // body text (navy blue as in the templates)
const BRAND_BLUE = "#1565D8";
const RED = "#E31B23";
const GREEN = "#13A10E";
const DARK = "#1B1B1B";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Small helpers ────────────────────────────────────────────────────────
/** Calendar parts of a date as seen in India. */
const istParts = (d) => {
  const t = new Date(new Date(d).getTime() + 5.5 * 3600 * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
};
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
};
/** "2nd May 2026" */
export const longDate = (d) => {
  if (!d) return "-";
  const p = istParts(d);
  return `${p.d}${ordinal(p.d)} ${MONTHS[p.m]} ${p.y}`;
};
/** "27.08.2026" */
export const dotDate = (d) => {
  if (!d) return "-";
  const p = istParts(d);
  return `${String(p.d).padStart(2, "0")}.${String(p.m + 1).padStart(2, "0")}.${p.y}`;
};
/** "20,000" (Indian grouping, no decimals unless needed) */
export const money = (v) =>
  Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** Mr. / Ms. from the staff member's gender. */
export const honorific = (gender) => {
  const g = String(gender || "").toLowerCase();
  if (g === "male" || g === "m") return "Mr.";
  if (g === "female" || g === "f") return "Ms.";
  return "";
};
export const pronouns = (gender) => {
  const g = String(gender || "").toLowerCase();
  if (g === "female" || g === "f") return { he: "she", him: "her", his: "her", He: "She", His: "Her" };
  if (g === "male" || g === "m") return { he: "he", him: "him", his: "his", He: "He", His: "His" };
  return { he: "they", him: "them", his: "their", He: "They", His: "Their" };
};
/** "Mr. Mohammed Akram Idrisi" */
export const titledName = (staff) =>
  [honorific(staff?.gender), staff?.staffName || "Employee"].filter(Boolean).join(" ");

const isZap = (company) => /^\s*zap\b/i.test(company?.name || "");

// ── Tight underlines ─────────────────────────────────────────────────────
// pdfkit 0.20 counts `characterSpacing` twice when it sizes an underline
// (the line wrapper's width already includes it, then _fragment adds it
// again), and it also underlines trailing spaces at a line break. With the
// letter-spaced Carlito text that made every underline run well past the
// word ("Subject: Confirmation Letter ______"). This wraps _fragment so the
// line is exactly as wide as the visible text, and centred text is centred
// on its real width.
export const tightUnderlines = (doc) => {
  const orig = doc._fragment;
  if (typeof orig !== "function" || doc.__tightUnderlines) return doc;
  doc.__tightUnderlines = true;
  doc._fragment = function fragment(text, x, y, options = {}) {
    if (!options.underline) return orig.call(this, text, x, y, options);
    const str = `${text}`.replace(/\n/g, "");
    if (!str) return orig.call(this, text, x, y, options);
    const cs = options.characterSpacing || 0;
    const visible = str.replace(/\s+$/, "");
    const trueW = visible ? this.widthOfString(visible, options) : 0;
    // _fragment draws: textWidth + wordSpacing*(words-1) + cs*(len-1)
    const o = { ...options, textWidth: trueW - cs * (str.length - 1) };
    let nx = x;
    if (options.width && options.align === "center") {
      nx = x + (options.lineWidth || options.width) / 2 - trueW / 2;
      o.align = "left";
    }
    return orig.call(this, str, nx, y, o);
  };
  return doc;
};

// ── Fonts / page furniture ───────────────────────────────────────────────
const registerFonts = (doc) => {
  const reg = asset("Carlito-Regular.ttf");
  const bold = asset("Carlito-Bold.ttf");
  // Carlito = metric-compatible Calibri (the templates' font).
  doc.registerFont("Body", reg || "Helvetica");
  doc.registerFont("Body-Bold", bold || "Helvetica-Bold");
};

const logoSource = (company) => {
  const url = String(company?.logoUrl || "");
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(url);
  if (m) return Buffer.from(m[2], "base64");
  if (isZap(company) || !url) return isZap(company) ? asset("logo.jpg") : null;
  return null;
};

/** Company name in brand colours ("ZAP" = blue Z, red A, blue P). */
const brandName = (doc, company, x, y, size = 13, opts = {}) => {
  const name = company?.name || "Company";
  doc.font("Body-Bold").fontSize(size);
  if (isZap(company)) {
    const rest = name.replace(/^\s*zap/i, "");
    if (x === undefined) doc.fillColor(BRAND_BLUE).text("Z", { continued: true, ...opts });
    else doc.fillColor(BRAND_BLUE).text("Z", x, y, { continued: true, ...opts });
    doc.fillColor(RED).text("A", { continued: true });
    doc.fillColor(BRAND_BLUE).text(`P${rest}`, { continued: !!opts.continued });
  } else if (x === undefined) {
    doc.fillColor(BRAND_BLUE).text(name, opts);
  } else {
    doc.fillColor(BRAND_BLUE).text(name, x, y, opts);
  }
};

// Exact top / bottom bands cropped from the company's own letters (full
// page width, white above / below), so the artwork lines up 1:1 with the
// templates: bright-blue block top-left + navy bar, light wave at the bottom.
// The offer top band and the bottom band are cropped flush to their artwork
// (no white strip above / below), so they sit exactly on the page edge.
const BAND_SRC_W = 2068; // width of the cropped band images (px)
const BAND_TOP_H = 155; // px — offer letter top band (flush to the top edge)
const BAND_CONF_TOP_H = 200; // px — confirmation letter top band
const BAND_BOTTOM_H = 137; // px — bottom band (flush to the bottom edge)
const BLEED = 1; // pt drawn past the page edge so no hairline of white shows

const drawTopBand = (doc, variant = "offer") => {
  const W = doc.page.width;
  const file = variant === "confirmation" ? asset("band-top-conf.jpg") : asset("band-top-offer.jpg");
  const fallback = asset("band-top.jpg");
  if (file) {
    const h = (W * (variant === "confirmation" ? BAND_CONF_TOP_H : BAND_TOP_H)) / BAND_SRC_W;
    doc.image(file, 0, -BLEED, { width: W, height: h + BLEED });
  } else if (fallback) doc.image(fallback, 0, 0, { width: W });
};
const drawBottomBand = (doc) => {
  const W = doc.page.width;
  const H = doc.page.height;
  const file = asset("band-bottom-offer.jpg");
  if (file) {
    // Sits right on the bottom edge of the page — no white gap below it.
    const h = (W * BAND_BOTTOM_H) / BAND_SRC_W;
    doc.image(file, 0, H - h, { width: W, height: h + BLEED });
  } else if (asset("band-bottom.jpg")) {
    const h = (W * 163) / 2597;
    doc.image(asset("band-bottom.jpg"), 0, H - h, { width: W });
  }
};

// Big faded company logo behind the text (confirmation letter).
const drawWatermark = (doc, company) => {
  const logo = logoSource(company);
  if (!logo) return;
  const W = doc.page.width;
  doc.save();
  doc.opacity(0.16);
  const size = W - 40;
  doc.image(logo, 20, 420 - size / 2, { width: size });
  doc.restore();
};

const drawBands = (doc, { watermark = false, company, top = true, bottom = true, variant = "offer" } = {}) => {
  const { x, y } = doc;
  if (watermark) drawWatermark(doc, company);
  if (top) drawTopBand(doc, variant);
  if (bottom) drawBottomBand(doc);
  doc.x = x;
  doc.y = y;
};

const header = (doc, company, date, { variant = "offer" } = {}) => {
  const W = doc.page.width;
  const offerLogo = variant === "offer" && isZap(company) && !/^data:/i.test(String(company?.logoUrl || ""))
    ? asset("logo-offer.jpg")
    : null;
  if (offerLogo) {
    // Same spot as the template: logo left, its underline joins the rule.
    doc.image(offerLogo, 60, 84, { width: 112 });
  } else {
    const logo = logoSource(company);
    if (logo) doc.image(logo, 50, 60, { width: 110 });
    else brandName(doc, company, 55, 80, 20);
  }
  doc.font("Body").fontSize(10.5).fillColor(BLUE);
  doc.text(longDate(date), 300, variant === "offer" ? 122 : 100, { width: W - 355, align: "right" });
  if (company.email) doc.text(company.email, 300, variant === "offer" ? 136 : 114, { width: W - 355, align: "right" });
};

const ML = 70; // left margin of the body
const bodyWidth = (doc) => doc.page.width - ML * 2;

const para = (doc, text, { bold = false, color = BLUE, size = 11, gap = 10, align = "justify" } = {}) => {
  doc.font(bold ? "Body-Bold" : "Body").fontSize(size).fillColor(color);
  doc.text(text, ML, doc.y, { width: bodyWidth(doc), align, lineGap: 3.5 });
  doc.moveDown(gap / 12);
};

/** "Label:" underlined blue bold, then the text in normal weight. */
const labelled = (doc, label, text, { size = 10.5 } = {}) => {
  doc.font("Body-Bold").fontSize(size).fillColor(BRAND_BLUE);
  doc.text(`${label}:`, ML, doc.y, { width: bodyWidth(doc), continued: true, underline: true, lineGap: 4.5 });
  doc.text(" ", { continued: true, underline: false });
  // Non-breaking space: pdfkit drops a plain leading space after a chunk.
  doc.font("Body").fillColor(DARK).text(text, { underline: false, align: "justify" });
  doc.moveDown(0.35);
};

const signatureBlock = (doc, company, { team = "Admin & Accounts Team", signatory = "", closing = "Regards," } = {}) => {
  doc.moveDown(1.2);
  para(doc, closing, { bold: true, color: BLUE, gap: 16 });
  doc.moveDown(0.6);
  para(doc, team, { bold: true, color: RED, gap: 8 });
  if (signatory) para(doc, signatory, { bold: true, color: DARK, gap: 8 });
  brandName(doc, company, ML, doc.y + 4, 15);
};

/** Candidate details box (Aadhaar, PAN, mobile, e-mail, addresses). */
const detailsBox = (doc, staff, extra, { date, signatureBox = true } = {}) => {
  const x = ML - 15;
  const w = bodyWidth(doc) + 30;
  let y = doc.y + 6;
  if (y > doc.page.height - 260) {
    doc.addPage();
    y = doc.y;
  }
  doc.font("Body-Bold").fontSize(13).fillColor(BRAND_BLUE);
  doc.text(staff.staffName || "-", x, y, { width: w, align: "center", underline: true });
  y = doc.y + 10;

  const leftW = signatureBox ? w * 0.56 : w;
  const labelW = 88;
  const rows = [
    ["Aadhaar No.", extra.aadhaar || ""],
    ["PAN", extra.pan || ""],
    ["Mobile", staff.contactNo || ""],
    ["Email", staff.email || ""],
    ["Address\n[Permanent]", staff.address || ""],
    ["Address\n[Current]", staff.currentAddress ? staff.currentAddress : staff.address ? "Same As Above" : ""],
  ];
  const top = y;
  doc.lineWidth(0.8).strokeColor("#000");
  for (const [label, value] of rows) {
    doc.font("Body").fontSize(10);
    const h = Math.max(
      22,
      doc.heightOfString(label, { width: labelW - 8 }) + 10,
      doc.heightOfString(value || " ", { width: leftW - labelW - 10 }) + 10,
    );
    doc.rect(x, y, labelW, h).stroke();
    doc.rect(x + labelW, y, leftW - labelW, h).stroke();
    doc.font("Body-Bold").fillColor(DARK).text(label, x + 5, y + 5, { width: labelW - 8 });
    doc.font("Body").fillColor(label === "Email" ? BRAND_BLUE : DARK).text(value, x + labelW + 5, y + 5, {
      width: leftW - labelW - 10,
      underline: label === "Email" && !!value,
    });
    y += h;
  }
  if (signatureBox) {
    const sx = x + leftW + 10;
    const sw = w - leftW - 10;
    doc.lineWidth(0.8).strokeColor("#000").rect(sx, top, sw, y - top).stroke();
    doc.font("Body-Bold").fontSize(10).fillColor(DARK).text("Your Signature:", sx + 8, top + 18, { underline: true });
    // Blue down-arrow next to the label, then the blue box to sign in.
    const ax = sx + sw * 0.5;
    const ay = top + 12;
    doc.save();
    doc.fillColor("#4A90E2").strokeColor("#2F6DB5").lineWidth(0.6);
    doc.rect(ax - 4, ay, 8, 12).fillAndStroke();
    doc.polygon([ax - 9, ay + 12], [ax + 9, ay + 12], [ax, ay + 22]).fillAndStroke();
    doc.restore();
    const boxTop = top + 40;
    const boxH = Math.max(50, y - top - 110);
    doc.lineWidth(1.2).strokeColor("#4A90E2").rect(sx + 6, boxTop, sw - 12, boxH).stroke();
    doc.lineWidth(0.6).strokeColor("#555").moveTo(sx + 6, boxTop + boxH + 20).lineTo(sx + sw - 6, boxTop + boxH + 20).stroke();
    doc.font("Body-Bold").fontSize(10).fillColor(DARK).text("Date", sx + 8, y - 26);
    doc.text(`: ${date ? longDate(date) : ""}`, sx + 70, y - 26);
    doc.lineWidth(0.8).strokeColor("#000");
  }
  doc.x = ML;
  doc.y = y + 12;
};

const newDoc = (PDFDocument, { bands = true, watermark = false, company, variant = "offer" }) => {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 80, bottom: 80, left: ML, right: ML },
    bufferPages: false,
  });
  tightUnderlines(doc);
  registerFonts(doc);
  if (bands) {
    drawBands(doc, { watermark, company, variant });
    doc.on("pageAdded", () => drawBands(doc, { watermark, company, variant }));
  }
  return doc;
};

// ── Salary table rows for the probation period ───────────────────────────
// salaryAt(date) → monthly amount in force on that date (or null).
export const probationRows = (staff, salaryAt, entered = null) => {
  const months = Math.max(1, Math.min(12, Number(staff.probationMonths) || 3));
  const join = staff.date ? new Date(staff.date) : null;
  const rows = [];
  for (let i = 0; i < months; i++) {
    const from = i * 30 + 1;
    const to = (i + 1) * 30;
    const days = i === 0 ? "1 – 30/31" : `${from === 31 ? "31/32" : from} – ${to}`;
    const at = join ? new Date(join.getTime() + i * 30 * 86400000) : null;
    const typed = Array.isArray(entered) ? entered[i] : null;
    const typedNum = typed !== null && typed !== undefined && String(typed).trim() !== "" ? Number(String(typed).replace(/[^\d.]/g, "")) : null;
    const amt = typedNum ? typedNum : at ? salaryAt(at) : null;
    const note = i === months - 1 && months > 1 ? "[Subject to approval]" : "[As discussed]";
    rows.push([days, amt != null ? money(amt) : "As discussed", amt != null ? note : "", "Applicable post probation"]);
  }
  rows.push([`${months * 30 + 1} onwards`, "T.B.D.", "[Subject to appraisal]", "To Be Discussed/Declared"]);
  return rows;
};

const salaryTable = (doc, rows) => {
  const x = ML;
  const w = bodyWidth(doc);
  const cols = [w * 0.3, w * 0.38, w * 0.32];
  let y = doc.y + 4;
  if (y > doc.page.height - 70 - 22 * (rows.length + 1)) {
    doc.addPage();
    y = doc.y;
  }
  doc.lineWidth(0.7).strokeColor("#000");
  const cell = (cx, cw, text, { bold = false, align = "center" } = {}) => {
    doc.rect(cx, y, cw, 20).stroke();
    doc.font(bold ? "Body-Bold" : "Body").fontSize(10).fillColor(DARK).text(text, cx + 4, y + 5, { width: cw - 8, align });
  };
  cell(x, cols[0], "Days", { bold: true });
  cell(x + cols[0], cols[1], "Monthly renumeration", { bold: true });
  cell(x + cols[0] + cols[1], cols[2], "Annual Package", { bold: true });
  y += 20;
  for (const [days, amt, note, pkg] of rows) {
    cell(x, cols[0], days);
    doc.rect(x + cols[0], y, cols[1], 20).stroke();
    doc.font("Body-Bold").fontSize(10).fillColor(DARK).text(amt, x + cols[0] + 8, y + 5, { continued: !!note });
    if (note) doc.font("Body").text(` ${note}`);
    cell(x + cols[0] + cols[1], cols[2], pkg);
    y += 20;
  }
  doc.x = ML;
  doc.y = y + 12;
};

// ═════════════════════════════════════════════════════════════════════════
// OFFER LETTER
// ═════════════════════════════════════════════════════════════════════════
export const renderOfferLetter = (PDFDocument, data) => {
  const { staff, company, salaryAt = () => null, extra = {}, letterDate } = data;
  const doc = newDoc(PDFDocument, { company, variant: "offer" });
  const cname = company.name;
  const designation = staff.designation || "the designated role";
  const team = staff.department ? ` [${staff.department}]` : "";
  const probMonths = Math.max(1, Number(staff.probationMonths) || 3);
  const probDays = probMonths * 30;
  const pr = pronouns(staff.gender);

  // ── Page 1: cover letter ──
  header(doc, company, letterDate, { variant: "offer" });
  doc.moveTo(60, 173.6).lineTo(doc.page.width - 58, 173.6).lineWidth(1.3).strokeColor("#1F2A5C").stroke();
  doc.y = 214;
  para(doc, "Subject: Offer Letter [Probation]", { bold: true, gap: 4 });
  para(doc, `Dear ${titledName(staff)},`, { bold: true, gap: 30 });
  doc.moveDown(1.2);

  doc.font("Body").fontSize(11).fillColor(BLUE).text("@ ", ML, doc.y, { continued: true, lineGap: 3.5 });
  brandName(doc, company, undefined, undefined, 11, { continued: true });
  doc.font("Body").fontSize(11).fillColor(BLUE).text(
    `, we pride ourselves in providing innovative solutions tailored to the evolving needs of businesses and companies. Our services range from comprehensive consulting to cutting-edge software implementation, all designed to streamline client's requirements and boost efficiency.`,
    { width: bodyWidth(doc), align: "justify", lineGap: 3.5 },
  );
  doc.moveDown(1);
  doc.font("Body").fontSize(11).fillColor(BLUE).text("You have been selected for the post of a ", ML, doc.y, {
    width: bodyWidth(doc),
    continued: true,
    lineGap: 3.5,
    align: "justify",
  });
  doc.font("Body-Bold").fillColor(DARK).text(designation, { continued: true, underline: true });
  doc.text(" ", { continued: true, underline: false });
  doc.font("Body").fillColor(BLUE).text(
    `and would hereby like to resume your position for the same. We understand the importance of reliable partnerships and are looking forward to have the opportunity to collaborate with you as a part of our growing team.`,
    { underline: false },
  );
  doc.moveDown(1);
  para(doc, `We welcome you @ ${cname} and we look forward to the possibilities of working together.`);
  doc.y = Math.max(doc.y, 520);
  signatureBlock(doc, company);

  // ── Terms ──
  doc.addPage();
  doc.font("Body-Bold").fontSize(15).fillColor(BRAND_BLUE)
    .text(`Offer Letter – ${staff.staffName}`, ML, doc.y, { width: bodyWidth(doc), align: "center" });
  doc.moveDown(0.8);
  para(doc, `I.   Designation: ${designation}${team}`, { bold: true, color: BRAND_BLUE, size: 11.5, align: "left" });

  const schedule = staff.workSchedule
    ? `This is a full-time position requiring your time and attention. Your regular schedule will be: ${staff.workSchedule}. This work module is purely W.F.O. [Work from Office] and not hybrid under any sense, as no pandemic restrictions are applicable any more. Login time has to be maintained on all days.`
    : `This is a full-time position requiring your time and attention during the weekdays. Your regular weekly schedule will be Monday to Friday 09.30-18:00 hours. On all Saturday we have a week off. This work module is purely W.F.O. [Work from Office] and not hybrid under any sense, as no pandemic restrictions are applicable any more. Login time has to be maintained on all days.`;

  labelled(doc, "Job Title", `Your job profile will be as a ${designation}, and you will report to the Company's project head or the head of your team.`);
  labelled(doc, "Work Schedule", schedule);
  labelled(doc, "Employment Relationship", `This is an agreement between you and the Company on the terms of Employment with the Company, ${cname}.`);
  para(doc, `You are employed in the company full time. You will not be employed by any other Company or offer your services with or without pay to any physical person, legal entity, or public authority or to be occupied in your own business. No permission, whatsoever will be allowed by the company in any form or format.`, { color: DARK, size: 10.5, gap: 5 });
  labelled(doc, "Personal Relationship", `The company shall not tolerate any form of personal commitments, personal phone calls, [except for emergency] mobile communication/s, long duration on calls, watching movies/reels, during working hours or moving out of office for receiving calls. Any personal relationship shall not be entertained during working hours [time duration mentioned above]. Lunch time shall be of 30 minutes, taken anytime between 1.30 pm till 2.30pm.`);
  para(doc, `Maintain formal wear from Monday till Wednesday, however a casual clothing approach can be maintained on Friday.`, { color: DARK, size: 10.5, gap: 5 });
  labelled(doc, "Probation", `Your probation period will be ${probMonths} month${probMonths > 1 ? "s" : ""} from your date of joining${staff.date ? ` (${longDate(staff.date)})` : ""}, [i.e. ${probDays} days] after which your performance will be appraised. You will be confirmed about your appointment in writing on successful completion of the said probation period. Employee benefits will start upon successful completion of your ${probMonths}-month probation tenure.`);
  labelled(doc, "Tenure", `Your employment with the Company will be "at will," meaning that the Company may terminate your employment at any time and for any reason, with or without cause. In case if you wish to cease working for the company then you have to serve a one month's notice period. In any case if you fail to serve the notice period, one month's salary shall be forfeited [salary for the previous month worked for] and there will be monetary compensation levied on you if in case the company faces any financial loss pertaining to your actions or representation of any kind or for non-adherence of the guidelines set by the company's policies.`);
  para(doc, `Although your job duties, title, compensation and benefits, as well as the Company's personnel policies and procedures, may change from time to time, the nature of your employment may only be changed in an express written agreement signed by you and a duly authorized company's representative (other than you). Amendments to the above terms and conditions, if any, will be made in writing and communicated via your official mail ID given by the company.`, { color: DARK, size: 10.5, gap: 5 });
  doc.font("Body").fontSize(10.5).fillColor(DARK).text(
    `The tenure duration of being employed with the company will be minimum of six months which is also a bond which you agree and sign upon when you accept this offer letter. No resignation shall be accepted during six months from the date of confirmation; post probation period is over and your status as a confirmed employee starts.`,
    ML, doc.y, { width: bodyWidth(doc), underline: true, align: "justify", lineGap: 4.5 },
  );
  doc.moveDown(0.35);
  labelled(doc, "Salary", `The Company will pay you an annual package once your probation period is over and your status will change to being a confirmed employee of the company. During the probation period, your salary structure will be as mentioned in the table below. Your annual package shall be declared once your probation period is completed. It will be payable in accordance with the Company's standard payroll schedule, beginning the ${probDays + 1}${ordinal(probDays + 1)} day of your joining date, or the 1st day after probation period, and you will start to receive your first [post probation] pay between the 5th & the 10th days of every month. This salary will be subject to adjustment pursuant to the Company's employee compensation policies in effect at the time.`);
  para(doc, `During probation, your date of joining mentioned in this letter will be calculated as per the table below, means you will be paid for 30 days from date of joining and the calculation will be valid till ${probDays}${ordinal(probDays)} day of being employed. Salary will be credited to your bank account on the 5th day after the 30 day completion. i.e. For example, if you join on the 13th of Jan then the 30th day will be 12th /13th of Feb. Accordingly the salary will be credited after 5 days which appx shall be 17th/18th of Feb.`, { color: DARK, size: 10.5, gap: 5 });
  para(doc, `Upon confirmation post ${probDays}-day period, salary will be adjusted for the remaining days of that particular month till the end of the month, to bring it in accordance with 1st till 30th /31st condition.`, { color: DARK, size: 10.5, gap: 4 });
  salaryTable(doc, probationRows(staff, salaryAt, data.salaryRows));

  labelled(doc, "Physical and mental fitness", `This offer is subject to your being found medically fit at the time of your joining and remaining fit during the tenure of your employment with us. Please furnish any health issues, complications, or health related doctor's certificate/s as a part of your documentation. The Company reserves the right to terminate your employment should you be found unfit at any point in time during the course of your employment and under such circumstances, the notice period specified in Clause above shall not apply. Termination will be instant after proper handover. Salary clearance will be 15 days post termination.`);
  labelled(doc, "Tax Withholding", `All forms of compensation referred to in this letter agreement are subject to reduction to reflect applicable withholding and payroll taxes and other deductions required by law. TDS can be claimed when personal tax returns are filed if in case applicable.`);
  labelled(doc, "Tax Advice", `You are encouraged to obtain your own tax advice regarding your compensation from the Company. You agree that the Company does not have a duty to design its compensation policies in a manner that minimizes your tax liabilities, and you will not make any claim against the Company or its Board of Directors related to tax liabilities arising from your compensation.`);

  para(doc, "II.   Bonus/incentive potential", { bold: true, color: BRAND_BLUE, size: 11.5, align: "left", gap: 4 });
  para(doc, `In addition, post confirmation, you will be eligible for consideration of incentive bonus for each fiscal year of the Company. The bonus (if any) will be awarded based on objective or subjective criteria established by the Company's Chief Executive Officer and approved by the Company's Board of Directors. Bonus for the fiscal year [upon being a confirmed employee of the company] will be prorated, based on the number of days you are employed by the Company during that fiscal year. Any bonus for a fiscal year will be paid within 2 months after the close of that fiscal year, but only if you are still employed by the Company at the time of payment. The determinations of the Company's Board of Directors with respect to your bonus will be final and binding. The above-mentioned incentive bonus is applicable once you complete 3 years of service in the company, i.e. ${cname}.`, { color: DARK, size: 10.5 });

  para(doc, "III.   Employee benefits", { bold: true, color: BRAND_BLUE, size: 11.5, align: "left", gap: 4 });
  para(doc, `As a regular & confirmed employee of the Company, you will be eligible to participate in a number of Company-sponsored benefits. The Company offers a comprehensive employee benefits program, including:`, { color: DARK, size: 10.5, gap: 5 });
  labelled(doc, "Flexible Hours", `[Conditional] You will be eligible for work-from-home on certain days only if applicable. You can also occasionally adjust your daily working schedule upon manager's approval, should you have any personal commitments. In case of WFH [only on certain days/occasions], it is mandatory to attend the group call/meet, both in the morning and evening and give relevant updates with regards to the day's work. [WFH Subject to approval and prior intimation via mail only]`);
  labelled(doc, "Holiday/Leaves/Vacation Policy", `You will be eligible for a limited number of days of paid leave [PL] per year, subject to approval and a prior notice of 15 days in advance. Paid time off is additional to sick days [SL], casual leave [CL], bank holidays and days that the company does not operate. Impromptu or any public holidays shall be communicated on company's official chat group. Even post confirmation, salary shall be deducted if a mail is not sent${company.email ? ` on ${company.email}` : ""} prior to taking a leave. Company has to be informed about the leave/s taken in advance. In case of SL, mail can be sent on the next working day. More than two days of SL shall require a medical certificate.`);
  para(doc, `It is important to note that no leave/s of any kind will be granted during the probation period of ${probDays} days. Any work day off, leave [emergency, sick or casual] during the probation, shall be deducted from the salary. Entitlement of leave benefit/s will come in force, once the probation period is complete and the employee status changes from probationary to being confirmed. Leave structure breakdown like PL [paid leave], SL [sick leave], CL [casual leave], will be sent via official mail post conclusion of probation period.`, { color: DARK, size: 10.5, gap: 5 });
  labelled(doc, "Holiday/Leaves/Vacation Policy [Cont'd]", `Taking any leave like PL/SL/CL has to be communicated via official mail and D.M. Working on any given/declared holiday for company's work will automatically entitle a comp. off subject to prior notice of 7 days. Approval depends on the management which can alter the day of comp. off to other than requested, if in case the workload is urgent and important. Sandwich leave/s cannot be granted. In case of sandwich leave, if taken, then the entire duration shall be adjusted in the quota of balance leaves.`);

  para(doc, "IV.   Privacy and confidentiality agreements", { bold: true, color: BRAND_BLUE, size: 11.5, align: "left", gap: 4 });
  labelled(doc, "Privacy Agreement", `You are required to observe and uphold all of the Company's privacy policies and procedures as implemented or varied from time to time. Collection, storage, log files, domain and hosting details, passwords, confidential files, access to and dissemination of employee personal information will be in accordance with privacy legislation.`);
  labelled(doc, "Intellectual property rights non-disclosure and conflict of interest undertaking policy", `While you are employed at this Company, you will not engage in any other employment, consulting or other business activity (whether full-time or part-time) that would create a conflict of interest with the Company (e.g. freelance coding work for our competitor.) By signing this letter of agreement, you confirm that you have no contractual commitments or other legal obligations that would prohibit you from performing your duties for the Company.`);
  labelled(doc, "Cont'd.", `Furthermore, in course of your employment with the Company you will have access to certain confidential and proprietary information of the Company / parent company / subsidiaries and their activities. You will not at any time without the written consent of an authorized signatory of the Company disclose divulge or make public except on legal obligations any information related with Company's affairs or administration or research carried out whether the same may be confided to you or become known to you in the course of your employment or otherwise.`);
  para(doc, `Further if you conceive any new or advanced methods of improving process / formulae / systems in relation to the business / operation of the Company and / or any of its subsidiaries such development will be fully communicated to the Company and will remain sole right / property of the Company. The copyright for any software and other rights derived from the results of development and research through the research and development including without limitation right to apply for patent, copyright for the software technical documents and technical shall be that of Company. All work will be done from company's ID and nowhere will any personal ID come into use for any official work.`, { color: DARK, size: 10.5, gap: 5 });
  labelled(doc, "Fraud", `Any fraud/crime/blackmailing committed during the tenure, shall be dealt with severely and as per the law of the land. Strict action shall be initiated and law enforcement authorities will be involved in resolving the matter. It will be the sole responsibility of the employee and the company will not be responsible for the unlawful act committed. Any expenses towards the legal proceedings bearing out of the process shall be borne by the employee or deducted from the salary.`);
  labelled(doc, "Non-Disclosure", `You shall not disclose either during your employment or afterwards, by word of mouth or otherwise any information / details / particulars pertaining to any technical, scientific, administrative policy matter including financial details pay packages / profile of employees and / or any other matter concerning the management or any of its subsidiaries etc. and / or any other matter / information / knowledge and / or skill that you may come to know / acquire during your employment with the management / its subsidiaries / any other concern where you may be posted during your employment.`);
  para(doc, `In due course of your employment period, any communication with company's clients shall be strictly done using company's email ID and not personal IDs. In case of having a verbal communication with the company's clients, the minutes of the conversation shall be documented for further and future reference. In case of your absence or inability to communicate, the same can be taken up by another representative of the company.`, { color: DARK, size: 10.5 });

  para(doc, "V.   Termination conditions", { bold: true, color: BRAND_BLUE, size: 11.5, align: "left", gap: 4 });
  para(doc, `The Company reserves the right to terminate employment of any employee for just cause and investigation, at any time without notice and without payment [depending on the situation at that moment] in lieu of notice. The Company will be entitled to terminate your employment for any reason other than for just cause, upon providing to you such minimum notice as required by the policies of the company and by law.`, { color: DARK, size: 10.5, gap: 5 });
  para(doc, `Upon termination by either party, you will immediately hand over to the Company all property belonging to the Company and / or relating to its business, including but not limited to any Laptop, Mobile Instrument including SIM Card, Brochures, Specification, Formulae, Books, Documents, Market Data, Cost, Literature, Drawings, Effects or Records, etc. and you undertake of all such material before processing your final settlement.`, { color: DARK, size: 10.5, gap: 5 });
  para(doc, `Should any dispute arise out of or in relation to the Letter of offer or Letter of confirmation, the matters dealt with therein, the same shall be referred to arbitration by a sole arbitrator to be appointed by the HR Head. The arbitration shall be governed by the Arbitration and Conciliation Act, 1996 and the venue of the Arbitration shall select as per the law and relevant authorities.`, { color: DARK, size: 10.5, gap: 5 });
  para(doc, `The terms and conditions of this letter shall be governed and construed in accordance with the laws of India and subject to the provisions as to resort to arbitration, in the event of any dispute arising out of this letter, the Courts of law, only shall have jurisdiction. The invalidity or unenforceability of any part of this Contract shall not affect the binding effect of the rest of the letter.`, { color: DARK, size: 10.5 });

  para(doc, "VI.   Interpretation, Amendment and Enforcement", { bold: true, color: BRAND_BLUE, size: 11.5, align: "left", gap: 4 });
  para(doc, `This letter agreement supersedes and replaces any prior agreements, representations or understandings (whether written, oral, implied or otherwise) between you and the Company and constitute the complete agreement between you and the Company regarding the subject matter set forth herein. This letter agreement may not be amended or modified, except by an express written agreement signed by both you and a duly authorized officer of the Company.`, { color: DARK, size: 10.5, gap: 5 });
  para(doc, `You may indicate your agreement with these terms and accept this offer by signing and dating this agreement at the earliest. Upon your acceptance of this employment offer, ${cname} will provide you with the necessary paperwork and instructions.`, { color: DARK, size: 10.5 });
  doc.moveTo(ML, doc.y).lineTo(doc.page.width - ML, doc.y).lineWidth(0.6).strokeColor("#888").stroke();
  doc.moveDown(0.8);
  para(doc, `Please sign the enclosed copy of this letter and return it to us at the earliest to indicate your acceptance of this offer.`, { color: DARK, size: 10.5, gap: 5 });
  para(doc, `We take this opportunity to wish you many years of a rewarding and mutually enriching association with ${cname}.`, { color: DARK, size: 10.5, gap: 5 });
  para(doc, `We are confident you will be able to make a significant contribution to the success of the company and look forward to working with you.`, { color: DARK, size: 10.5, gap: 5 });
  para(doc, "Welcome Onboard…!!!", { bold: true, color: BRAND_BLUE, size: 10.5, gap: 5 });
  para(doc, "Sincerely,", { color: DARK, size: 10.5, gap: 2 });
  brandName(doc, company, ML, doc.y + 2, 15);
  doc.moveDown(0.6);
  doc.font("Body-Bold").fontSize(10).fillColor(DARK).text(`Date: ${longDate(letterDate)}`, ML, doc.y, { underline: true });
  doc.moveDown(1);
  detailsBox(doc, staff, extra, { date: letterDate });
  void pr;
  return doc;
};

// ═════════════════════════════════════════════════════════════════════════
// CONFIRMATION LETTER
// ═════════════════════════════════════════════════════════════════════════
export const renderConfirmationLetter = (PDFDocument, data) => {
  const { staff, company, salary, extra = {}, letterDate, signatory = "" } = data;
  // Positions / sizes taken from the company's own confirmation letter:
  // top band + logo + rule on page 1, faded logo watermark behind both
  // pages, bottom band + applicant details on page 2.
  const doc = newDoc(PDFDocument, { company, bands: false });
  drawBands(doc, { watermark: true, company, top: true, bottom: false, variant: "confirmation" });
  const W = doc.page.width;
  // Fixed-position layout: let text run close to the bottom band.
  doc.page.margins.bottom = 30;
  doc.on("pageAdded", () => { doc.page.margins.bottom = 30; });
  const designation = staff.designation || "-";
  const startDate = staff.confirmationDate || letterDate;
  const L = 79; // left edge of the body text
  const R = 552; // right edge
  const cs = (size) => size * 0.1; // the template's letter-spacing
  const t = (text, x, y, { font = "Body-Bold", size = 10, color = BLUE, ...o } = {}) => {
    doc.font(font).fontSize(size).fillColor(color);
    if (x === undefined) return doc.text(text, { characterSpacing: cs(size), ...o });
    return doc.text(text, x, y, { characterSpacing: cs(size), ...o });
  };

  // ── Header: logo left, date (02nd May 2026) + e-mail right, rule ──
  const confLogo = isZap(company) && !/^data:/i.test(String(company?.logoUrl || "")) ? asset("logo-conf.jpg") : null;
  if (confLogo) doc.image(confLogo, 82, 52, { width: 131 });
  else {
    const logo = logoSource(company);
    if (logo) doc.image(logo, 82, 52, { fit: [131, 92] });
    else brandName(doc, company, 82, 90, 20);
  }
  const dp = istParts(letterDate);
  const day = String(dp.d).padStart(2, "0");
  const sup = ordinal(dp.d);
  const rest = ` ${MONTHS[dp.m]} ${dp.y}`;
  doc.font("Body").fontSize(10);
  const dayW = doc.widthOfString(day, { characterSpacing: cs(10) });
  const restW = doc.widthOfString(rest, { characterSpacing: cs(10) });
  doc.font("Body").fontSize(6.5);
  const supW = doc.widthOfString(sup, { characterSpacing: cs(6.5) });
  let dx = R - (dayW + supW + restW);
  t(day, dx, 96, { font: "Body", size: 10, color: DARK, lineBreak: false });
  t(sup, dx + dayW, 95, { font: "Body", size: 6.5, color: DARK, lineBreak: false });
  t(rest, dx + dayW + supW, 96, { font: "Body", size: 10, color: DARK, lineBreak: false });
  if (company.email) t(company.email, 300, 110, { font: "Body", size: 10, color: DARK, width: R - 300, align: "right" });
  doc.moveTo(62, 128).lineTo(R, 128).lineWidth(1.4).strokeColor("#1F2A5C").stroke();

  // ── Body ──
  t("Subject: Confirmation Letter", L, 203, { width: R - L, align: "center", underline: true });
  t(`Dear ${titledName(staff)},`, 91, 226);

  t("We are pleased to confirm your employment with ", L, 263, { font: "Body-Bold", size: 11, width: 470, continued: true, lineGap: 3.5 });
  if (isZap(company)) {
    doc.fillColor(BRAND_BLUE).text("Z", { continued: true }).fillColor(RED).text("A", { continued: true })
      .fillColor(BRAND_BLUE).text(`P${company.name.replace(/^\s*zap/i, "")}`, { continued: true });
  } else doc.fillColor(BRAND_BLUE).text(company.name, { continued: true });
  doc.fillColor(BLUE).text(" as a ", { continued: true });
  doc.fillColor(DARK).text(designation, { continued: true, underline: true });
  doc.fillColor(BLUE).text(".", { underline: false });

  t("Your work status has been confirmed, and we are glad to have you join our team as a regular member.", L, Math.max(307, doc.y + 12), { size: 11, width: 472, lineGap: 2 });
  t("Below are the details of your employment:", L, Math.max(359, doc.y + 23));

  let y = Math.max(383, doc.y + 12);
  const row = (label, value, { underline = false } = {}) => {
    t(`-  ${label}`, L, y, { font: "Body", size: 10, width: 100, characterSpacing: 0.4 });
    t(":", 181, y, { font: "Body-Bold", size: 10 });
    t(value, 188, y, { font: "Body-Bold", size: 10, color: GREEN, width: 570 - 188, underline, lineGap: 2 });
    y = Math.max(doc.y + 10, y + 24);
  };
  row("Job Title", designation, { underline: true });
  row("Department", staff.department || "-");
  // Start date: "02nd May 2026" with a raised ordinal, as in the template.
  {
    const sp = istParts(startDate);
    t("-  Start Date", L, y, { font: "Body", size: 10, width: 100, characterSpacing: 0.4 });
    t(":", 181, y, { font: "Body-Bold", size: 10 });
    const dd = String(sp.d).padStart(2, "0");
    doc.font("Body-Bold").fontSize(10);
    const w1 = doc.widthOfString(dd, { characterSpacing: cs(10) });
    t(dd, 188, y, { size: 10, color: GREEN, lineBreak: false });
    doc.font("Body-Bold").fontSize(6.5);
    const w2 = doc.widthOfString(ordinal(sp.d), { characterSpacing: cs(6.5) });
    t(ordinal(sp.d), 188 + w1, y - 1, { size: 6.5, color: GREEN, lineBreak: false });
    t(` ${MONTHS[sp.m]} ${sp.y}`, 188 + w1 + w2, y, { size: 10, color: GREEN, lineBreak: false });
    y += 24;
  }
  row("Work Schedule", staff.workSchedule || "Full time / Mon till Saturday / 10.00 AM till 6.30 PM");
  row("Leaves", "As per company's leave policy [Will be conveyed on your mail ID]");
  row(
    "Salary",
    `${salary != null && salary !== "" ? `${money(salary)}/-` : "As discussed"} [Increments as per work review & performance every six months*]`,
  );
  y = Math.max(y + 2, 529);
  ["Q1: January 1st to June 30th.", "Q2: July 1st to December 31st.", "Performance review on the 25th day of June & December."].forEach((s) => {
    doc.circle(184, y + 4, 1.6).fill(BLUE);
    t(s, 198, y, { size: 7.6, width: R - 198 });
    y += 10.6;
  });

  y = Math.max(y + 20, 584);
  t("If you have any questions or concerns, please don't hesitate to reach out to us. We're excited to have you on board and look forward to seeing your contributions.", L, y, { width: 445, lineGap: 11.8 });
  y = Math.max(doc.y, 632);
  t("Please confirm your acceptance by signing and returning one copy of this letter to us.", L, y, { width: 480 });
  t("Regards,", L, y + 24);
  t("Admin Team", L, y + 55, { size: 11, color: RED });
  let by0 = y + 89;
  if (signatory) {
    t(signatory, L, by0, { color: DARK });
    by0 += 31;
  }
  brandName(doc, company, L, by0, 10, { characterSpacing: cs(10) });

  // ── Page 2: acceptance + applicant details ──
  doc.addPage();
  drawBands(doc, { watermark: true, company, top: false, bottom: true });
  const S = 9.7;
  t("Acceptance:", 77, 93, { size: S });
  t(`I, ${titledName(staff)}, accept the offer of employment with ${company.name} as outlined above.`, 77, 128, { size: S, width: 462, lineGap: 7 });
  [["Signature", 198], ["Date", 221]].forEach(([l, ly]) => {
    t(l, 77, ly, { size: S, color: DARK });
    t(":", 140, ly, { size: S, color: DARK });
    doc.moveTo(150, ly + 9).lineTo(340, ly + 9).lineWidth(0.7).strokeColor(DARK).stroke();
  });
  t("Welcome Onboard…!!!", 77, 257, { size: S, color: BRAND_BLUE });
  t("Sincerely,", 77, 284, { size: S, color: DARK });
  brandName(doc, company, 77, 310, 10.7, { characterSpacing: cs(10.7) });
  doc.moveTo(77, 339).lineTo(177, 339).lineWidth(0.6).strokeColor(DARK).stroke();
  t(`Date: ${longDate(letterDate).replace(/ (\d{4})$/, ", $1")}`, 77, 342, { size: S, color: DARK, underline: false });
  doc.moveTo(76, 361).lineTo(539, 361).lineWidth(3).strokeColor("#000").stroke();

  // Left column: applicant's name + sign + partner logos.
  const nm = staff.staffName || "-";
  doc.font("Times-Bold").fontSize(14).fillColor(DARK).text(nm, 77, 404, { width: 170, underline: true });
  t("[Applicant's Name]", 77, Math.max(426, doc.y + 2), { size: S, color: DARK });
  doc.moveTo(77, 519).lineTo(193, 519).lineWidth(0.6).strokeColor(DARK).stroke();
  t("[Applicant's Sign]", 77, 526, { size: S, color: DARK });
  t(`Date: ${longDate(letterDate).replace(/ (\d{4})$/, ", $1")}`, 77, 551, { size: S, color: DARK });
  doc.moveTo(76, 564).lineTo(249, 564).lineWidth(1.6).strokeColor(DARK).stroke();
  const partners = isZap(company) ? asset("partners.jpg") : null;
  if (partners) doc.image(partners, 92, 590, { width: 110 });

  // Right column: details box.
  const boxX = 255;
  const boxW = 534 - boxX;
  const boxTop = 404;
  doc.font("Times-Bold").fontSize(14).fillColor(DARK).text(nm, boxX + 6, 420, { width: boxW - 12, align: "center", underline: true });
  let by = Math.max(456, doc.y + 18);
  const rows = [
    ["Aadhaar No.", extra.aadhaar || ""],
    ["PAN", extra.pan || ""],
    ["Mobile", staff.contactNo || ""],
    ["Email", staff.email || ""],
    ["", ""],
    ["Address [Prmnt]", staff.address || ""],
    ["", ""],
    ["Address [Temp]", staff.currentAddress ? staff.currentAddress : staff.address ? "Same As Above" : ""],
  ];
  for (const [label, value] of rows) {
    if (!label) {
      by += 14;
      continue;
    }
    t(label, 277, by, { size: S, color: DARK, width: 82 });
    const ly = doc.y;
    t(`: ${value}`, 363, by, { size: S, color: DARK, width: 534 - 363 - 8, lineGap: 3 });
    by = Math.max(doc.y, ly, by + 12) + 3;
  }
  const boxBottom = Math.max(by + 30, 707);
  doc.lineWidth(0.8).strokeColor("#000").rect(boxX, boxTop, boxW, boxBottom - boxTop).stroke();
  return doc;
};

// ═════════════════════════════════════════════════════════════════════════
// JOINING LETTER (plain Times layout — positions taken from the company's
// own "Akram Joining Letter": logo top-left, name + address right, short
// rule, Times 11.7pt, page break before clause 4, signature on page 2)
// ═════════════════════════════════════════════════════════════════════════
export const renderJoiningLetter = (PDFDocument, data) => {
  const { staff, company, extra = {}, letterDate, trialDays = 10 } = data;
  const left = 70;
  const doc = tightUnderlines(new PDFDocument({ size: "A4", margins: { top: 126, bottom: 60, left, right: 69 } }));
  const W = doc.page.width;
  const right = 526;
  const width = right - left;
  const FS = 11.7;
  const role = staff.designation || "the offered role";
  const join = staff.date || letterDate;
  const numberWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  const daysWord = numberWords[trialDays] || String(trialDays);

  // Header: big logo left, company + address right, short grey rule.
  const logo = logoSource(company);
  if (logo) doc.image(logo, left, 60, { fit: [148, 148] });
  doc.font("Times-Bold").fontSize(FS).fillColor(DARK).text(company.name, W / 2, 108, { width: right - W / 2, align: "right" });
  if (company.address) {
    doc.font("Times-Roman").fontSize(FS).fillColor(DARK)
      .text(company.address, 220, 121, { width: right - 220, align: "right" });
  }
  doc.moveTo(181, 160).lineTo(415, 160).lineWidth(0.5).strokeColor("#BBBBBB").stroke();

  const p = (text, { bold = false, after = 4.5, underline = false } = {}) => {
    doc.font(bold ? "Times-Bold" : "Times-Roman").fontSize(FS).fillColor(DARK)
      .text(text, left, doc.y, { width, underline, lineGap: 0 });
    doc.y += after;
  };
  const heading = (text) => {
    doc.y += 9;
    p(text, { bold: true, after: 5 });
  };

  doc.y = 177;
  doc.font("Times-Bold").fontSize(FS).fillColor(DARK).text("Date: ", left, doc.y, { continued: true });
  doc.font("Times-Roman").text(dotDate(letterDate));
  doc.y += 9;
  p("To,", { after: 0 });
  p(staff.staffName || "-", { after: 0 });
  const addr = staff.currentAddress || staff.address;
  if (addr) p(addr, { after: 0 });
  doc.y = Math.max(doc.y + 14, 255);
  p("Subject: Joining Letter", { bold: true, underline: true, after: 14 });
  p(`Dear ${titledName(staff)},`, { after: 9.5 });

  doc.font("Times-Roman").fontSize(FS).fillColor(DARK)
    .text("With reference to your interview and subsequent discussions with ", left, doc.y, { width, continued: true, lineGap: 0 });
  doc.font("Times-Bold").text(company.name, { continued: true });
  doc.font("Times-Roman").text(
    ` ("the Company"), we are pleased to engage you on a trial basis for the role of ${role}${staff.department ? ` (${staff.department})` : ""}, subject to the terms set out below.`,
  );

  heading("1. Nature of Engagement");
  doc.font("Times-Roman").fontSize(FS).text(
    "This is a pure trial/assessment engagement and does not, by itself, constitute an offer of employment or a probationary appointment. You will be tested and assessed over a period of ",
    left, doc.y, { width, continued: true, lineGap: 0 },
  );
  doc.font("Times-Bold").text(`${trialDays} (${daysWord}) working days`, { continued: true });
  doc.font("Times-Roman").text(` commencing from ${dotDate(join)} ("the Trial Period").`);

  heading("2. Outcome of Assessment");
  p("At the end of the Assessment Period, the Company will review your performance and conduct. Based on this review:");
  p("(a) If your performance is found satisfactory and you are assessed as competent for the role, your engagement will be confirmed and you will continue with the Company on a probationary basis, on the standard terms of employment applicable to your role.");
  p("(b) If your performance is not found satisfactory, your engagement with the Company will stand terminated at the end of the Assessment Period without any further notice or liability on the part of the Company, save for payment of dues for the days actually worked, as set out below.", { after: 0 });

  heading("3. Compensation");
  const comp = data.salary != null
    ? `Your compensation shall be Rs. ${money(data.salary)}/- per month, as communicated to you at the time of your interview. For the Assessment Period, you will be paid on a pro-rata basis for the days actually worked, irrespective of the outcome of the assessment.`
    : "Your compensation shall be as per the terms communicated to you at the time of your interview. For the Assessment Period, you will be paid on a pro-rata basis for the days actually worked, irrespective of the outcome of the assessment.";
  p(comp, { after: 0 });

  // Page 2 — same as the template: clauses 4-5, signature, acknowledgement.
  doc.addPage();
  doc.y = 126;
  p("4. Nature of This Letter", { bold: true, after: 5 });
  p("This is a conditional joining letter only. It does not guarantee continued employment beyond the Assessment Period, and continuation of your engagement with the Company is entirely subject to satisfactory performance as assessed by the Company in its sole discretion.", { after: 23 });
  p("5. Acceptance", { bold: true, after: 5 });
  p("Please sign and return a copy of this letter as a token of your acceptance of the above terms and conditions.", { after: 14 });
  p("We look forward to working with you.", { after: 14 });
  p(`For ${company.name},`, { after: 0 });

  const sY = doc.y;
  const sig = isZap(company) ? asset("signature.jpg") : null;
  if (sig) doc.image(sig, left, sY + 2, { width: 59 });
  doc.moveTo(left, sY + 31).lineTo(left + 134, sY + 31).lineWidth(0.6).strokeColor(DARK).stroke();
  doc.font("Times-Roman").fontSize(FS).fillColor(DARK)
    .text(data.signatory ? data.signatory : "[Authorized Signatory]", left, sY + 34, { width });

  const aY = sY + 84;
  doc.moveTo(left, aY).lineTo(left + 234, aY).lineWidth(0.5).strokeColor("#BBBBBB").stroke();
  doc.font("Times-Bold").fontSize(FS).text("Acknowledged and Accepted:", left, aY + 23, { width });
  doc.font("Times-Roman").fontSize(FS).text("Signature: _______________________         Date: _______________", left, aY + 51, { width });
  doc.text(`Name: [${staff.staffName || "-"}]`, left, aY + 74, { width });
  void extra;
  return doc;
};
