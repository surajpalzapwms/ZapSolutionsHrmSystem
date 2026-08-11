// src/components/common/Toast.jsx
import React, { useEffect } from "react";
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";

const Toast = ({ message, type = "info", onClose, duration = 3000 }) => {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const icons = {
    success: <CheckCircle className="text-green-500" size={20} />,
    error: <AlertCircle className="text-red-500" size={20} />,
    warning: <AlertTriangle className="text-yellow-500" size={20} />,
    info: <Info className="text-blue-500" size={20} />,
  };

  const bgColors = {
    success: "bg-green-50 border-green-200",
    error: "bg-red-50 border-red-200",
    warning: "bg-yellow-50 border-yellow-200",
    info: "bg-blue-50 border-blue-200",
  };

  return (
    <div className={`fixed top-4 right-4 z-[200] max-w-md w-full ${bgColors[type] || bgColors.info} border rounded-lg shadow-lg p-4 flex items-start gap-3 animate-slide-in`}>
      <div className="flex-shrink-0 mt-0.5">{icons[type] || icons.info}</div>
      <div className="flex-1 text-sm text-gray-800">{message}</div>
      <button onClick={onClose} className="flex-shrink-0 text-gray-400 hover:text-gray-600">
        <X size={16} />
      </button>
    </div>
  );
};

export default Toast;