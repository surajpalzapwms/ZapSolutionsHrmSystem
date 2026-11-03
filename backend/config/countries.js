// config/countries.js
//
// Country presets for white-label companies. When the super admin creates a
// company and picks a country, its currency, time zone, weekly off days,
// phone code and the list of registration / tax numbers shown on the
// company profile are filled in from here. Every value can still be changed
// afterwards on the company profile.
//
// Keep in sync with the frontend copy (src/utils/countries.js) — or let the
// frontend read it from GET /api/company/countries (it does).
//
// legalIds: the company registration / tax numbers for that country.
//   key      stored in company.legalIds[key]
//   label    shown on the form and printed on letters / payslips
//   pattern  optional check (a JS regex source string), applied when filled
//   hint     example / help text
//   print    true = printed in the footer of letters and payslips

export const COUNTRIES = {
  IN: {
    code: "IN",
    name: "India",
    currencyCode: "INR",
    numberLocale: "en-IN",
    timeZone: "Asia/Kolkata",
    weeklyOffDays: [0], // Sunday
    phoneCode: "+91",
    rtl: false,
    legalIds: [
      { key: "gstin", label: "GSTIN", pattern: "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$", hint: "22AAAAA0000A1Z5", print: true },
      { key: "pan", label: "PAN", pattern: "^[A-Z]{5}[0-9]{4}[A-Z]$", hint: "AAAAA0000A", print: true },
      { key: "tan", label: "TAN", pattern: "^[A-Z]{4}[0-9]{5}[A-Z]$", hint: "AAAA00000A" },
      { key: "cin", label: "CIN / LLPIN", pattern: "^([LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}|[A-Z]{3}-[0-9]{4})$", hint: "U72900MH2020PTC123456", print: true },
      { key: "pfCode", label: "EPF establishment code", hint: "MHBAN0012345000" },
      { key: "esicCode", label: "ESIC code", hint: "17 digits" },
      { key: "ptRegNo", label: "Professional tax reg. no." },
    ],
  },
  SA: {
    code: "SA",
    name: "Saudi Arabia",
    currencyCode: "SAR",
    numberLocale: "en-US",
    timeZone: "Asia/Riyadh",
    weeklyOffDays: [5, 6], // Friday + Saturday
    phoneCode: "+966",
    rtl: true,
    legalIds: [
      { key: "crNumber", label: "Commercial Registration (CR) No.", pattern: "^[0-9]{10}$", hint: "10 digits", print: true },
      { key: "unifiedNumber", label: "Unified national number (700)", pattern: "^7[0-9]{9}$", hint: "7XXXXXXXXX" },
      { key: "vatNumber", label: "VAT registration no. (TRN)", pattern: "^3[0-9]{13}3$", hint: "15 digits, starts and ends with 3", print: true },
      { key: "gosiNumber", label: "GOSI establishment no.", hint: "GOSI subscription number" },
      { key: "molNumber", label: "MHRSD / Qiwa establishment no.", hint: "e.g. 1-1234567" },
      { key: "muqeemNumber", label: "Muqeem account no." },
    ],
  },
  QA: {
    code: "QA",
    name: "Qatar",
    currencyCode: "QAR",
    numberLocale: "en-US",
    timeZone: "Asia/Qatar",
    weeklyOffDays: [5, 6], // Friday + Saturday
    phoneCode: "+974",
    rtl: true,
    legalIds: [
      { key: "crNumber", label: "Commercial Registration (CR) No.", pattern: "^[0-9]{1,8}$", hint: "up to 8 digits", print: true },
      { key: "establishmentId", label: "Establishment ID (Computer card)", hint: "e.g. 12-345678" },
      { key: "taxNumber", label: "Tax identification no. (TIN)", pattern: "^[0-9]{10}$", hint: "10 digits", print: true },
      { key: "tradeLicense", label: "Trade licence no." },
      { key: "wpsEmployerId", label: "WPS employer ID" },
    ],
  },
  AE: {
    code: "AE",
    name: "United Arab Emirates",
    currencyCode: "AED",
    numberLocale: "en-US",
    timeZone: "Asia/Dubai",
    weeklyOffDays: [0, 6], // Saturday + Sunday (since 2022)
    phoneCode: "+971",
    rtl: false,
    legalIds: [
      { key: "tradeLicense", label: "Trade licence no.", print: true },
      { key: "trnNumber", label: "Tax registration no. (TRN)", pattern: "^100[0-9]{12}$", hint: "15 digits, starts with 100", print: true },
      { key: "mohreNumber", label: "MOHRE establishment no." },
      { key: "wpsEmployerId", label: "WPS employer ID" },
    ],
  },
  OTHER: {
    code: "OTHER",
    name: "Other",
    currencyCode: "USD",
    numberLocale: "en-US",
    timeZone: "UTC",
    weeklyOffDays: [0],
    phoneCode: "",
    rtl: false,
    legalIds: [
      { key: "registrationNo", label: "Company registration no.", print: true },
      { key: "taxNumber", label: "Tax / VAT no.", print: true },
    ],
  },
};

// Staff identity documents. The database keeps the same three slots for
// every country (aadhaar / pan / electricity_bill) so nothing has to be
// migrated; only the labels and number checks change per country.
const STAFF_DOCS = {
  IN: {
    aadhaar: { label: "Aadhaar Card", numberLabel: "Aadhaar No.", pattern: "^[0-9]{12}$", hint: "12 digits", placeholder: "5742 7768 2776" },
    pan: { label: "PAN Card", numberLabel: "PAN", pattern: "^[A-Z]{5}[0-9]{4}[A-Z]$", hint: "ABCDE1234F", placeholder: "ABCDE1234F" },
    electricity_bill: { label: "Light Bill", numberLabel: "" },
  },
  SA: {
    aadhaar: { label: "Iqama / National ID", numberLabel: "Iqama / ID No.", pattern: "^[12][0-9]{9}$", hint: "10 digits, starts with 1 or 2", placeholder: "2123456789" },
    pan: { label: "Passport", numberLabel: "Passport No.", pattern: "^[A-Z0-9]{6,12}$", hint: "6-12 letters / digits", placeholder: "A1234567" },
    electricity_bill: { label: "National Address proof", numberLabel: "" },
  },
  QA: {
    aadhaar: { label: "QID (Qatar ID)", numberLabel: "QID No.", pattern: "^[0-9]{11}$", hint: "11 digits", placeholder: "28435601234" },
    pan: { label: "Passport", numberLabel: "Passport No.", pattern: "^[A-Z0-9]{6,12}$", hint: "6-12 letters / digits", placeholder: "A1234567" },
    electricity_bill: { label: "Address proof (Kahramaa bill)", numberLabel: "" },
  },
  AE: {
    aadhaar: { label: "Emirates ID", numberLabel: "Emirates ID No.", pattern: "^784[0-9]{12}$", hint: "15 digits, starts with 784", placeholder: "784198712345671" },
    pan: { label: "Passport", numberLabel: "Passport No.", pattern: "^[A-Z0-9]{6,12}$", hint: "6-12 letters / digits", placeholder: "A1234567" },
    electricity_bill: { label: "Address proof (DEWA / tenancy)", numberLabel: "" },
  },
  OTHER: {
    aadhaar: { label: "National ID", numberLabel: "ID No.", placeholder: "" },
    pan: { label: "Passport", numberLabel: "Passport No.", pattern: "^[A-Z0-9]{6,12}$", hint: "6-12 letters / digits" },
    electricity_bill: { label: "Address proof", numberLabel: "" },
  },
};
for (const [code, docs] of Object.entries(STAFF_DOCS)) COUNTRIES[code].staffDocs = docs;

/** Label / number rules of a staff document slot for a country. */
export const staffDocDef = (countryCode, type) => {
  const code = String(countryCode || "").toUpperCase();
  // India keeps Aadhaar / PAN; any other country without its own list gets the
  // neutral National ID / Passport labels (not Aadhaar).
  const docs = STAFF_DOCS[code] || (code && code !== "IN" ? STAFF_DOCS.OTHER : STAFF_DOCS.IN);
  return docs[type] || null;
};

export const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || "IN";

// ── Every other country ──────────────────────────────────────────────────
// Countries without a hand-made preset above (Oman, Kuwait, Bahrain, UK …)
// still work: currency, time zone, weekly off and phone code come from the
// tables below (same as the frontend's src/utils/countries.js).
const CURRENCY_BY_COUNTRY = Object.fromEntries(
  `AD:EUR AE:AED AF:AFN AG:XCD AL:ALL AM:AMD AO:AOA AR:ARS AT:EUR AU:AUD AZ:AZN BA:BAM BB:BBD BD:BDT BE:EUR BF:XOF
BG:BGN BH:BHD BI:BIF BJ:XOF BN:BND BO:BOB BR:BRL BS:BSD BT:BTN BW:BWP BY:BYN BZ:BZD CA:CAD CD:CDF CF:XAF CG:XAF
CH:CHF CI:XOF CL:CLP CM:XAF CN:CNY CO:COP CR:CRC CU:CUP CV:CVE CY:EUR CZ:CZK DE:EUR DJ:DJF DK:DKK DO:DOP DZ:DZD
EC:USD EE:EUR EG:EGP ER:ERN ES:EUR ET:ETB FI:EUR FJ:FJD FR:EUR GA:XAF GB:GBP GE:GEL GH:GHS GM:GMD GN:GNF GR:EUR
GT:GTQ GY:GYD HK:HKD HN:HNL HR:EUR HT:HTG HU:HUF ID:IDR IE:EUR IL:ILS IN:INR IQ:IQD IR:IRR IS:ISK IT:EUR JM:JMD
JO:JOD JP:JPY KE:KES KG:KGS KH:KHR KM:KMF KR:KRW KW:KWD KZ:KZT LA:LAK LB:LBP LK:LKR LR:LRD LS:LSL LT:EUR LU:EUR
LV:EUR LY:LYD MA:MAD MD:MDL ME:EUR MG:MGA MK:MKD ML:XOF MM:MMK MN:MNT MO:MOP MR:MRU MT:EUR MU:MUR MV:MVR MW:MWK
MX:MXN MY:MYR MZ:MZN NA:NAD NE:XOF NG:NGN NI:NIO NL:EUR NO:NOK NP:NPR NZ:NZD OM:OMR PA:PAB PE:PEN PG:PGK PH:PHP
PK:PKR PL:PLN PS:ILS PT:EUR PY:PYG QA:QAR RO:RON RS:RSD RU:RUB RW:RWF SA:SAR SC:SCR SD:SDG SE:SEK SG:SGD SI:EUR
SK:EUR SL:SLE SN:XOF SO:SOS SR:SRD SS:SSP SV:USD SY:SYP SZ:SZL TD:XAF TG:XOF TH:THB TJ:TJS TM:TMT TN:TND TR:TRY
TT:TTD TW:TWD TZ:TZS UA:UAH UG:UGX US:USD UY:UYU UZ:UZS VE:VES VN:VND YE:YER ZA:ZAR ZM:ZMW ZW:USD`
    .split(/\s+/)
    .map((p) => p.split(":")),
);
const FRI_SAT = ["SA", "QA", "KW", "BH", "OM", "EG", "IQ", "JO", "YE", "DZ", "LY", "SD", "BD", "IL", "PS", "SY"];
const WEEKLY_OFF = Object.fromEntries(FRI_SAT.map((c) => [c, [5, 6]]));
Object.assign(WEEKLY_OFF, { AE: [0, 6], AF: [5], IR: [5], DJ: [5], BN: [0, 5], SO: [5], MV: [5] });
const DEFAULT_TZ = {
  OM: "Asia/Muscat", KW: "Asia/Kuwait", BH: "Asia/Bahrain", PK: "Asia/Karachi", BD: "Asia/Dhaka",
  NP: "Asia/Kathmandu", LK: "Asia/Colombo", SG: "Asia/Singapore", EG: "Africa/Cairo", GB: "Europe/London",
  US: "America/New_York", CA: "America/Toronto", AU: "Australia/Sydney", CN: "Asia/Shanghai",
  RU: "Europe/Moscow", BR: "America/Sao_Paulo", ID: "Asia/Jakarta", JO: "Asia/Amman", IQ: "Asia/Baghdad",
  YE: "Asia/Aden", IR: "Asia/Tehran", MY: "Asia/Kuala_Lumpur", PH: "Asia/Manila", TR: "Europe/Istanbul",
};
const CALLING_CODE = {
  OM: "968", KW: "965", BH: "973", PK: "92", BD: "880", NP: "977", LK: "94", SG: "65", MY: "60", PH: "63",
  ID: "62", EG: "20", JO: "962", IQ: "964", YE: "967", IR: "98", LB: "961", SY: "963", TR: "90", GB: "44",
  US: "1", CA: "1", AU: "61", NZ: "64", DE: "49", FR: "33", IT: "39", ES: "34", NL: "31", CN: "86", JP: "81",
  KR: "82", RU: "7", ZA: "27", NG: "234", KE: "254", AF: "93", MV: "960", SD: "249", LY: "218", DZ: "213",
  MA: "212", TN: "216",
};
const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();
const genericCache = new Map();
const buildGenericCountry = (code) => {
  if (!/^[A-Z]{2}$/.test(code)) return null;
  let name = null;
  try {
    name = regionNames?.of(code);
  } catch {
    name = null;
  }
  if (!name || name === code || /unknown/i.test(name)) return null; // not a real country code
  let timeZone = DEFAULT_TZ[code] || null;
  if (!timeZone) {
    try {
      const loc = new Intl.Locale(`und-${code}`);
      const zones = loc.getTimeZones?.() || loc.timeZones;
      if (zones?.length) timeZone = zones[0];
    } catch {
      /* older runtime */
    }
  }
  return {
    code,
    name,
    currencyCode: CURRENCY_BY_COUNTRY[code] || "USD",
    numberLocale: "en-US",
    timeZone: timeZone && isValidTimeZone(timeZone) ? timeZone : "UTC",
    weeklyOffDays: WEEKLY_OFF[code] || [0],
    phoneCode: CALLING_CODE[code] ? `+${CALLING_CODE[code]}` : "",
    rtl: false,
    legalIds: COUNTRIES.OTHER.legalIds,
    staffDocs: STAFF_DOCS.OTHER,
  };
};

export const findCountry = (code) => {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  if (COUNTRIES[c]) return COUNTRIES[c];
  if (!genericCache.has(c)) genericCache.set(c, buildGenericCountry(c));
  return genericCache.get(c);
};

/** Frontend-friendly list. */
export const countryList = () => Object.values(COUNTRIES);

/** Is `tz` a time zone this server understands? */
export const isValidTimeZone = (tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
