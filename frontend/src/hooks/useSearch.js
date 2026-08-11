// src/hooks/useSearch.js
import { useState, useMemo, useCallback } from "react";

export const useSearch = (data, searchFields = [], initialTerm = "") => {
  const [searchTerm, setSearchTerm] = useState(initialTerm);

  const filteredData = useMemo(() => {
    if (!searchTerm.trim() || !data.length) return data;
    const term = searchTerm.toLowerCase().trim();
    return data.filter((item) => {
      return searchFields.some((field) => {
        const value = item[field];
        if (!value) return false;
        return String(value).toLowerCase().includes(term);
      });
    });
  }, [data, searchTerm, searchFields]);

  const clearSearch = useCallback(() => {
    setSearchTerm("");
  }, []);

  const setSearch = useCallback((term) => {
    setSearchTerm(term);
  }, []);

  return {
    searchTerm,
    setSearchTerm: setSearch,
    filteredData,
    clearSearch,
  };
};