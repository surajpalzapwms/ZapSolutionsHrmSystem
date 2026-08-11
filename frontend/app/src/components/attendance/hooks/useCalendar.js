// src/components/attendance/hooks/useCalendar.js
import { useState, useMemo, useCallback } from "react";
import { getDaysInMonth, getMonthName, isSunday, isSaturday } from "../../../utils/dateUtils";

export const useCalendar = (initialDate = new Date()) => {
  const [current, setCurrent] = useState(initialDate);

  const year = current.getFullYear();
  const month = current.getMonth();

  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);

  const goToPrevMonth = useCallback(() => setCurrent(new Date(year, month - 1, 1)), [year, month]);
  const goToNextMonth = useCallback(() => setCurrent(new Date(year, month + 1, 1)), [year, month]);
  const goToToday = useCallback(() => setCurrent(new Date()), []);

  const monthLabel = `${getMonthName(month)} ${year}`;
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

  return {
    current,
    year,
    month,
    days,
    monthLabel,
    monthKey,
    goToPrevMonth,
    goToNextMonth,
    goToToday,
    isSunday,
    isSaturday,
  };
};
