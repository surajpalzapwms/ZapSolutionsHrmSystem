// src/utils/phone.js
//
// Phone numbers are stored as ONE string: "+<country code> <number>",
// e.g. "+91 9876543210" or "+971 501234567".
//
// Older records were saved as plain digits ("9876543210") with no country
// code. Those are read as Indian numbers, so nothing already in the database
// needs migrating.

import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  isValidPhoneNumber,
} from "libphonenumber-js";

export const DEFAULT_COUNTRY = "IN";

// Several countries share one calling code (+1, +7, +44 ...). When a stored
// number only tells us the code, this is the country we show for it.
const PREFERRED_COUNTRY_FOR_CODE = {
  1: "US",
  7: "RU",
  39: "IT",
  44: "GB",
  47: "NO",
  61: "AU",
  212: "MA",
  262: "RE",
  358: "FI",
  590: "GP",
  599: "CW",
};

// Small territories share their parent country's calling code and
// libphonenumber may report them for certain number ranges (e.g. +44 7911 is
// Guernsey). Show the main country so the flag matches what the user picked.
const COLLAPSE_TO_MAIN = {
  GG: "GB", JE: "GB", IM: "GB", AX: "FI", CX: "AU", CC: "AU",
  EH: "MA", SJ: "NO", BL: "GP", MF: "GP", BQ: "CW", YT: "RE",
};

const regionNames =
  typeof Intl !== "undefined" && Intl.DisplayNames
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

const countryName = (iso) => {
  try {
    return regionNames?.of(iso) || iso;
  } catch {
    return iso;
  }
};

// [{ iso: "IN", name: "India", dial: "91" }, ...] — India first (the default),
// everything else A–Z by name.
export const COUNTRIES = (() => {
  const list = getCountries().map((iso) => ({
    iso,
    name: countryName(iso),
    dial: String(getCountryCallingCode(iso)),
  }));
  list.sort((a, b) => a.name.localeCompare(b.name));
  const india = list.findIndex((c) => c.iso === DEFAULT_COUNTRY);
  if (india > 0) list.unshift(list.splice(india, 1)[0]);
  return list;
})();

const BY_ISO = Object.fromEntries(COUNTRIES.map((c) => [c.iso, c]));

export const getCountry = (iso) => BY_ISO[iso] || BY_ISO[DEFAULT_COUNTRY];

// Longest calling-code match for "+<digits>" values libphonenumber could not
// place on a country (e.g. an incomplete number).
const countryFromDigits = (digits) => {
  for (let len = 3; len >= 1; len -= 1) {
    const code = digits.slice(0, len);
    if (PREFERRED_COUNTRY_FOR_CODE[code]) {
      return { iso: PREFERRED_COUNTRY_FOR_CODE[code], national: digits.slice(len) };
    }
    const hit = COUNTRIES.find((c) => c.dial === code);
    if (hit) return { iso: hit.iso, national: digits.slice(len) };
  }
  return null;
};

// Stored string -> { country: "IN", national: "9876543210" }
export const parsePhone = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return { country: DEFAULT_COUNTRY, national: "" };

  if (raw.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(raw);
    if (parsed?.country) {
      return {
        country: COLLAPSE_TO_MAIN[parsed.country] || parsed.country,
        national: parsed.nationalNumber,
      };
    }
    const hit = countryFromDigits(raw.replace(/\D/g, ""));
    if (hit) return { country: hit.iso, national: hit.national };
  }

  // Old data: no country code -> India. Tidy the usual leftovers
  // ("09876543210", "919876543210") so they still validate.
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  return { country: DEFAULT_COUNTRY, national: digits };
};

// { country, national } -> stored string ("" when there is no number).
export const formatPhone = (country, national) => {
  const digits = String(national ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return `+${getCountry(country).dial} ${digits}`;
};

// Valid for the selected country (length + pattern rules of that country).
export const isValidPhone = (value) => {
  const { country, national } = parsePhone(value);
  if (!national) return false;
  return isValidPhoneNumber(national, country);
};
