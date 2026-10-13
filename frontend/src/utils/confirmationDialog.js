// src/utils/confirmationDialog.js
import Swal from "sweetalert2";

export const confirmDialog = ({
  title = "Are you sure?",
  text = "",
  icon = "warning",
  confirmButtonText = "Yes",
  cancelButtonText = "Cancel",
  showCancelButton = true,
} = {}) => {
  return Swal.fire({
    title,
    html: text,
    icon,
    showCancelButton,
    confirmButtonText,
    cancelButtonText,
    confirmButtonColor: "#4f46e5",
    cancelButtonColor: "#6b7280",
    reverseButtons: true,
  });
};

export const alertDialog = ({
  title = "",
  text = "",
  icon = "info",
  confirmButtonText = "OK",
} = {}) => {
  return Swal.fire({
    title,
    html: text,
    icon,
    confirmButtonText,
    confirmButtonColor: "#4f46e5",
  });
};

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const PURGE_LABELS = [
  ["attendance", "Attendance records"],
  ["leaves", "Leaves"],
  ["payrolls", "Payroll / salary slips"],
  ["basicPayroll", "Salary history"],
  ["advances", "Advances"],
  ["expenses", "Expenses"],
  ["resignations", "Resignations"],
  ["counseling", "Counseling sessions"],
  ["documents", "Documents & photo"],
  ["birthdayWishes", "Birthday wishes"],
  ["devices", "Registered devices"],
  ["loginAccounts", "Login account"],
];

/**
 * Strong confirmation before permanently deleting staff + all their data.
 * Shows what will be removed and makes the admin type `confirmWord`
 * (the staff ID / name, or "DELETE") before the button works.
 */
export const confirmStaffDelete = ({ names = [], counts = {}, confirmWord = "DELETE" } = {}) => {
  const rows = PURGE_LABELS.filter(([k]) => counts[k] > 0)
    .map(([k, label]) => `<li style="display:flex;justify-content:space-between;gap:16px"><span>${label}</span><b>${counts[k]}</b></li>`)
    .join("");
  const who = names.length === 1 ? `<b>${escapeHtml(names[0])}</b>` : `<b>${names.length}</b> staff members`;
  return Swal.fire({
    title: "Delete permanently?",
    icon: "warning",
    html: `
      <div style="text-align:left;font-size:14px;line-height:1.5">
        <p>This deletes ${who} and <b>all related data</b>. It cannot be undone.</p>
        <ul style="margin:10px 0;padding:10px 12px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;list-style:none">
          <li style="display:flex;justify-content:space-between;gap:16px"><span>Staff record & letters</span><b>${names.length}</b></li>
          ${rows}
        </ul>
        <p style="margin-top:8px">Type <b>${escapeHtml(confirmWord)}</b> to confirm:</p>
      </div>`,
    input: "text",
    inputAttributes: { autocapitalize: "off", autocomplete: "off" },
    showCancelButton: true,
    confirmButtonText: "Yes, delete everything",
    cancelButtonText: "Cancel",
    confirmButtonColor: "#DC2626",
    cancelButtonColor: "#6b7280",
    reverseButtons: true,
    focusCancel: true,
    preConfirm: (value) => {
      if (String(value || "").trim().toLowerCase() !== String(confirmWord).trim().toLowerCase()) {
        Swal.showValidationMessage(`Please type ${confirmWord} exactly`);
        return false;
      }
      return true;
    },
  });
};
