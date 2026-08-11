// src/components/common/Modal.jsx
import React, { useRef } from "react";
import { X } from "lucide-react";
import ReactDOM from "react-dom";

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = "max-w-md",
  actions,
  closeOnBackdrop = false,
  className = "",
  headerClassName = "",
  bodyClassName = "",
  footerClassName = "",
}) => {
  // Tracks whether the mousedown that started this click gesture was on the
  // backdrop itself. Without this, dragging to select text (or interacting
  // with a dropdown/date picker) inside the modal and releasing the mouse
  // over the backdrop would count as a backdrop click and close the modal.
  const mouseDownOnBackdrop = useRef(false);

  if (!isOpen) return null;

  const handleBackdropMouseDown = (e) => {
    mouseDownOnBackdrop.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e) => {
    if (closeOnBackdrop && e.target === e.currentTarget && mouseDownOnBackdrop.current) {
      onClose();
    }
    mouseDownOnBackdrop.current = false;
  };

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-[100] p-4"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div className={`bg-white w-full ${size} rounded-xl shadow-lg relative max-h-[90vh] flex flex-col ${className}`}>
        <div className={`flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 ${headerClassName}`}>
          <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={24} />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto p-6 ${bodyClassName}`}>{children}</div>
        {actions && (
          <div className={`flex justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50 flex-shrink-0 ${footerClassName}`}>
            {actions}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default Modal;