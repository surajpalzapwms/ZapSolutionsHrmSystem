// src/components/common/DatePicker.jsx
import React, { useState } from "react";
import ReactDatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Calendar } from "lucide-react";

const DatePicker = ({
  label,
  name,
  value,
  onChange,
  error,
  placeholder = "Select date",
  required = false,
  disabled = false,
  minDate,
  maxDate,
  dateFormat = "dd MMM yyyy",
  className = "",
}) => {
  // react-datepicker's own open/close state is normally driven by the
  // input's internal focus handling — clicking the field is supposed to
  // focus it and open the calendar. In practice, inside this Modal, the
  // field ends up focused (you see the blue ring) but the calendar panel
  // never appears, because the library's focus-based open logic doesn't
  // always fire reliably here. Controlling `open` ourselves and toggling
  // it from a click anywhere on the field removes that guesswork entirely.
  const [isOpen, setIsOpen] = useState(false);
  const selected = value ? new Date(value) : null;

  const openCalendar = () => {
    if (!disabled) setIsOpen(true);
  };

  const handleChange = (date) => {
    if (!date) {
      onChange?.({ target: { name, value: "" } });
    } else {
      const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .split("T")[0];
      onChange?.({ target: { name, value: iso } });
    }
    setIsOpen(false);
  };

  return (
    <div className="flex flex-col">
      {label && (
        <label className="text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      {/* onClick here (rather than only relying on the <input>'s own
          focus handler) means clicking anywhere in the box — the empty
          padding, the area around the calendar icon, not just the exact
          text cursor spot — opens the calendar. */}
      <div className="relative" onClick={openCalendar}>
        <ReactDatePicker
          selected={selected}
          onChange={handleChange}
          open={isOpen}
          onInputClick={openCalendar}
          onFocus={openCalendar}
          onClickOutside={() => setIsOpen(false)}
          shouldCloseOnSelect
          dateFormat={dateFormat}
          placeholderText={placeholder}
          disabled={disabled}
          minDate={minDate}
          maxDate={maxDate}
          // Reaching a date months/years back used to mean clicking the
          // "previous month" arrow over and over. These add a Month and a
          // Year <select> right in the calendar header — pick the year,
          // pick the month, done. "select" mode (rather than "scroll")
          // keeps them as instant dropdowns, and the year list covers a
          // wide, sensible range around today.
          showMonthDropdown
          showYearDropdown
          dropdownMode="select"
          yearDropdownItemNumber={30}
          scrollableYearDropdown
          wrapperClassName="block w-full"
          className={`border rounded-md pl-3 pr-9 py-2 w-full ${className} ${
            error ? "border-red-500" : "border-gray-300"
          } ${disabled ? "bg-gray-100" : ""} focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500`}
          autoComplete="off"
          // The calendar needs to escape the Modal's `overflow-y-auto`
          // body so its header/arrows never get clipped or scrolled out
          // of view. `position: fixed` (via popperProps.strategy) already
          // takes it out of that scroll container on its own — no portal
          // needed, which also removes a whole class of "renders into a
          // detached DOM node that doesn't show up" failure modes.
          popperProps={{ strategy: "fixed" }}
          popperPlacement="bottom-start"
          // The Modal's backdrop/content sits at z-[100]. react-datepicker's
          // popper defaults to a much lower z-index, so it could still
          // paint *behind* the modal. Bumping the popper's own z-index
          // above the modal (with !important, since the popper library's
          // own inline/base styles can otherwise win) fixes that.
          popperClassName="!z-[9999]"
        />
        <Calendar
          size={16}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
      </div>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
};

export default DatePicker;
