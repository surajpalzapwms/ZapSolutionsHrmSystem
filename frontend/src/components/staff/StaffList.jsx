// src/components/staff/StaffList.jsx
import React from "react";
import { Pencil, Trash2, Power, History, FileText } from "lucide-react";
import Table from "../common/Table";
import Pagination from "../common/Pagination";
import StaffAvatar from "../common/StaffAvatar";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";
import { getDisplayStatus, hasLeftOrganization } from "../../utils/staffStatus";

// Small on/off switch used next to "Left" in the Status column.
const Switch = ({ checked, onChange, title }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    title={title}
    onClick={onChange}
    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 ${
      checked ? "bg-emerald-500" : "bg-gray-300"
    }`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
        checked ? "translate-x-4" : "translate-x-0.5"
      }`}
    />
  </button>
);

const StaffList = ({
  staff,
  selected,
  toggleSelect,
  toggleSelectAll,
  onEdit,
  onDelete,
  onToggleStatus,
  onView,
  onLetters,
  currentPage,
  totalPages,
  onPageChange,
}) => {
  const columns = [
    { key: "staffId", header: "Staff ID" },
    {
      key: "staffName",
      header: "Name",
      align: "text-left",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <StaffAvatar name={row.staffName} photoUrl={row.photoUrl} size={34} />
          <span className="font-medium text-gray-800">{row.staffName}</span>
        </div>
      ),
    },
    { key: "contactNo", header: "Contact" },
    
    {
      key: "date",
      header: "Joined",
      render: (row) => (row.date ? formatDateToDDMMMYYYY(row.date) : "—"),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const statusColors = {
          Internship: "bg-purple-100 text-purple-700",
          Probation: "bg-blue-100 text-blue-700",
          Confirmation: "bg-green-100 text-green-700",
          Relieved: "bg-orange-100 text-orange-700",
        };
        // Staff who have left: "Left" + an Enable/Disable switch in the same
        // cell. Enabled = still shown in every tab and dropdown; disabled =
        // shown only here on the Staff tab.
        if (hasLeftOrganization(row)) {
          const on = row.enabled !== false;
          return (
            <div className="inline-flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                Left
              </span>
              <Switch
                checked={on}
                onChange={() => onToggleStatus(row._id, on)}
                title={
                  on
                    ? "Enabled — shown in every tab and dropdown. Click to disable (Staff tab only)."
                    : "Disabled — shown only in the Staff tab. Click to enable everywhere."
                }
              />
              <span className={`text-[11px] font-medium ${on ? "text-emerald-600" : "text-gray-500"}`}>
                {on ? "Enabled" : "Disabled"}
              </span>
            </div>
          );
        }
        const shownStatus = getDisplayStatus(row);
        return (
          <span
            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
              statusColors[shownStatus] || "bg-gray-100 text-gray-700"
            }`}
          >
            {shownStatus}
          </span>
        );
      },
    },
    {
      key: "enabled",
      header: "Active",
      // For staff who have left, the switch lives next to "Left" instead.
      render: (row) => hasLeftOrganization(row) ? (
        <span className="text-gray-300">—</span>
      ) : (
        <button
          onClick={() => onToggleStatus(row._id, row.enabled)}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            row.enabled
              ? "bg-green-100 text-green-700"
              : "bg-gray-200 text-gray-600"
          }`}
        >
          <Power size={12} />
          {row.enabled ? "Active" : "Inactive"}
        </button>
      ),
    },
    {
      key: "history",
      header: "History",
      render: (row) => (
        <button
          onClick={() => onView(row)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100"
          title="View internship / probation / confirmation / leaving details"
        >
          <History size={12} />
          View
        </button>
      ),
    },
    {
      key: "letters",
      header: "Letters",
      render: (row) => (
        <button
          onClick={() => onLetters?.(row)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          title="Generate offer / joining / other letters"
        >
          <FileText size={12} />
          Letters
        </button>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => onEdit(row)}
            className="text-indigo-600 hover:text-indigo-800"
            title="Edit"
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={() => onDelete(row)}
            className="text-red-600 hover:text-red-800"
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Table
        columns={columns}
        data={staff}
        selectable
        selected={selected}
        onSelectAll={toggleSelectAll}
        onSelectRow={toggleSelect}
        emptyMessage="No staff members found"
      />
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </>
  );
};

export default StaffList;