// src/pages/StaffBasicPayrollManagement.jsx
import React, { useState, useEffect } from "react";
import StaffBasicPayrollList from "../components/staff-basic-payroll/StaffBasicPayrollList";
import AddStaffBasicPayrollModal from "../components/staff-basic-payroll/AddStaffBasicPayrollModal";
import EditStaffBasicPayrollModal from "../components/staff-basic-payroll/EditStaffBasicPayrollModal";
import SalaryHistoryModal from "../components/staff-basic-payroll/SalaryHistoryModal";
import { 
  getStaffBasicPayrolls, 
  getAvailableStaff, 
  createStaffBasicPayroll,
  updateStaffBasicPayroll,
  deleteStaffBasicPayroll,
  getStaffSalaryHistory
} from "../services/staffBasicPayrollService";
import { toast } from "react-toastify";

const StaffBasicPayrollManagement = () => {
  const [records, setRecords] = useState([]);
  const [availableStaff, setAvailableStaff] = useState([]);
  const [selected, setSelected] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [salaryHistory, setSalaryHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch records and available staff
  const fetchData = async (page = currentPage) => {
    setLoading(true);
    try {
      // Fetch both records and available staff in parallel
      const [recordsResponse, staffResponse] = await Promise.all([
        getStaffBasicPayrolls(page),
        getAvailableStaff()
      ]);
      
      setRecords(recordsResponse.data);
      setTotalPages(recordsResponse.totalPages);
      setTotalRecords(recordsResponse.total);
      setAvailableStaff(staffResponse.data);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to fetch data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentPage]);

  // Handle adding new record
  const handleAddRecord = async (formData) => {
    try {
      const response = await createStaffBasicPayroll(formData);
      const newRecord = response.data;
      
      // Update records list
      setRecords(prevRecords => [newRecord, ...prevRecords]);
      
      // CRITICAL: Remove the staff from available staff list
      setAvailableStaff(prevStaff => 
        prevStaff.filter(staff => staff.staffId !== formData.staffId)
      );
      
      // Close modal
      setIsAddModalOpen(false);
      
      toast.success("Staff basic payroll added successfully");
      
    } catch (error) {
      console.error("Error adding record:", error);
      toast.error(error.response?.data?.message || "Failed to add staff basic payroll");
    }
  };

  // Handle editing record
  const handleEdit = (record) => {
    setSelectedRecord(record);
    setIsEditModalOpen(true);
  };

  const handleUpdateRecord = async (formData) => {
    try {
      const response = await updateStaffBasicPayroll(selectedRecord._id, formData);
      const updatedRecord = response.data;
      
      // Update records list
      setRecords(prevRecords => 
        prevRecords.map(record => 
          record._id === updatedRecord._id ? updatedRecord : record
        )
      );
      
      // Close modal
      setIsEditModalOpen(false);
      setSelectedRecord(null);
      
      toast.success("Staff basic payroll updated successfully");
      
    } catch (error) {
      console.error("Error updating record:", error);
      toast.error(error.response?.data?.message || "Failed to update staff basic payroll");
    }
  };

  // Handle delete record
  const handleDelete = async (record) => {
    if (!window.confirm(`Are you sure you want to delete ${record.staffName}'s basic payroll record?`)) {
      return;
    }

    try {
      await deleteStaffBasicPayroll(record._id);
      
      // Update records list
      setRecords(prevRecords => prevRecords.filter(r => r._id !== record._id));
      
      // CRITICAL: Add the staff back to available staff list
      setAvailableStaff(prevStaff => [...prevStaff, {
        staffId: record.staffId,
        staffName: record.staffName
      }]);
      
      // Remove from selected if selected
      setSelected(prev => prev.filter(id => id !== record._id));
      
      toast.success("Record deleted successfully");
    } catch (error) {
      console.error("Error deleting record:", error);
      toast.error(error.response?.data?.message || "Failed to delete record");
    }
  };

  // Handle view history
  const handleViewHistory = async (record) => {
    try {
      const response = await getStaffSalaryHistory(record.staffId);
      setSalaryHistory(response.data);
      setSelectedRecord(record);
      setIsHistoryModalOpen(true);
    } catch (error) {
      console.error("Error fetching salary history:", error);
      toast.error("Failed to fetch salary history");
    }
  };

  // Toggle selection
  const toggleSelect = (id) => {
    setSelected(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selected.length === records.length) {
      setSelected([]);
    } else {
      setSelected(records.map(r => r._id));
    }
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    if (selected.length === 0) {
      toast.warning("Please select at least one record to delete");
      return;
    }

    if (!window.confirm(`Are you sure you want to delete ${selected.length} record(s)?`)) {
      return;
    }

    // Implement bulk delete logic here
    // This would need a bulk delete API endpoint
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Staff Basic Payroll</h1>
          <p className="text-gray-600 text-sm">Total Records: {totalRecords}</p>
        </div>
        <div className="flex gap-2">
          {selected.length > 0 && (
            <button
              onClick={handleBulkDelete}
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
            >
              Delete Selected ({selected.length})
            </button>
          )}
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Add Staff Basic Payroll
          </button>
        </div>
      </div>

      <StaffBasicPayrollList
        records={records}
        selected={selected}
        toggleSelect={toggleSelect}
        toggleSelectAll={toggleSelectAll}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onViewHistory={handleViewHistory}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        loading={loading}
      />

      <AddStaffBasicPayrollModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddRecord}
        availableStaff={availableStaff}
      />

      <EditStaffBasicPayrollModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedRecord(null);
        }}
        onUpdate={handleUpdateRecord}
        record={selectedRecord}
      />

      <SalaryHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => {
          setIsHistoryModalOpen(false);
          setSelectedRecord(null);
          setSalaryHistory([]);
        }}
        record={selectedRecord}
        history={salaryHistory}
      />
    </div>
  );
};

export default StaffBasicPayrollManagement;