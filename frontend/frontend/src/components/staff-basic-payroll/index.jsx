// src/components/staff-basic-payroll/index.jsx
import React, { useState } from "react";
import { Upload, Wallet, Menu } from "lucide-react";
import { useStaffBasicPayroll } from "./hooks/useStaffBasicPayroll";
import { useModal } from "../../hooks/useModal";
import StaffBasicPayrollList from "./StaffBasicPayrollList";
import StaffBasicPayrollForm from "./StaffBasicPayrollForm";
import StaffBasicPayrollImport from "./StaffBasicPayrollImport";
import PayslipModal from "./PayslipModal";
import SearchBar from "../common/SearchBar";
import Button from "../common/Button";
import Modal from "../common/Modal";
import Sidebar from "../common/Sidebar";
import Spinner from "../common/Spinner";
import { staffBasicPayrollService } from "../../services/staffBasicPayrollService";
import { showToast } from "../../utils/toast";
import { confirmDialog } from "../../utils/confirmationDialog";
import { formatCurrency } from "../../utils/numberUtils";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";

const StaffBasicPayroll = () => {
  const [isMobileView, setIsMobileView] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
  } = useStaffBasicPayroll();

  const [editingRecord, setEditingRecord] = useState(null);
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
    editModal.open();
  };

  const handlePayslip = (record) => {
    payslipModal.open(record);
  };

  const handleViewHistory = async (record) => {
    viewModal.open(record);
    try {
      setHistoryLoading(true);
      const res = await staffBasicPayrollService.getHistory(record._id);
      setHistoryData(res.data?.data || res.data || record.salaryHistory || []);
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to load salary history",
      );
    } finally {
      setHistoryLoading(false);
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

  const handleEditSuccess = () => {
    editModal.close();
    fetchRecords();
    showToast("success", "Salary revision added successfully");
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
          <Wallet className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">
            Staff Basic Payroll
          </h1>
        </div>
        {!isMobileView && (
          <div className="flex items-center gap-4">
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
              Total: {currentData.length}
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

      <div className="flex flex-wrap gap-3 mb-4">
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
        onClose={editModal.close}
        title="Add Salary Revision"
        size="max-w-2xl"
      >
        <StaffBasicPayrollForm
          initialData={editingRecord}
          onSubmit={handleEditSuccess}
          onCancel={editModal.close}
          isEdit
        />
      </Modal>

      <Modal
        isOpen={viewModal.isOpen}
        onClose={viewModal.close}
        title="Salary History"
        size="max-w-lg"
      >
        {historyLoading ? (
          <Spinner />
        ) : historyData.length === 0 ? (
          <p className="text-center text-gray-500 py-6">
            No salary history available
          </p>
        ) : (
          <div className="space-y-2">
            {historyData.map((h, idx) => (
              <div
                key={idx}
                className="flex justify-between items-center border rounded-lg px-3 py-2"
              >
                <div>
                  <p className="font-medium text-gray-800">
                    {formatCurrency(h.basicSalary)}
                  </p>
                  <p className="text-xs text-gray-500">
                    Effective {formatDateToDDMMMYYYY(h.effectiveFrom)}
                  </p>
                </div>
                {h.remarks && (
                  <p className="text-xs text-gray-500 max-w-[50%] text-right">
                    {h.remarks}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={importModal.isOpen}
        onClose={importModal.close}
        title="Import Staff Basic Payroll"
        size="max-w-md"
      >
        <StaffBasicPayrollImport
          onSuccess={fetchRecords}
          onCancel={importModal.close}
        />
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
