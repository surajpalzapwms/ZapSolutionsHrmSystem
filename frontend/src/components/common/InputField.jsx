// src/components/common/InputField.jsx
import React from "react";

const InputField = ({
  label,
  name,
  type = "text",
  value,
  onChange,
  error,
  placeholder = "",
  required = false,
  readOnly = false,
  disabled = false,
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
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
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

export default InputField;