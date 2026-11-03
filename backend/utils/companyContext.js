// utils/companyContext.js
//
// Synchronous, in-memory view of every company's settings (timezone,
// weekly off days, currency ...). Companies are few and change rarely, so
// the whole list is kept in memory (services/companyRegistry.js fills it at
// start-up, after every company edit and every minute as a safety net).
//
// This lets code that runs deep inside attendance / payroll maths ask
// "what is the current company's timezone?" without an extra DB query and
// without passing the company around: the current company comes from the
// request context (utils/tenant.js).
//
// No model imports here on purpose — models import tenant.js, and this file
// must stay importable from anywhere without circular-import problems.

import { getCompanyId } from "./tenant.js";

const DEFAULT_TZ = process.env.DEFAULT_TIMEZONE || "Asia/Kolkata";
const DEFAULT_WEEKLY_OFF = [0]; // Sunday

const registry = new Map(); // companyId (string) -> plain company object

/** Replace the whole registry (used by services/companyRegistry.js). */
export const setCompanyRegistry = (companies) => {
  registry.clear();
  for (const c of companies) registry.set(String(c._id), c);
};

export const putCompanyInRegistry = (company) => {
  if (company?._id) registry.set(String(company._id), company);
};

export const removeCompanyFromRegistry = (id) => registry.delete(String(id));

export const getRegisteredCompany = (id) => (id ? registry.get(String(id)) || null : null);

export const listRegisteredCompanies = () => [...registry.values()];

/** The company of the current request / background job, or null. */
export const currentCompany = () => getRegisteredCompany(getCompanyId());

// ── Time zone ──────────────────────────────────────────────────────────────
export const companyTimeZone = (company = currentCompany()) => company?.timeZone || DEFAULT_TZ;

// Offset of an IANA zone from UTC in minutes, e.g. Asia/Kolkata -> 330,
// Asia/Riyadh -> 180. Gulf states and India have no daylight saving, so the
// offset never changes for them; it is still computed per hour so zones
// with DST stay right too.
const offsetCache = new Map(); // "tz|hourBucket" -> minutes
export const zoneOffsetMinutes = (timeZone, at = Date.now()) => {
  const t = typeof at === "number" ? at : new Date(at).getTime();
  const bucket = Math.floor((Number.isFinite(t) ? t : Date.now()) / 3600000);
  const key = `${timeZone}|${bucket}`;
  const hit = offsetCache.get(key);
  if (hit !== undefined) return hit;
  let minutes = 330;
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date(bucket * 3600000))
      .find((p) => p.type === "timeZoneName")?.value; // "GMT+05:30" / "GMT"
    const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(part || "");
    minutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
  } catch {
    /* unknown zone -> India default */
  }
  if (offsetCache.size > 2000) offsetCache.clear();
  offsetCache.set(key, minutes);
  return minutes;
};

/** Current company's UTC offset in milliseconds (replaces the old IST constant). */
export const tzOffsetMs = (at = Date.now()) => zoneOffsetMinutes(companyTimeZone(), at) * 60000;

/** "+05:30" / "+03:00" — for building "YYYY-MM-DDTHH:mm:ss+03:00" strings. */
export const tzOffsetString = (at = Date.now()) => {
  const min = zoneOffsetMinutes(companyTimeZone(), at);
  const sign = min < 0 ? "-" : "+";
  const abs = Math.abs(min);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
};

/** "YYYY-MM-DD" of `date` in the company's local time. */
export const companyDayKey = (date = new Date()) =>
  new Date(new Date(date).getTime() + tzOffsetMs(date)).toISOString().slice(0, 10);

// ── Weekly off days (0 = Sunday ... 6 = Saturday) ──────────────────────────
// India: Sunday. Saudi Arabia / Qatar: Friday + Saturday.
export const weeklyOffDays = (company = currentCompany()) =>
  Array.isArray(company?.weeklyOffDays) && company.weeklyOffDays.length
    ? company.weeklyOffDays
    : DEFAULT_WEEKLY_OFF;

export const isWeeklyOffDow = (dow) => weeklyOffDays().includes(dow);

/** Is this date (its UTC calendar day) a weekly off day? */
export const isWeeklyOffDate = (date) => isWeeklyOffDow(new Date(date).getUTCDay());

// ── Working time ("HH:mm", company's own time zone) ──────────────────────────
export const DEFAULT_WORK_START = "10:00";
export const DEFAULT_WORK_END = "18:30";
export const DEFAULT_SATURDAY_START = "10:00";
export const DEFAULT_SATURDAY_END = "16:00";
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hmOr = (v, fallback) => (typeof v === "string" && HM.test(v) ? v : fallback);

/** Office hours of the company: { start: "10:00", end: "18:30" }. */
export const companyWorkHours = (company = currentCompany()) => ({
  start: hmOr(company?.workStartTime, DEFAULT_WORK_START),
  end: hmOr(company?.workEndTime, DEFAULT_WORK_END),
});

/**
 * Short-Saturday rule of the company:
 * { enabled, start, end }. Unset = enabled 10:00 – 16:00 (old behaviour).
 * Never applies when Saturday is one of the company's weekly off days.
 */
export const companySaturdayRule = (company = currentCompany()) => {
  const offDays =
    Array.isArray(company?.weeklyOffDays) && company.weeklyOffDays.length
      ? company.weeklyOffDays
      : DEFAULT_WEEKLY_OFF;
  return {
    enabled: company?.shortSaturday !== false && !offDays.includes(6),
    start: hmOr(company?.saturdayStartTime, DEFAULT_SATURDAY_START),
    end: hmOr(company?.saturdayEndTime, DEFAULT_SATURDAY_END),
  };
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Sunday" / "Friday" — label shown for a weekly off day. */
export const weeklyOffName = (dow) => DAY_NAMES[dow] || "Weekly off";
