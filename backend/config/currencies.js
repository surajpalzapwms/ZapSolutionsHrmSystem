// config/currencies.js
//
// Currencies an admin can pick on the Settings page. Keep in sync with the
// frontend copy at src/utils/currencies.js.
//
//   code    ISO 4217 code (what is stored)
//   name    shown in the dropdown
//   locale  default number format (grouping), e.g. en-IN -> 1,00,000.00
//   pdf     text used in PDFs. PDF built-in fonts only draw basic Latin
//           characters, so symbols such as ₹ or ₦ cannot be printed there;
//           "Rs." / the ISO code is used instead.
export const CURRENCIES = [
  { code: "INR", name: "Indian Rupee", locale: "en-IN", pdf: "Rs." },
  { code: "USD", name: "US Dollar", locale: "en-US", pdf: "$" },
  { code: "EUR", name: "Euro", locale: "de-DE", pdf: "EUR" },
  { code: "GBP", name: "British Pound", locale: "en-GB", pdf: "GBP" },
  { code: "AED", name: "UAE Dirham", locale: "en-AE", pdf: "AED" },
  { code: "SAR", name: "Saudi Riyal", locale: "en-SA", pdf: "SAR" },
  { code: "QAR", name: "Qatari Riyal", locale: "en-QA", pdf: "QAR" },
  { code: "KWD", name: "Kuwaiti Dinar", locale: "en-KW", pdf: "KWD" },
  { code: "OMR", name: "Omani Rial", locale: "en-OM", pdf: "OMR" },
  { code: "BHD", name: "Bahraini Dinar", locale: "en-BH", pdf: "BHD" },
  { code: "PKR", name: "Pakistani Rupee", locale: "en-PK", pdf: "PKR" },
  { code: "BDT", name: "Bangladeshi Taka", locale: "en-BD", pdf: "BDT" },
  { code: "LKR", name: "Sri Lankan Rupee", locale: "en-LK", pdf: "LKR" },
  { code: "NPR", name: "Nepalese Rupee", locale: "en-NP", pdf: "NPR" },
  { code: "SGD", name: "Singapore Dollar", locale: "en-SG", pdf: "S$" },
  { code: "MYR", name: "Malaysian Ringgit", locale: "ms-MY", pdf: "MYR" },
  { code: "IDR", name: "Indonesian Rupiah", locale: "id-ID", pdf: "IDR" },
  { code: "PHP", name: "Philippine Peso", locale: "en-PH", pdf: "PHP" },
  { code: "THB", name: "Thai Baht", locale: "th-TH", pdf: "THB" },
  { code: "JPY", name: "Japanese Yen", locale: "ja-JP", pdf: "JPY" },
  { code: "CNY", name: "Chinese Yuan", locale: "zh-CN", pdf: "CNY" },
  { code: "AUD", name: "Australian Dollar", locale: "en-AU", pdf: "A$" },
  { code: "NZD", name: "New Zealand Dollar", locale: "en-NZ", pdf: "NZ$" },
  { code: "CAD", name: "Canadian Dollar", locale: "en-CA", pdf: "C$" },
  { code: "CHF", name: "Swiss Franc", locale: "de-CH", pdf: "CHF" },
  { code: "ZAR", name: "South African Rand", locale: "en-ZA", pdf: "ZAR" },
  { code: "NGN", name: "Nigerian Naira", locale: "en-NG", pdf: "NGN" },
  { code: "KES", name: "Kenyan Shilling", locale: "en-KE", pdf: "KES" },
  { code: "EGP", name: "Egyptian Pound", locale: "en-EG", pdf: "EGP" },
  { code: "BRL", name: "Brazilian Real", locale: "pt-BR", pdf: "BRL" },
  { code: "MXN", name: "Mexican Peso", locale: "es-MX", pdf: "MXN" },
];

export const DEFAULT_CURRENCY = "INR";

export const findCurrency = (code) =>
  CURRENCIES.find((c) => c.code === String(code || "").toUpperCase()) || null;

// Number formats an admin can choose independently of the currency.
export const NUMBER_FORMATS = [
  { locale: "en-IN", label: "Indian — 1,00,000.00" },
  { locale: "en-US", label: "International — 100,000.00" },
  { locale: "de-DE", label: "European — 100.000,00" },
  { locale: "fr-FR", label: "French — 100 000,00" },
];
