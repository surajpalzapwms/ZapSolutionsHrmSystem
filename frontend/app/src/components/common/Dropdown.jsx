// src/components/common/Dropdown.jsx
import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

const Dropdown = ({
  value,
  onChange,
  options,
  placeholder = "Select...",
  disabled = false,
  error = false,
  className = "",
  label = "",
  required = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className={`flex flex-col ${className}`}>
      {label && (
        <label className="text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={`w-full border rounded-md px-3 py-2 text-left focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 flex justify-between items-center ${
            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-gray-400"
          } ${error ? "border-red-500" : "border-gray-300"} ${!value ? "text-gray-500" : "text-gray-900"}`}
        >
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
          {!disabled && (
            <span className="text-gray-400 flex-shrink-0 ml-2">
              {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </span>
          )}
        </button>
        {isOpen && !disabled && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-gray-500 text-sm">No options available</div>
            ) : (
              options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    if (!option.disabled) {
                      onChange(option.value);
                      setIsOpen(false);
                    }
                  }}
                  disabled={option.disabled}
                  className={`w-full px-3 py-2 text-left hover:bg-indigo-50 transition-colors ${
                    value === option.value ? "bg-indigo-100 text-indigo-900 font-medium" : "text-gray-900"
                  } ${option.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
};

export default Dropdown;