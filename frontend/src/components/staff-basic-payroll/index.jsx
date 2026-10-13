// src/components/staff-basic-payroll/index.jsx
import React, { useState, lazy, Suspense } from "react";
import { Upload, Wallet, Pencil, Trash2, MessageSquare } from "lucide-react";
import { useStaffBasicPayroll } from "./hooks/useStaffBasicPayroll";
import { useModal } from "../../hooks/useModal";
import StaffBasicPayrollList from "./StaffBasicPayrollList";
import CurrentStaffToggle from "../common/CurrentStaffToggle";
import StaffBasicPayrollForm from "./StaffBasicPayrollForm";
// xlsx is only needed once the import dialog is opened.
const StaffBasicPayrollImport = lazy(() => import("./StaffBasicPayrollImport"));
import PayslipModal from "./PayslipModal";
import SearchBar from "../common/SearchBar";
import Button from "../common/Button";
import Modal from "../common/Modal";
import Spinner from "../common/Spinner";
import { staffBasicPayrollService } from "../../services/staffBasicPayrollService";
import { showToast } from "../../utils/toast";
import { confirmDialog } from "../../utils/confirmationDialog";
import { formatCurrency } from "../../utils/numberUtils";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";

// Each row is the "current" revision only when it has the latest
// effectiveFrom date in the whole history — not just the first item,
// since the list can include back-dated or future-dated entries.
const isCurrentEntry = (entry, data) =>
  data.every(
    (h) => new Date(h.effectiveFrom) <= new Date(entry.effectiveFrom),
  );

const SalaryHistoryList = ({
  loading,
  data,
  editable = false,
  selectedId = null,
  onSelect,
  onEditEntry,
  onDeleteEntry,
}) => {
  if (loading) return <Spinner />;
  if (!data.length) {
    return (
      <p className="text-center text-gray-500 py-6 text-sm">
        No salary history available
      </p>
    );
  }
  return (
    <>
      {editable && (
        <p className="text-xs text-gray-400 mb-2">
          Click a revision to highlight it, then edit or delete it.
        </p>
      )}
      <div className="max-h-80 overflow-y-auto pr-1 space-y-2">
        {data.map((h, idx) => {
          const current = isCurrentEntry(h, data);
          const selected = editable && selectedId === h._id;
          return (
            <div
              key={h._id || idx}
              onClick={editable ? () => onSelect?.(h) : undefined}
              className={`flex justify-between items-center border rounded-lg px-3 py-2 ${
                editable ? "cursor-pointer" : ""
              } ${
                selected
                  ? "border-amber-400 bg-amber-50"
                  : current
                    ? "border-blue-400 bg-blue-50"
                    : "border-gray-200"
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-800">
                    {formatCurrency(h.basicSalary)}
                  </p>
                  {current && (
                    <span className="text-[10px] uppercase tracking-wide bg-blue-600 text-white px-1.5 py-0.5 rounded">
                      Current
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  Effective {formatDateToDDMMMYYYY(h.effectiveFrom)}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {h.remarks && (
                  <span title={h.remarks} className="text-gray-400">
                    <MessageSquare size={16} />
                  </span>
                )}
                {editable && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditEntry?.(h);
                      }}
                      className="text-indigo-600 hover:text-indigo-800 transition-colors"
                      title="Edit this revision"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteEntry?.(h);
                      }}
                      disabled={data.length <= 1}
                      className="text-red-600 hover:text-red-800 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                      title={
                        data.length <= 1
                          ? "Can't delete the only revision on record"
                          : "Delete this revision"
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

// Two-column modal title that lines up with the two-column body below.
//
// The modal title element only grows as wide as its text, so a 50/50 grid
// inside it can't line up with the body. Instead, the left heading gets the
// exact width of the body's left column:
//   modal width  = min(56rem [max-w-4xl], viewport - 2rem side margin)
//   column width = (modal width - 3rem [px-6 on both sides]) / 2
// The right heading then gets the same pl-6 as the form column.
const LEFT_COLUMN_WIDTH = "calc((min(56rem, 100vw - 2rem) - 3rem) / 2)";

const SalaryRevisionTitle = ({ editingEntry }) => (
  <div className="flex items-center">
    <span className="shrink-0" style={{ width: LEFT_COLUMN_WIDTH }}>
      Salary Increment History
    </span>
    <span className="hidden md:block pl-6 whitespace-nowrap">
      {editingEntry ? "Edit Salary Revision" : "Add Salary Revision"}
    </span>
  </div>
);

const StaffBasicPayroll = () => {
  const [isMobileView, setIsMobileView] = useState(false);

  const {
    loading,
    availableStaff,
    currentData,
    totalPages,
    currentPage,
    setCurrentPage,
    selected,
    searchTerm,
    setSearchTerm,
    toggleSelect,
    toggleSelectAll,
    deleteRecord,
    deleteSelected,
    fetchRecords,
    fetchAvailableStaff,
    editModal,
    viewModal,
    addModal,
    importModal,
    currentOnly,
    setCurrentOnly,
    visibleCount,
    totalCount,
    filteredCount,
  } = useStaffBasicPayroll();

  const [editingRecord, setEditingRecord] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null);
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const payslipModal = useModal();

  React.useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleEdit = (record) => {
    setEditingRecord(record);
    setEditingEntry(null);
    setSelectedEntryId(null);
    editModal.open();
    // Load the history straight away so it's visible alongside the form
    // the moment the modal opens, instead of requiring a separate click.
    loadHistory(record);
  };

  const handlePayslip = (record) => {
    payslipModal.open(record);
  };

  // Fetches and sorts (newest first) the salary history for a record.
  // Shared by both the "Add/Edit Salary Revision" modal's side panel and
  // the standalone "Salary History" modal.
  const loadHistory = async (record) => {
    try {
      setHistoryLoading(true);
      const res = await staffBasicPayrollService.getHistory(record._id);
      const rows = res.data?.data || res.data || record.salaryHistory || [];
      // Always show the latest revision first, regardless of what order
      // the API/record returned them in.
      const sorted = [...rows].sort(
        (a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom),
      );
      setHistoryData(sorted);
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to load salary history",
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleViewHistory = (record) => {
    viewModal.open(record);
    loadHistory(record);
  };

  const handleSelectEntry = (entry) => {
    setSelectedEntryId((prev) => (prev === entry._id ? null : entry._id));
  };

  const handleEditEntry = (entry) => {
    setSelectedEntryId(entry._id);
    setEditingEntry(entry);
  };

  const handleCancelEditEntry = () => {
    setEditingEntry(null);
  };

  const handleDeleteEntry = async (entry) => {
    if (!editingRecord?._id) return;
    const confirm = await confirmDialog({
      text: `Delete the ${formatCurrency(entry.basicSalary)} revision effective ${formatDateToDDMMMYYYY(
        entry.effectiveFrom,
      )}?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (!confirm.isConfirmed) return;

    try {
      await staffBasicPayrollService.deleteSalary(editingRecord._id, entry._id);
      showToast("success", "Salary revision deleted successfully");
      if (editingEntry?._id === entry._id) setEditingEntry(null);
      if (selectedEntryId === entry._id) setSelectedEntryId(null);
      await loadHistory(editingRecord);
      await fetchRecords();
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to delete salary revision",
      );
    }
  };

  const handleDelete = async (record) => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete <b>${record.staffName}</b>'s record?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (confirm.isConfirmed) {
      await deleteRecord(record._id, record.staffName);
    }
  };

  const handleDeleteSelected = async () => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete <b>${selected.length}</b> record(s)?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (confirm.isConfirmed) {
      await deleteSelected();
    }
  };

  const handleAddSuccess = () => {
    addModal.close();
    fetchRecords();
    fetchAvailableStaff();
    showToast("success", "Record added successfully");
  };

  const closeEditModal = () => {
    editModal.close();
    setEditingRecord(null);
    setEditingEntry(null);
    setSelectedEntryId(null);
    setHistoryData([]);
  };

  const closeViewModal = () => {
    viewModal.close();
    setHistoryData([]);
  };

  const handleEditSuccess = () => {
    const wasEditingEntry = Boolean(editingEntry);
    setEditingEntry(null);
    setSelectedEntryId(null);
    fetchRecords();
    showToast(
      "success",
      wasEditingEntry
        ? "Salary revision updated successfully"
        : "Salary revision added successfully",
    );
    if (editingRecord) loadHistory(editingRecord);
  };

  return (
    <div className={`${isMobileView ? "px-3" : "p-6"} relative`}>
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">
            Staff Basic Payroll
          </h1>
        </div>
        {!isMobileView && (
          <div className="flex items-center gap-4">
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
              Total: {filteredCount}
            </span>
            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search by name or ID..."
              className="w-64"
            />
          </div>
        )}
      </div>

      {/* ACTIONS — buttons on the left, "Current staff only" toggle on the
          right, all in one row (same layout as the Payroll tab) */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Button variant="primary" size="sm" onClick={addModal.open}>
          Add Record
        </Button>
        <Button variant="success" size="sm" onClick={importModal.open}>
          <Upload size={16} className="mr-1" /> Import
        </Button>
        {selected.length > 0 && (
          <Button variant="danger" size="sm" onClick={handleDeleteSelected}>
            Delete ({selected.length})
          </Button>
        )}

        <CurrentStaffToggle
          className="ml-auto"
          checked={currentOnly}
          onChange={setCurrentOnly}
          shownCount={visibleCount}
          totalCount={totalCount}
        />
      </div>

      {isMobileView && (
        <SearchBar
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search by name or ID..."
          className="mb-4"
        />
      )}

      {loading ? (
        <Spinner />
      ) : (
        <StaffBasicPayrollList
          records={currentData}
          selected={selected}
          toggleSelect={toggleSelect}
          toggleSelectAll={toggleSelectAll}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onViewHistory={handleViewHistory}
          onPayslip={handlePayslip}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      )}

      <Modal
        isOpen={addModal.isOpen}
        onClose={addModal.close}
        title="Add Staff Basic Payroll"
        size="max-w-2xl"
      >
        <StaffBasicPayrollForm
          availableStaff={availableStaff}
          onSubmit={handleAddSuccess}
          onCancel={addModal.close}
        />
      </Modal>

      <Modal
        isOpen={editModal.isOpen}
        onClose={closeEditModal}
        title={<SalaryRevisionTitle editingEntry={editingEntry} />}
        size="max-w-4xl"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x md:divide-gray-200">
          <div className="pb-6 md:pb-0 md:pr-6">
            <SalaryHistoryList
              loading={historyLoading}
              data={historyData}
              editable
              selectedId={selectedEntryId}
              onSelect={handleSelectEntry}
              onEditEntry={handleEditEntry}
              onDeleteEntry={handleDeleteEntry}
            />
          </div>
          <div className="md:pl-6">
            {/* On mobile the columns stack, so show the heading above the form */}
            <h3 className="md:hidden text-base font-semibold text-gray-800 mb-3">
              {editingEntry ? "Edit Salary Revision" : "Add Salary Revision"}
            </h3>
            <StaffBasicPayrollForm
              initialData={editingRecord}
              editingEntry={editingEntry}
              onSubmit={handleEditSuccess}
              onCancel={editingEntry ? handleCancelEditEntry : closeEditModal}
              isEdit
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={viewModal.isOpen}
        onClose={closeViewModal}
        title="Salary History"
        size="max-w-lg"
      >
        <SalaryHistoryList loading={historyLoading} data={historyData} />
      </Modal>

      <Modal
        isOpen={importModal.isOpen}
        onClose={importModal.close}
        title="Import Staff Basic Payroll"
        size="max-w-md"
      >
        <Suspense fallback={null}>
          <StaffBasicPayrollImport
            onSuccess={fetchRecords}
            onCancel={importModal.close}
          />
        </Suspense>
      </Modal>

      <PayslipModal
        isOpen={payslipModal.isOpen}
        onClose={payslipModal.close}
        record={payslipModal.data}
      />
    </div>
  );
};

export default StaffBasicPayroll;