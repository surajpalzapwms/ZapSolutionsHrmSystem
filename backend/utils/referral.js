// utils/referral.js
// Referral organisation commission.
//
// A super admin can record that a staff member came through a referral
// organisation (e.g. "Navkar") and how much of the staff member's FIRST
// month salary goes to that organisation as commission (e.g. 25%).
//
// Worked example (20,000 basic, Navkar 25%, 2 unpaid leave days, 30-day month)
//   per-day salary       = 20,000 / 30          =    666.67
//   leave deduction      = 2 × 666.666…         =  1,333.33
//   referral commission  = 20,000 × 25%         =  5,000.00
//   salary payable       = 20,000 − 5,000 − 1,333.33 = 13,666.67
//
// The commission is a % of the FULL monthly basic salary and is taken ONLY
// from the staff member's FIRST month salary (the joining month) — never
// from any other month. It can never take the month below zero.

const IST_OFFSET_MS = 5.5 * 3600 * 1000;

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Date -> "YYYY-MM" for the INDIA calendar day (joining dates are often
// stored as IST midnight = previous day in UTC).
export const istPeriodOf = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};

// The referral on a staff doc, normalised. null when none is set.
export const getReferral = (employee) => {
  const r = employee?.referral;
  if (!r) return null;
  const organizationName = String(r.organizationName || "").trim();
  const percent = Number(r.commissionPercent) || 0;
  if (!organizationName || percent <= 0) return null;
  return {
    organizationName,
    percent,
    // Always the joining (first) month — no other month can be chosen.
    period: istPeriodOf(employee.date),
    remarks: r.remarks || "",
    updatedByName: r.updatedByName || "",
    updatedAt: r.updatedAt || null,
  };
};

// Commission for one payroll period ("YYYY-MM").
//   fullBasicSalary – the month's full basic salary (before leave deduction)
//   earned          – what the month pays before the commission (after leave
//                     and late deductions); the commission is capped at this
export const calculateReferralCommission = (employee, period, fullBasicSalary, earned) => {
  const referral = getReferral(employee);
  if (!referral || referral.period !== period) {
    return {
      referral,
      applies: false,
      commission: 0,
      commissionFull: 0,
      capped: false,
    };
  }
  const commissionFull = round2((Number(fullBasicSalary) || 0) * referral.percent / 100);
  const available = Math.max(0, Number(earned) || 0);
  const commission = Math.min(commissionFull, available);
  return {
    referral,
    applies: true,
    commission,
    commissionFull,
    capped: commission < commissionFull,
  };
};
