// src/components/common/Pagination.jsx
import React from "react";

const Pagination = ({
  currentPage,
  totalPages,
  onPageChange,
  showNumbers = true,
  className = "",
}) => {
  if (totalPages <= 1) return null;

  const getVisiblePages = () => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (currentPage <= 3) {
      return [1, 2, 3, "...", totalPages];
    }
    if (currentPage >= totalPages - 2) {
      return [1, "...", totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, "...", currentPage, "...", totalPages];
  };

  const visiblePages = getVisiblePages();

  return (
    <div className={`mt-4 p-5 flex justify-start gap-2 ${className}`}>
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 cursor-pointer"
      >
        Prev
      </button>
      {showNumbers &&
        visiblePages.map((page, index) => (
          <button
            key={index}
            onClick={() => typeof page === "number" && onPageChange(page)}
            disabled={page === "..."}
            className={`px-3 py-1 rounded w-10 text-center transition ${
              page === "..."
                ? "bg-gray-200 cursor-not-allowed"
                : currentPage === page
                ? "bg-indigo-600 text-white cursor-pointer"
                : "bg-gray-200 hover:bg-gray-300 cursor-pointer"
            }`}
          >
            {page}
          </button>
        ))}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 cursor-pointer"
      >
        Next
      </button>
    </div>
  );
};

export default Pagination;