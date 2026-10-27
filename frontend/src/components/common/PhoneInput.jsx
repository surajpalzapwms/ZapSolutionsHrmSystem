// src/components/common/PhoneInput.jsx
//
// Phone number field with a country picker (flag + calling code) for every
// country. India (+91) is selected by default.
//
// value    : stored string, "+91 9876543210" (old plain-digit values = India)
// onChange : called with an event-like { target: { name, value } } so it works
//            with useForm's handleChange and with `(e) => e.target.value`.
//
// Flags come from the `flag-icons` package (local SVGs), so they also show on
// Windows, where flag emojis render as plain letters ("IN").

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import "flag-icons/css/flag-icons.min.css";
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  formatPhone,
  getCountry,
  parsePhone,
} from "../../utils/phone";

const Flag = ({ iso, className = "" }) => (
  <span
    className={`fi fi-${String(iso).toLowerCase()} ${className}`}
    style={{ width: "1.25rem", height: "0.9375rem", flexShrink: 0 }}
    aria-hidden="true"
  />
);

const PhoneInput = ({
  label,
  name = "contactNo",
  value = "",
  onChange,
  error,
  placeholder = "Phone number",
  required = false,
  disabled = false,
  readOnly = false,
  className = "",
  ...props
}) => {
  const parsed = useMemo(() => parsePhone(value), [value]);
  const [country, setCountry] = useState(parsed.country);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);
  const searchRef = useRef(null);
  const lastValue = useRef(value);

  // Follow the value when the parent loads / switches records (edit another
  // staff member, reset the form...). An empty value only resets the country
  // when it just became empty — so picking a country before typing sticks.
  useEffect(() => {
    if (value) {
      // Same calling code = keep what the user picked (Canada vs US share +1).
      setCountry((prev) =>
        getCountry(prev).dial === getCountry(parsed.country).dial ? prev : parsed.country,
      );
    } else if (lastValue.current) {
      setCountry(DEFAULT_COUNTRY);
    }
    lastValue.current = value;
  }, [value, parsed.country]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const emit = (nextCountry, nextNational) => {
    onChange?.({ target: { name, value: formatPhone(nextCountry, nextNational), type: "tel" } });
  };

  const handleNumber = (e) => {
    // Digits only; a pasted "+971 50 123 4567" is split into code + number.
    const raw = e.target.value;
    if (raw.trim().startsWith("+")) {
      const p = parsePhone(raw);
      setCountry(p.country);
      emit(p.country, p.national.slice(0, 15));
      return;
    }
    emit(country, raw.replace(/\D/g, "").slice(0, 15));
  };

  const pick = (iso) => {
    setCountry(iso);
    setOpen(false);
    setQuery("");
    emit(iso, parsed.national);
  };

  const q = query.trim().toLowerCase().replace(/^\+/, "");
  const filtered = useMemo(() => {
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iso.toLowerCase() === q ||
        c.dial.startsWith(q),
    );
  }, [q]);

  const current = getCountry(country);
  const locked = disabled || readOnly;

  return (
    <div className="flex flex-col" ref={wrapRef}>
      {label && (
        <label className="text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        <div
          className={`flex rounded-md border bg-white ${
            error ? "border-red-500" : "border-gray-300"
          } ${locked ? "bg-gray-100" : ""} focus-within:ring-2 focus-within:ring-indigo-200 focus-within:border-indigo-500 ${className}`}
        >
          <button
            type="button"
            disabled={locked}
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 pl-3 pr-2 border-r border-gray-300 rounded-l-md hover:bg-gray-50 disabled:cursor-not-allowed focus:outline-none"
            aria-haspopup="listbox"
            aria-expanded={open}
            title={`${current.name} (+${current.dial})`}
          >
            <Flag iso={current.iso} />
            <span className="text-sm text-gray-700 tabular-nums">+{current.dial}</span>
            <ChevronDown size={14} className="text-gray-400" />
          </button>

          <input
            type="tel"
            inputMode="numeric"
            name={name}
            value={parsed.national}
            onChange={handleNumber}
            placeholder={placeholder}
            readOnly={readOnly}
            disabled={disabled}
            autoComplete="off"
            className="min-w-0 flex-1 px-3 py-2 rounded-r-md bg-transparent focus:outline-none"
            {...props}
          />
        </div>

        {open && (
          <div className="absolute left-0 top-full z-50 mt-1 w-72 max-w-[90vw] rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
              <Search size={14} className="text-gray-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (filtered[0]) pick(filtered[0].iso);
                  }
                }}
                placeholder="Search country or code"
                className="w-full text-sm focus:outline-none"
              />
            </div>

            <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-gray-400">No country found</li>
              )}
              {filtered.map((c) => (
                <li key={c.iso} role="option" aria-selected={c.iso === country}>
                  <button
                    type="button"
                    onClick={() => pick(c.iso)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-indigo-50 ${
                      c.iso === country ? "bg-indigo-50 font-medium" : ""
                    }`}
                  >
                    <Flag iso={c.iso} />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-gray-500 tabular-nums">+{c.dial}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
};

export default PhoneInput;
