// src/components/staff/index.jsx
import React, { useState } from "react";
import { Plus, Users as UsersIcon, Menu } from "lucide-react";
import { useStaff } from "./hooks/useStaff";
import StaffList from "./StaffList";
import StaffForm from "./StaffForm";
import StaffDashboard from "./StaffDashboard";
import SearchBar from "../common/SearchBar";
import Button from "../common/Button";
import Modal from "../common/Modal";
import Sidebar from "../common/Sidebar";
import { showToast } from "../../utils/toast";
import { confirmDialog } from "../../utils/confirmationDialog";

const Staff = () => {
  const [isMobileView, setIsMobileView] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const {
    loading,
    teams,
    allStaff,
    currentData,
    totalPages,
    currentPage,
    setCurrentPage,
    selected,
    searchTerm,
    setSearchTerm,
    toggleSelect,
    toggleSelectAll,
    deleteStaff,
    deleteSelected,
    toggleStatus,
    fetchStaff,
    editModal,
    addModal,
  } = useStaff();

  const [editingStaff, setEditingStaff] = useState(null);

  React.useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleEdit = (member) => {
    setEditingStaff(member);
    editModal.open();
  };

  const handleDelete = async (member) => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete <b>${member.staffName}</b>?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (confirm.isConfirmed) {
      await deleteStaff(member._id, member.staffName);
    }
  };

  const handleDeleteSelected = async () => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete <b>${selected.length}</b> staff member(s)?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (confirm.isConfirmed) {
      await deleteSelected();
    }
  };

  const handleAddSuccess = () => {
    addModal.close();
    fetchStaff();
    showToast("success", "Staff member added successfully");
  };

  const handleEditSuccess = () => {
    editModal.close();
    fetchStaff();
    showToast("success", "Staff member updated successfully");
  };

  return (
    <div className={`${isMobileView ? "px-3" : "p-6"} relative`}>
      {isMobileView && (
        <Sidebar isOpen={sidebarOpen} toggleSidebar={() => setSidebarOpen(false)} isMobile={true} />
      )}

      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          {isMobileView && (
            <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-full bg-gray-100">
              <Menu size={20} className="text-gray-700" />
            </button>
          )}
          <UsersIcon className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">Staff</h1>
        </div>
        {!isMobileView && (
          <div className="flex items-center gap-4">
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
              Total: {currentData.length}
            </span>
            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search staff..."
              className="w-64"
            />
          </div>
        )}
      </div>

      <StaffDashboard staff={allStaff} teams={teams} />

      <div className="flex flex-wrap gap-3 mb-4">
        <Button variant="primary" size="sm" onClick={addModal.open}>
          Add Staff
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
          placeholder="Search staff..."
          className="mb-4"
        />
      )}

      <StaffList
        staff={currentData}
        selected={selected}
        toggleSelect={toggleSelect}
        toggleSelectAll={toggleSelectAll}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onToggleStatus={toggleStatus}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />

      <Modal isOpen={addModal.isOpen} onClose={addModal.close} title="Add Staff Member" size="max-w-2xl">
        <StaffForm onSubmit={handleAddSuccess} onCancel={addModal.close} />
      </Modal>

      <Modal isOpen={editModal.isOpen} onClose={editModal.close} title="Edit Staff Member" size="max-w-2xl">
        <StaffForm
          initialData={editingStaff}
          onSubmit={handleEditSuccess}
          onCancel={editModal.close}
          isEdit
        />
      </Modal>
    </div>
  );
};

export default Staff;
