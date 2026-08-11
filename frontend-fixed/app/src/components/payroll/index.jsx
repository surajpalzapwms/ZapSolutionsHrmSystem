// src/components/payroll/index.jsx
import React, { useState } from "react";
import { Plus, Download, DollarSign, Menu } from "lucide-react";
import { usePayroll } from "./hooks/usePayroll";
import PayrollList from "./PayrollList";
import PayrollForm from "./PayrollForm";
import PayrollSummary from "./PayrollSummary";
import PayrollFilters from "./PayrollFilters";
import SearchBar from "../common/SearchBar";
import Button from "../common/Button";
import Modal from "../common/Modal";
import Sidebar from "../common/Sidebar";
import Spinner from "../common/Spinner";
import { showToast } from "../../utils/toast";
import { confirmDialog } from "../../utils/confirmationDialog";
import { formatCurrency } from "../../utils/numberUtils";

const Payroll = () => {
  const [isMobileView, setIsMobileView] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const {
    loading,
    exporting,
    exportData,
    summary,
    currentData,
    totalPages,
    currentPage,
    setCurrentPage,
    selected,
    searchTerm,
    setSearchTerm,
    periodFrom,
    periodTo,
    setPeriodRange,
    clearPeriodRange,
    toggleSelect,
    toggleSelectAll,
    deletePayroll,
    deleteSelected,
    fetchPayroll,
    editModal,
    viewModal,
    addModal,
  } = usePayroll();

  const [editingPayroll, setEditingPayroll] = useState(null);
  const [viewingPayroll, setViewingPayroll] = useState(null);

  React.useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleEdit = (row) => {
    setEditingPayroll(row);
    editModal.open();
  };

  const handleView = (row) => {
    setViewingPayroll(row);
    viewModal.open();
  };

  const handleDelete = async (row) => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete payroll <b>${row.payrollCode || row.staffName}</b>?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (confirm.isConfirmed) {
      await deletePayroll(row._id, row.payrollCode);
    }
  };

  const handleDeleteSelected = async () => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete <b>${selected.length}</b> payroll record(s)?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (confirm.isConfirmed) {
      await deleteSelected();
    }
  };

  const handleAddSuccess = () => {
    addModal.close();
    fetchPayroll();
    showToast("success", "Payroll added successfully");
  };

  const handleEditSuccess = () => {
    editModal.close();
    fetchPayroll();
    showToast("success", "Payroll updated successfully");
  };

  return (
    <div className={`${isMobileView ? "px-3" : "p-6"} relative`}>
      {isMobileView && (
        <Sidebar
          isOpen={sidebarOpen}
          toggleSidebar={() => setSidebarOpen(false)}
          isMobile={true}
        />
      )}

      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          {isMobileView && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-full bg-gray-100"
            >
              <Menu size={20} className="text-gray-700" />
            </button>
          )}
          <DollarSign className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">Payroll</h1>
        </div>
        {!isMobileView && (
          <SearchBar
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search by name or code..."
            className="w-64"
          />
        )}
      </div>

      <PayrollSummary summary={summary} />

      <PayrollFilters
        periodFrom={periodFrom}
        periodTo={periodTo}
        onRangeChange={setPeriodRange}
        onClear={clearPeriodRange}
      />

      <div className="flex flex-wrap gap-3 mb-4">
        <Button variant="primary" size="sm" onClick={addModal.open}>
          Add Payroll
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={exportData}
          loading={exporting}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl shadow-md transition-colors"
        >
          <Download size={16} className="mr-1" /> Export CSV
        </Button>
        {selected.length > 0 && (
          <Button variant="danger" size="sm" onClick={handleDeleteSelected}>
            Delete ({selected.length})
          </Button>
        )}
      </div>

      {isMobileView && (
        <SearchBar
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search by name or code..."
          className="mb-4"
        />
      )}

      {loading ? (
        <Spinner />
      ) : (
        <PayrollList
          payroll={currentData}
          selected={selected}
          toggleSelect={toggleSelect}
          toggleSelectAll={toggleSelectAll}
          onView={handleView}
          onDelete={handleDelete}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      )}

      <Modal
        isOpen={addModal.isOpen}
        onClose={addModal.close}
        title="Add Payroll"
        size="max-w-2xl"
      >
        <PayrollForm onSubmit={handleAddSuccess} onCancel={addModal.close} />
      </Modal>

      <Modal
        isOpen={editModal.isOpen}
        onClose={editModal.close}
        title="Edit Payroll"
        size="max-w-2xl"
      >
        <PayrollForm
          initialData={editingPayroll}
          onSubmit={handleEditSuccess}
          onCancel={editModal.close}
          isEdit
        />
      </Modal>

      <Modal
        isOpen={viewModal.isOpen}
        onClose={viewModal.close}
        title="Payroll Details"
        size="max-w-md"
      >
        {viewingPayroll && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Staff
                </label>
                <p className="border px-3 py-2 rounded-lg bg-gray-100">
                  {viewingPayroll.staffName}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Period
                </label>
                <p className="border px-3 py-2 rounded-lg bg-gray-100">
                  {viewingPayroll.period}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Basic Salary
                </label>
                <p className="border px-3 py-2 rounded-lg bg-gray-100">
                  {formatCurrency(viewingPayroll.basicSalary)}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Net Salary
                </label>
                <p className="border px-3 py-2 rounded-lg bg-gray-100 font-semibold">
                  {formatCurrency(viewingPayroll.netSalary)}
                </p>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">
                Status
              </label>
              <p className="border px-3 py-2 rounded-lg bg-gray-100 capitalize">
                {viewingPayroll.status}
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={viewModal.close}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Payroll;
