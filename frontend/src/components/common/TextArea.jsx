// src/components/common/TextArea.jsx
import React from "react";

const TextArea = ({
  label,
  name,
  value,
  onChange,
  error,
  placeholder = "",
  required = false,
  readOnly = false,
  disabled = false,
  rows = 3,
  className = "",
  ...props
}) => {
  return (
    <div className="flex flex-col">
      {label && (
        <label className="text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <textarea
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        rows={rows}
        className={`border rounded-md px-3 py-2 ${className} ${
          error ? "border-red-500" : "border-gray-300"
        } ${readOnly || disabled ? "bg-gray-100" : ""} focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500`}
        autoComplete="off"
        tabIndex={readOnly ? -1 : 0}
        {...props}
      />
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
};

export default TextArea;