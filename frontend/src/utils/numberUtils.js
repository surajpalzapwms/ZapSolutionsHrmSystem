// src/utils/numberUtils.js
import { formatMoney } from "./brand";

// Amount in the company's payroll currency (Settings → Payroll currency).
export const formatCurrency = (amount) => {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return formatMoney(Number.isNaN(num) || num == null ? 0 : num);
};

export const parseCurrency = (value) => {
  if (!value) return 0;
  const cleaned = String(value).replace(/[^0-9.]/g, "");
  return parseFloat(cleaned) || 0;
};

export const formatNumber = (num, decimals = 2) => {
  if (isNaN(num) || num === null || num === undefined) return "0";
  return Number(num).toFixed(decimals);
};

export const isNumeric = (value) => {
  return /^\d*\.?\d*$/.test(value);
};
