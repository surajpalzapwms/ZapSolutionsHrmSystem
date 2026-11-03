// src/utils/countries.js
//
// Full country list for the "Add company" / Settings country dropdowns.
//
// The backend (/api/company/countries) only knows a few presets (India, Saudi
// Arabia, Qatar, Other …). This builds an entry for EVERY country and then
// lets the backend presets override theirs, so the extra countries get a
// sensible currency / time zone / weekly-off default and the three real
// presets keep their legal-ID fields.
//
//   entry = { code, name, phoneCode, currencyCode, numberLocale, timeZone,
//             weeklyOffDays, legalIds }

import { getCountries, getCountryCallingCode } from "libphonenumber-js";

const regionNames =
  typeof Intl !== "undefined" && Intl.DisplayNames ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

const nameOf = (iso) => {
  try {
    return regionNames?.of(iso) || iso;
  } catch {
    return iso;
  }
};

// ISO country -> currency (ISO 4217). Countries not listed fall back to USD.
const CURRENCY_BY_COUNTRY = `
AD:EUR AE:AED AF:AFN AG:XCD AI:XCD AL:ALL AM:AMD AO:AOA AR:ARS AS:USD AT:EUR AU:AUD AW:AWG AX:EUR AZ:AZN
BA:BAM BB:BBD BD:BDT BE:EUR BF:XOF BG:BGN BH:BHD BI:BIF BJ:XOF BL:EUR BM:BMD BN:BND BO:BOB BQ:USD BR:BRL BS:BSD BT:BTN BW:BWP BY:BYN BZ:BZD
CA:CAD CC:AUD CD:CDF CF:XAF CG:XAF CH:CHF CI:XOF CK:NZD CL:CLP CM:XAF CN:CNY CO:COP CR:CRC CU:CUP CV:CVE CW:ANG CX:AUD CY:EUR CZ:CZK
DE:EUR DJ:DJF DK:DKK DM:XCD DO:DOP DZ:DZD EC:USD EE:EUR EG:EGP EH:MAD ER:ERN ES:EUR ET:ETB FI:EUR FJ:FJD FK:FKP FM:USD FO:DKK FR:EUR
GA:XAF GB:GBP GD:XCD GE:GEL GF:EUR GG:GBP GH:GHS GI:GIP GL:DKK GM:GMD GN:GNF GP:EUR GQ:XAF GR:EUR GT:GTQ GU:USD GW:XOF GY:GYD
HK:HKD HN:HNL HR:EUR HT:HTG HU:HUF ID:IDR IE:EUR IL:ILS IM:GBP IN:INR IO:USD IQ:IQD IR:IRR IS:ISK IT:EUR
JE:GBP JM:JMD JO:JOD JP:JPY KE:KES KG:KGS KH:KHR KI:AUD KM:KMF KN:XCD KP:KPW KR:KRW KW:KWD KY:KYD KZ:KZT
LA:LAK LB:LBP LC:XCD LI:CHF LK:LKR LR:LRD LS:LSL LT:EUR LU:EUR LV:EUR LY:LYD
MA:MAD MC:EUR MD:MDL ME:EUR MF:EUR MG:MGA MH:USD MK:MKD ML:XOF MM:MMK MN:MNT MO:MOP MP:USD MQ:EUR MR:MRU MS:XCD MT:EUR MU:MUR MV:MVR MW:MWK MX:MXN MY:MYR MZ:MZN
NA:NAD NC:XPF NE:XOF NF:AUD NG:NGN NI:NIO NL:EUR NO:NOK NP:NPR NR:AUD NU:NZD NZ:NZD OM:OMR
PA:PAB PE:PEN PF:XPF PG:PGK PH:PHP PK:PKR PL:PLN PM:EUR PR:USD PS:ILS PT:EUR PW:USD PY:PYG QA:QAR
RE:EUR RO:RON RS:RSD RU:RUB RW:RWF SA:SAR SB:SBD SC:SCR SD:SDG SE:SEK SG:SGD SH:SHP SI:EUR SJ:NOK SK:EUR SL:SLE SM:EUR SN:XOF SO:SOS SR:SRD SS:SSP ST:STN SV:USD SX:ANG SY:SYP SZ:SZL
TC:USD TD:XAF TG:XOF TH:THB TJ:TJS TK:NZD TL:USD TM:TMT TN:TND TO:TOP TR:TRY TT:TTD TV:AUD TW:TWD TZ:TZS
UA:UAH UG:UGX US:USD UY:UYU UZ:UZS VA:EUR VC:XCD VE:VES VG:USD VI:USD VN:VND VU:VUV WF:XPF WS:WST YE:YER YT:EUR ZA:ZAR ZM:ZMW ZW:USD XK:EUR
`
  .trim()
  .split(/\s+/)
  .reduce((m, p) => {
    const [c, cur] = p.split(":");
    m[c] = cur;
    return m;
  }, {});

// Weekly off days (0 = Sunday). Everything else defaults to Sunday only.
const FRI_SAT = ["AE_NO", "SA", "QA", "KW", "BH", "OM", "EG", "IQ", "JO", "YE", "DZ", "LY", "SD", "BD", "IL", "PS", "SY", "MV"];
const WEEKLY_OFF = {};
FRI_SAT.forEach((c) => (WEEKLY_OFF[c] = [5, 6]));
WEEKLY_OFF.AE = [0, 6]; // UAE: Sat + Sun since 2022
WEEKLY_OFF.AF = [5];
WEEKLY_OFF.IR = [5];
WEEKLY_OFF.DJ = [5];
WEEKLY_OFF.BN = [0, 5];
WEEKLY_OFF.SO = [5];
WEEKLY_OFF.MV = [5];
WEEKLY_OFF.PK = [0];

const DEFAULT_TZ = {
  IN: "Asia/Kolkata", SA: "Asia/Riyadh", QA: "Asia/Qatar", AE: "Asia/Dubai", KW: "Asia/Kuwait", BH: "Asia/Bahrain",
  OM: "Asia/Muscat", PK: "Asia/Karachi", BD: "Asia/Dhaka", NP: "Asia/Kathmandu", LK: "Asia/Colombo", SG: "Asia/Singapore",
  EG: "Africa/Cairo", GB: "Europe/London", US: "America/New_York", CA: "America/Toronto", AU: "Australia/Sydney",
  CN: "Asia/Shanghai", RU: "Europe/Moscow", BR: "America/Sao_Paulo", MX: "America/Mexico_City", AR: "America/Argentina/Buenos_Aires",
  ID: "Asia/Jakarta", MN: "Asia/Ulaanbaatar", KZ: "Asia/Almaty", CD: "Africa/Kinshasa", EC: "America/Guayaquil",
  PT: "Europe/Lisbon", ES: "Europe/Madrid", NZ: "Pacific/Auckland", FM: "Pacific/Pohnpei", UM: "Pacific/Wake",
};

const timeZoneOf = (iso) => {
  if (DEFAULT_TZ[iso]) return DEFAULT_TZ[iso];
  try {
    const loc = new Intl.Locale(`und-${iso}`);
    const zones = loc.getTimeZones?.() || loc.timeZones;
    if (zones?.length) return zones[0];
  } catch {
    /* older browsers */
  }
  return "UTC";
};

const localeOf = (iso) => {
  if (iso === "IN") return "en-IN";
  const l = `en-${iso}`;
  try {
    return Intl.NumberFormat.supportedLocalesOf([l]).length ? l : "en-US";
  } catch {
    return "en-US";
  }
};

const build = (iso) => ({
  code: iso,
  name: nameOf(iso),
  phoneCode: `+${getCountryCallingCode(iso)}`,
  currencyCode: CURRENCY_BY_COUNTRY[iso] || "USD",
  numberLocale: localeOf(iso),
  timeZone: timeZoneOf(iso),
  weeklyOffDays: WEEKLY_OFF[iso] || [0],
  legalIds: [],
});

// Every country, A–Z (India, Saudi Arabia, Qatar first because they are the
// main markets).
const PINNED = ["IN", "SA", "QA", "AE"];
export const ALL_COUNTRIES = getCountries()
  .map(build)
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * mergeCountries(serverList) -> full list. Backend entries win for the codes
 * they know (they carry the legal-ID rules); every other country is generated.
 * Backend-only codes such as "OTHER" are kept at the end.
 */
export const mergeCountries = (serverList = []) => {
  const server = new Map((serverList || []).map((c) => [c.code, c]));
  const merged = ALL_COUNTRIES.map((c) => (server.has(c.code) ? { ...c, ...server.get(c.code) } : c));
  const extra = (serverList || []).filter((c) => !ALL_COUNTRIES.some((a) => a.code === c.code));
  const pinned = PINNED.map((code) => merged.find((c) => c.code === code)).filter(Boolean);
  const rest = merged.filter((c) => !PINNED.includes(c.code));
  return [...pinned, ...rest, ...extra];
};

export const countryNameOf = (code) => (code && code !== "OTHER" ? nameOf(code) : "Other");