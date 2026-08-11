// src/components/common/SearchBar.jsx
import React, { useRef } from "react";
import { Search, X } from "lucide-react";

const SearchBar = ({
  value,
  onChange,
  placeholder = "Search...",
  onClear,
  className = "",
  iconClick = null,
}) => {
  const inputRef = useRef(null);

  const handleIconClick = () => {
    inputRef.current?.focus();
    if (iconClick) iconClick();
  };

  return (
    <div className={`relative ${className}`}>
      <Search
        className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400 cursor-pointer"
        size={16}
        onClick={handleIconClick}
      />
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 transition-colors"
      />
      {value && onClear && (
        <button
          onClick={() => onClear()}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
};

export default SearchBar;