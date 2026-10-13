// src/components/advance/index.jsx
import React, { useState } from "react";
import { Wallet } from "lucide-react";
import { useAdvance } from "./hooks/useAdvance";
import AdvanceList from "./AdvanceList";
import AdvanceForm from "./AdvanceForm";
import SearchBar from "../common/SearchBar";
import Button from "../common/Button";
import Modal from "../common/Modal";
import Spinner from "../common/Spinner";
import { showToast } from "../../utils/toast";
import { confirmDialog } from "../../utils/confirmationDialog";

const Advance = () => {
  const [isMobileView, setIsMobileView] = useState(false);

  const {
    loading,
    currentData,
    totalPages,
    currentPage,
    setCurrentPage,
    selected,
    searchTerm,
    setSearchTerm,
    toggleSelect,
    toggleSelectAll,
    deleteAdvance,
    deleteSelected,
    updateStatus,
    fetchAdvances,
    editModal,
    addModal,
  } = useAdvance();

  const [editingAdvance, setEditingAdvance] = useState(null);

  React.useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleEdit = (row) => {
    setEditingAdvance(row);
    editModal.open();
  };

  const handleDelete = async (row) => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete this advance for <b>${row.employeeName}</b>?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (confirm.isConfirmed) {
      await deleteAdvance(row._id, row.employeeName);
    }
  };

  const handleDeleteSelected = async () => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete <b>${selected.length}</b> advance(s)?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (confirm.isConfirmed) {
      await deleteSelected();
    }
  };

  const handleAddSuccess = () => {
    addModal.close();
    fetchAdvances();
    showToast("success", "Advance added successfully");
  };

  const handleEditSuccess = () => {
    editModal.close();
    fetchAdvances();
    showToast("success", "Advance updated successfully");
  };

  return (
    <div className={`${isMobileView ? "px-3" : "p-6"} relative`}>
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">Advances</h1>
        </div>
        {!isMobileView && (
          <div className="flex items-center gap-4">
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
              Total: {currentData.length}
            </span>
            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search advances..."
              className="w-64"
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <Button variant="primary" size="sm" onClick={addModal.open}>
          Add Advance
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
          placeholder="Search advances..."
          className="mb-4"
        />
      )}

      {loading ? (
        <Spinner />
      ) : (
        <AdvanceList
          advances={currentData}
          selected={selected}
          toggleSelect={toggleSelect}
          toggleSelectAll={toggleSelectAll}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onUpdateStatus={updateStatus}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      )}

      <Modal
        isOpen={addModal.isOpen}
        onClose={addModal.close}
        title="Add Advance"
        size="max-w-2xl"
      >
        <AdvanceForm onSubmit={handleAddSuccess} onCancel={addModal.close} />
      </Modal>

      <Modal
        isOpen={editModal.isOpen}
        onClose={editModal.close}
        title="Edit Advance"
        size="max-w-2xl"
      >
        <AdvanceForm
          initialData={editingAdvance}
          onSubmit={handleEditSuccess}
          onCancel={editModal.close}
          isEdit
        />
      </Modal>
    </div>
  );
};

export default Advance;
