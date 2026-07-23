// src/hooks/usePagination.js
import { useState, useMemo, useCallback } from "react";

export const usePagination = (data, itemsPerPage = 10) => {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(data.length / itemsPerPage));
  }, [data, itemsPerPage]);

  const currentData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return data.slice(start, end);
  }, [data, currentPage, itemsPerPage]);

  const goToPage = useCallback(
    (page) => {
      const target = Math.max(1, Math.min(page, totalPages));
      setCurrentPage(target);
      return target;
    },
    [totalPages]
  );

  const nextPage = useCallback(() => {
    return goToPage(currentPage + 1);
  }, [currentPage, goToPage]);

  const prevPage = useCallback(() => {
    return goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  const reset = useCallback(() => {
    setCurrentPage(1);
  }, []);

  const getVisiblePages = useCallback(
    (maxVisible = 5) => {
      if (totalPages <= maxVisible) {
        return Array.from({ length: totalPages }, (_, i) => i + 1);
      }
      let pages = [];
      if (currentPage <= 3) {
        pages = [1, 2, 3, "...", totalPages];
      } else if (currentPage >= totalPages - 2) {
        pages = [1, "...", totalPages - 2, totalPages - 1, totalPages];
      } else {
        pages = [1, "...", currentPage, "...", totalPages];
      }
      return pages;
    },
    [currentPage, totalPages]
  );

  return {
    currentPage,
    setCurrentPage,
    totalPages,
    currentData,
    goToPage,
    nextPage,
    prevPage,
    reset,
    getVisiblePages,
  };
};