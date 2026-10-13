// src/components/holidays/index.jsx
import React, { useState, lazy, Suspense } from "react";
import {
  Plus,
  Upload,
  Calendar as CalendarIcon,
  CalendarDays,
} from "lucide-react";
import { useHolidays } from "./hooks/useHolidays";
import HolidayList from "./HolidayList";
import HolidayForm from "./HolidayForm";
import HolidayCalendar from "./HolidayCalendar";
// xlsx is only needed once the import dialog is opened.
const HolidayImport = lazy(() => import("./HolidayImport"));
import SaturdayHolidaySettings from "./SaturdayHolidaySettings";
import SearchBar from "../common/SearchBar";
import Button from "../common/Button";
import Modal from "../common/Modal";
import { showToast } from "../../utils/toast";
import { confirmDialog } from "../../utils/confirmationDialog";
import { getMonthName } from "../../utils/dateUtils";
import { getCurrentUser, isAdminUser } from "../../utils/authUser";
import { refreshSidebarCounts } from "../../hooks/useSidebarCounts";

const formatFullDate = (dateString) => {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return dateString;
  return `${d.getDate()} ${getMonthName(d.getMonth())} ${d.getFullYear()}`;
};

const Holidays = () => {
  const [isMobileView, setIsMobileView] = useState(false);
  // Default to the calendar (whole-year) view so holidays for the entire
  // year are visible as soon as the Holidays tab opens.
  const [showCalendarView, setShowCalendarView] = useState(true);
  const [saturdaySettingsOpen, setSaturdaySettingsOpen] = useState(false);
  // Bumped every time Saturday holiday rules are saved, so HolidayCalendar's
  // fetch effect (keyed on this + the visible year) reruns and the calendar
  // reflects the new checkboxes immediately instead of needing a refresh.
  const [saturdayRefreshKey, setSaturdayRefreshKey] = useState(0);
  // "monthly" | "annual" — drives HolidayCalendar's layout. Previously this
  // toggle rendered on its own row under the actions row; it now lives in
  // the actions row itself, right-aligned next to Show Table.
  const [calendarViewMode, setCalendarViewMode] = useState("annual");
  const admin = isAdminUser(getCurrentUser());

  const {
    currentData,
    allHolidays,
    joiningDate,
    totalPages,
    currentPage,
    setCurrentPage,
    selected,
    searchTerm,
    setSearchTerm,
    toggleSelect,
    toggleSelectAll,
    deleteHoliday,
    deleteSelected,
    fetchHolidays,
    editModal,
    viewModal,
    addModal,
    importModal,
  } = useHolidays();

  const [editingHoliday, setEditingHoliday] = useState(null);
  const [viewingHoliday, setViewingHoliday] = useState(null);

  React.useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleEdit = (holiday) => {
    setEditingHoliday(holiday);
    editModal.open();
  };

  const handleView = (holiday) => {
    setViewingHoliday(holiday);
    viewModal.open();
  };

  const handleDelete = async (holiday) => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete <b>${holiday.name}</b>?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (confirm.isConfirmed) {
      await deleteHoliday(holiday._id, holiday.name);
      refreshSidebarCounts();
    }
  };

  const handleDeleteSelected = async () => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete <b>${selected.length}</b> holiday(s)?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (confirm.isConfirmed) {
      await deleteSelected();
      refreshSidebarCounts();
    }
  };

  const handleAddSuccess = () => {
    addModal.close();
    fetchHolidays();
    refreshSidebarCounts();
    showToast("success", "Holiday added successfully");
  };

  const handleEditSuccess = () => {
    editModal.close();
    fetchHolidays();
    refreshSidebarCounts();
    showToast("success", "Holiday updated successfully");
  };

  // Shared "Total + Search" block for desktop, rendered in different
  // places depending on whether the calendar or table view is active.
  const totalAndSearch = (
    <div className="flex items-center gap-4">
      <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
        Total: {currentData.length}
      </span>
      <SearchBar
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Search holidays..."
        className="w-64"
      />
    </div>
  );

  return (
    <div className={`${isMobileView ? "px-3" : "p-6"} relative`}>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">Holidays</h1>
        </div>
        {/* Calendar view: Total + Search live up here, in line with the title. */}
        
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {admin && (
            <Button variant="primary" size="sm" onClick={addModal.open}>
              Add New Holiday
            </Button>
          )}
          {admin && (
            <Button variant="success" size="sm" onClick={importModal.open}>
              <Upload size={16} className="mr-1" /> Import CSV
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCalendarView(!showCalendarView)}
          >
            <CalendarIcon size={16} className="mr-1" />
            {showCalendarView ? "Show Table" : "Show Calendar"}
          </Button>
          {admin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSaturdaySettingsOpen(true)}
            >
              <CalendarDays size={16} className="mr-1" />
              Saturday Holiday Settings
            </Button>
          )}
          {admin && selected.length > 0 && (
            <Button variant="danger" size="sm" onClick={handleDeleteSelected}>
              Delete ({selected.length})
            </Button>
          )}
        </div>

        {showCalendarView && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCalendarViewMode("monthly")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                calendarViewMode === "monthly"
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setCalendarViewMode("annual")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                calendarViewMode === "annual"
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Annual
            </button>
          </div>
        )}

        {/* Table view: Total + Search move down here, alongside the toggle button. */}
        {!isMobileView && !showCalendarView && totalAndSearch}
      </div>

      {isMobileView && (
        <SearchBar
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search holidays..."
          className="mb-4"
        />
      )}

      {showCalendarView ? (
        <HolidayCalendar
          holidays={allHolidays}
          onView={handleView}
          saturdayRefreshKey={saturdayRefreshKey}
          viewMode={calendarViewMode}
          joiningDate={joiningDate}
        />
      ) : (
        <HolidayList
          holidays={currentData}
          selected={selected}
          toggleSelect={toggleSelect}
          toggleSelectAll={toggleSelectAll}
          onView={handleView}
          onEdit={handleEdit}
          onDelete={handleDelete}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          admin={admin}
        />
      )}

      {/* Add Modal */}
      <Modal
        isOpen={addModal.isOpen}
        onClose={addModal.close}
        title="Add New Holiday"
        size="max-w-2xl"
      >
        <HolidayForm onSubmit={handleAddSuccess} onCancel={addModal.close} />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={editModal.isOpen}
        onClose={editModal.close}
        title="Edit Holiday"
        size="max-w-2xl"
      >
        <HolidayForm
          initialData={editingHoliday}
          onSubmit={handleEditSuccess}
          onCancel={editModal.close}
          isEdit
        />
      </Modal>

      {/* View Modal */}
      <Modal
        isOpen={viewModal.isOpen}
        onClose={viewModal.close}
        title="Holiday Details"
        size="max-w-md"
      >
        {viewingHoliday && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-600">Name</label>
              <p className="border px-3 py-2 rounded-lg bg-gray-100 capitalize">
                {viewingHoliday.name}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Start Date
                </label>
                <p className="border px-3 py-2 rounded-lg bg-gray-100">
                  {formatFullDate(viewingHoliday.startDate)}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">
                  End Date
                </label>
                <p className="border px-3 py-2 rounded-lg bg-gray-100">
                  {viewingHoliday.endDate
                    ? formatFullDate(viewingHoliday.endDate)
                    : "N/A"}
                </p>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">
                Description
              </label>
              <p className="border px-3 py-2 rounded-lg bg-gray-100 min-h-[60px]">
                {viewingHoliday.description || "No description"}
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={viewModal.close}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={saturdaySettingsOpen}
        onClose={() => setSaturdaySettingsOpen(false)}
        title="Saturday Holiday Settings"
        size="max-w-3xl"
      >
        <SaturdayHolidaySettings
          admin={admin}
          onSaved={() => {
            setSaturdaySettingsOpen(false);
            setSaturdayRefreshKey((k) => k + 1);
          }}
        />
      </Modal>

      {/* Import Modal */}
      <Modal
        isOpen={importModal.isOpen}
        onClose={importModal.close}
        title="Import Holidays"
        size="max-w-md"
      >
        <Suspense fallback={null}>
          <HolidayImport
            onSuccess={() => {
              fetchHolidays();
              refreshSidebarCounts();
            }}
            onCancel={importModal.close}
          />
        </Suspense>
      </Modal>
    </div>
  );
};

export default Holidays;
