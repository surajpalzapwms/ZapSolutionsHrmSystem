// src/components/common/Table.jsx
import React from "react";

const Table = ({
  columns,
  data,
  onRowClick,
  selectable = false,
  selected = [],
  onSelectAll,
  onSelectRow,
  emptyMessage = "No records found",
  className = "",
  rowClassName = "",
}) => {
  return (
    <div className={`overflow-x-auto shadow rounded-2xl border border-gray-200 ${className}`}>
      <table className="w-full border-collapse bg-white rounded-2xl overflow-hidden text-center">
        <thead className="bg-gray-100 text-gray-700 border-b">
          <tr>
            {selectable && (
              <th className="p-3 w-12">
                <input
                  type="checkbox"
                  checked={data.length > 0 && selected.length === data.length}
                  onChange={(e) => onSelectAll?.(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
              </th>
            )}
            {columns.map((col, idx) => (
              <th
                key={idx}
                className={`p-3 text-sm font-medium text-center ${col.className || ""}`}
                style={{ width: col.width }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className="p-8 text-center text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, idx) => (
              <tr
                key={row._id || idx}
                onClick={() => onRowClick?.(row)}
                className={`hover:bg-gray-50 ${idx < data.length - 1 ? "border-b" : ""} ${selected.some((s) => s.id === row._id) ? "bg-blue-50" : ""} ${rowClassName}`}
              >
                {selectable && (
                  <td className="p-3 w-12">
                    <input
                      type="checkbox"
                      checked={selected.some((s) => s.id === row._id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        onSelectRow?.(row);
                      }}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </td>
                )}
                {columns.map((col, colIdx) => (
                  <td
                    key={colIdx}
                    className={`p-3 text-sm text-center ${col.cellClassName || ""}`}
                  >
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export default Table;