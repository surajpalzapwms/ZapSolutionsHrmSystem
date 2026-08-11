// src/utils/numberUtils.js
export const formatCurrency = (amount) => {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num) || num === null || num === undefined) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
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