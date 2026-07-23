// src/utils/toast.js
import toast from "react-hot-toast";

export const showToast = (type, message) => {
  switch (type) {
    case "success":
      return toast.success(message);
    case "error":
      return toast.error(message);
    case "warning":
      return toast(message, { icon: "⚠️" });
    case "loading":
      return toast.loading(message);
    default:
      return toast(message);
  }
};

export const dismissToast = (id) => toast.dismiss(id);
