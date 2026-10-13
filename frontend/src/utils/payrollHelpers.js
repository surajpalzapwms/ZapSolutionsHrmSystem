// src/utils/payrollHelpers.js

// ---------------------------------------------------------
// Pull an array out of any common API response shape
// ---------------------------------------------------------
export const extractList = (res) => {
  const d = res?.data ?? res;

  const candidates = [
    d,
    d?.data,
    d?.data?.data,
    d?.data?.records,
    d?.data?.payrolls,
    d?.data?.staff,
    d?.records,
    d?.payrolls,
    d?.payroll,
    d?.staff,
    d?.items,
    d?.results,
  ];

  return candidates.find(Array.isArray) ?? [];
};

export const toNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------
// Staff info from a payroll record.
// Works whether the record uses staffId or employeeId,
// and whether that field is an id string or a populated object.
// ---------------------------------------------------------
export const getStaffInfo = (record = {}) => {
  const populated =
    (record.staffId && typeof record.staffId === "object" && record.staffId) ||
    (record.employeeId && typeof record.employeeId === "object" && record.employeeId) ||
    (record.staff && typeof record.staff === "object" && record.staff) ||
    (record.employee && typeof record.employee === "object" && record.employee) ||
    {};

  const id =
    populated._id ||
    populated.id ||
    (typeof record.staffId === "string" ? record.staffId : null) ||
    (typeof record.employeeId === "string" ? record.employeeId : null) ||
    (typeof record.staff === "string" ? record.staff : null) ||
    (typeof record.employee === "string" ? record.employee : null) ||
    record.staffName ||
    "unknown";

  const name =
    record.staffName ||
    record.employeeName ||
    populated.staffName ||
    populated.name ||
    populated.fullName ||
    "Unknown";

  const code =
    record.staffCode ||
    record.employeeCode ||
    populated.staffCode ||
    populated.employeeCode ||
    // Staff model keeps the human-readable code in `staffId` (a string)
    (typeof populated.staffId === "string" ? populated.staffId : "") ||
    populated.code ||
    "";

  // Staff model stores the phone number as `contactNo`
  const contact =
    record.contactNo ||
    populated.contactNo ||
    record.contact ||
    record.phone ||
    populated.phone ||
    populated.mobile ||
    populated.contact ||
    populated.contactNumber ||
    "";

  const projectRaw = record.project || populated.project;
  const project =
    (projectRaw && typeof projectRaw === "object"
      ? projectRaw.name || projectRaw.projectName
      : projectRaw) ||
    record.projectName ||
    populated.projectName ||
    "";

  return { id: String(id), name, code, contact, project };
};

export const getStaffOptionId = (staff = {}) =>
  String(staff._id || staff.id || "");

export const getStaffOptionName = (staff = {}) =>
  staff.staffName || staff.name || staff.fullName || "Unnamed staff";

// ---------------------------------------------------------
// Payroll amounts
// ---------------------------------------------------------
export const getNet = (record = {}) =>
  toNum(record.netSalary ?? record.netPay ?? record.net ?? record.totalNet);

export const getPending = (record = {}) =>
  toNum(record.pendingAmount ?? record.pending ?? record.balance);

export const getStatus = (record = {}) =>
  record.status || (getPending(record) > 0 ? "Pending" : "Paid");

// Sortable time for a record's period (newest last)
export const getPeriodTime = (record = {}) => {
  const candidates = [
    record.periodDate,
    record.periodTo,
    record.period,
    record.month,
    record.createdAt,
  ];

  for (const value of candidates) {
    if (!value) continue;
    const t = new Date(value).getTime();
    if (Number.isFinite(t)) return t;
  }

  return 0;
};

export const getPeriodLabel = (record = {}) =>
  record.period || record.month || record.periodLabel || "-";

// ---------------------------------------------------------
// Trigger a CSV download from an API response
// ---------------------------------------------------------
export const downloadCsv = (data, filename) => {
  const blob =
    data instanceof Blob
      ? data
      : new Blob([data], { type: "text/csv;charset=utf-8;" });

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.URL.revokeObjectURL(url);
};