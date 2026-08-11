// src/components/expenses/index.jsx
import React, { useState } from "react";
import { Receipt, Menu, Settings } from "lucide-react";
import { useOfficeExpense } from "./hooks/useOfficeExpense";
import OfficeExpenseList from "./OfficeExpenseList";
import OfficeExpenseForm from "./OfficeExpenseForm";
import CategoryManagerModal from "./CategoryManagerModal";
import SearchBar from "../common/SearchBar";
import Button from "../common/Button";
import Modal from "../common/Modal";
import Sidebar from "../common/Sidebar";
import Spinner from "../common/Spinner";
import { showToast } from "../../utils/toast";
import { confirmDialog } from "../../utils/confirmationDialog";

const Expenses = () => {
  const [isMobileView, setIsMobileView] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    deleteExpense,
    deleteSelected,
    fetchExpenses,
    editModal,
    addModal,
    categoryModal,
  } = useOfficeExpense();

  const [editingExpense, setEditingExpense] = useState(null);
  // Set by the form when it opens the category manager, so we can refresh
  // its own dropdown as soon as a category is added/renamed/deleted.
  const [refreshCategoryOptions, setRefreshCategoryOptions] = useState(null);

  React.useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleEdit = (row) => {
    setEditingExpense(row);
    editModal.open();
  };

  const handleDelete = async (row) => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete this <b>${row.categoryName}</b> expense?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (confirm.isConfirmed) {
      await deleteExpense(row._id, row.categoryName);
    }
  };

  const handleDeleteSelected = async () => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete <b>${selected.length}</b> expense(s)?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (confirm.isConfirmed) {
      await deleteSelected();
    }
  };

  const handleAddSuccess = () => {
    addModal.close();
    fetchExpenses();
    showToast("success", "Expense added successfully");
  };

  const handleEditSuccess = () => {
    editModal.close();
    fetchExpenses();
    showToast("success", "Expense updated successfully");
  };

  const openCategoryManager = (refreshFn) => {
    setRefreshCategoryOptions(() => refreshFn);
    categoryModal.open();
  };

  const closeCategoryManager = () => {
    categoryModal.close();
    refreshCategoryOptions?.();
  };

  return (
    <div className={`${isMobileView ? "px-3" : "p-6"} relative`}>
      {isMobileView && (
        <Sidebar isOpen={sidebarOpen} toggleSidebar={() => setSidebarOpen(false)} isMobile={true} />
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
          <Receipt className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">Expenses</h1>
        </div>
        {!isMobileView && (
          <div className="flex items-center gap-4">
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
              Total: {currentData.length}
            </span>
            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search expenses..."
              className="w-64"
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <Button variant="primary" size="sm" onClick={addModal.open}>
          Add Expense
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openCategoryManager(null)}
        >
          <Settings size={14} />
          Manage Categories
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
          placeholder="Search expenses..."
          className="mb-4"
        />
      )}

      {loading ? (
        <Spinner />
      ) : (
        <OfficeExpenseList
          expenses={currentData}
          selected={selected}
          toggleSelect={toggleSelect}
          toggleSelectAll={toggleSelectAll}
          onEdit={handleEdit}
          onDelete={handleDelete}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      )}

      <Modal isOpen={addModal.isOpen} onClose={addModal.close} title="Add Expense" size="max-w-2xl">
        <OfficeExpenseForm
          onSubmit={handleAddSuccess}
          onCancel={addModal.close}
          onManageCategories={openCategoryManager}
        />
      </Modal>

      <Modal isOpen={editModal.isOpen} onClose={editModal.close} title="Edit Expense" size="max-w-2xl">
        <OfficeExpenseForm
          initialData={editingExpense}
          onSubmit={handleEditSuccess}
          onCancel={editModal.close}
          onManageCategories={openCategoryManager}
          isEdit
        />
      </Modal>

      <CategoryManagerModal
        isOpen={categoryModal.isOpen}
        onClose={closeCategoryManager}
        onChanged={() => refreshCategoryOptions?.()}
      />
    </div>
  );
};

export default Expenses;
