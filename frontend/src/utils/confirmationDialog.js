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
