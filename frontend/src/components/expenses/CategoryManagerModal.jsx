import React, { useState, useEffect, useRef } from "react";
import { Pencil, Trash2, Check, X, Plus } from "lucide-react";
import Modal from "../common/Modal";
import InputField from "../common/InputField";
import Button from "../common/Button";
import Spinner from "../common/Spinner";
import { useExpenseCategory } from "./hooks/useExpenseCategory";
import { confirmDialog } from "../../utils/confirmationDialog";

const CategoryManagerModal = ({ isOpen, onClose, onChanged }) => {
  const { categories, loading, addCategory, renameCategory, deleteCategory } =
    useExpenseCategory();

  // State management
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  
  // Refs for focus management
  const addInputRef = useRef(null);
  const editInputRef = useRef(null);

  // Auto-focus when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (addInputRef.current) {
          addInputRef.current.focus();
        }
      }, 100);
    }
  }, [isOpen]);

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingId]);

  // Handle adding a new category
  const handleAdd = async (e) => {
    e.preventDefault();
    const trimmedName = newName.trim();
    
    // Validation
    if (!trimmedName) {
      setError("Category name is required");
      return;
    }
    if (trimmedName.length < 2) {
      setError("Category name must be at least 2 characters");
      return;
    }
    if (trimmedName.length > 50) {
      setError("Category name must be less than 50 characters");
      return;
    }
    
    // Check for duplicate
    if (categories.some(cat => cat.name.toLowerCase() === trimmedName.toLowerCase())) {
      setError("Category already exists");
      return;
    }
    
    setError("");
    setAdding(true);
    const ok = await addCategory(trimmedName);
    setAdding(false);
    
    if (ok) {
      setNewName("");
      onChanged?.();
      if (addInputRef.current) {
        addInputRef.current.focus();
      }
    }
  };

  // Start editing a category
  const startEdit = (cat) => {
    setEditingId(cat._id);
    setEditName(cat.name);
    setError("");
  };

  // Cancel editing
  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setError("");
  };

  // Save edited category
  const saveEdit = async (id) => {
    const trimmedName = editName.trim();
    
    if (!trimmedName) {
      setError("Category name is required");
      return;
    }
    if (trimmedName.length < 2) {
      setError("Category name must be at least 2 characters");
      return;
    }
    if (trimmedName.length > 50) {
      setError("Category name must be less than 50 characters");
      return;
    }
    
    // Check for duplicate (excluding current category)
    if (categories.some(cat => 
      cat._id !== id && cat.name.toLowerCase() === trimmedName.toLowerCase()
    )) {
      setError("Category already exists");
      return;
    }
    
    setError("");
    const ok = await renameCategory(id, trimmedName);
    if (ok) {
      cancelEdit();
      onChanged?.();
    }
  };

  // Delete a category
  const handleDelete = async (cat) => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete the <b>${cat.name}</b> category?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    
    if (confirm.isConfirmed) {
      setDeletingId(cat._id);
      const ok = await deleteCategory(cat._id);
      setDeletingId(null);
      if (ok) onChanged?.();
    }
  };

  // Handle Enter key in add input
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAdd(e);
    }
    if (e.key === "Escape") {
      setNewName("");
      setError("");
    }
  };

  // Handle Enter/Escape keys in edit input
  const handleEditKeyDown = (e, id) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit(id);
    }
    if (e.key === "Escape") {
      cancelEdit();
    }
  };

  // Clear error when input changes
  const handleNewNameChange = (e) => {
    setNewName(e.target.value);
    if (error) setError("");
  };

  const handleEditNameChange = (e) => {
    setEditName(e.target.value);
    if (error) setError("");
  };

  // Reset state when modal closes
  const handleClose = () => {
    setNewName("");
    setEditingId(null);
    setEditName("");
    setError("");
    setAdding(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Manage Expense Categories"
      size="max-w-md"
    >
      {/* Add Category Form */}
      <form onSubmit={handleAdd} className="mb-4">
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <InputField
              ref={addInputRef}
              className="w-full"
              placeholder="e.g. Internet Bill"
              value={newName}
              onChange={handleNewNameChange}
              onKeyDown={handleKeyDown}
              disabled={adding}
              maxLength={50}
              aria-label="New category name"
            />
            {error && (
              <p className="text-xs text-red-600 mt-1 animate-pulse">
                {error}
              </p>
            )}
          </div>
          <Button
            type="submit"
            variant="primary"
            loading={adding}
            className="shrink-0"
            disabled={!newName.trim() || adding}
            aria-label="Add category"
          >
            Add
          </Button>
        </div>
      </form>

      {/* Category List */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner size="sm" />
        </div>
      ) : (
        <>
          {/* Category count */}
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-gray-500">
              {categories.length} {categories.length === 1 ? 'category' : 'categories'}
            </span>
            {categories.length > 0 && (
              <span className="text-xs text-gray-400">
                {categories.length === 10 ? 'Maximum reached' : `${10 - categories.length} remaining`}
              </span>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 border rounded-md">
            {categories.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-gray-500">
                  No categories yet
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Add your first category above
                </p>
              </div>
            ) : (
              categories.map((cat) => (
                <div
                  key={cat._id}
                  className="flex items-center justify-between gap-2 p-2 hover:bg-gray-50 transition-colors"
                  role="listitem"
                >
                  {editingId === cat._id ? (
                    // Edit mode
                    <>
                      <div className="flex-1 min-w-0">
                        <InputField
                          ref={editInputRef}
                          className="w-full"
                          value={editName}
                          onChange={handleEditNameChange}
                          onKeyDown={(e) => handleEditKeyDown(e, cat._id)}
                          maxLength={50}
                          aria-label="Edit category name"
                        />
                        {error && (
                          <p className="text-xs text-red-600 mt-1 animate-pulse">
                            {error}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => saveEdit(cat._id)}
                        className="text-green-600 hover:text-green-800 shrink-0 p-1 rounded hover:bg-green-50 transition-colors"
                        title="Save changes"
                        type="button"
                        aria-label="Save category"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="text-gray-500 hover:text-gray-700 shrink-0 p-1 rounded hover:bg-gray-100 transition-colors"
                        title="Cancel editing"
                        type="button"
                        aria-label="Cancel edit"
                      >
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    // View mode
                    <>
                      <span className="text-sm text-gray-800 truncate flex-1">
                        {cat.name}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => startEdit(cat)}
                          className="text-indigo-600 hover:text-indigo-800 p-1 rounded hover:bg-indigo-50 transition-colors"
                          title="Rename category"
                          type="button"
                          aria-label={`Rename ${cat.name}`}
                          disabled={deletingId === cat._id}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(cat)}
                          className="text-red-600 hover:text-red-800 p-1 rounded hover:bg-red-50 transition-colors"
                          title="Delete category"
                          type="button"
                          aria-label={`Delete ${cat.name}`}
                          disabled={deletingId === cat._id}
                        >
                          {deletingId === cat._id ? (
                            <Spinner size="xs" />
                          ) : (
                            <Trash2 size={16} />
                          )}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Footer */}
      <div className="flex justify-end pt-4 border-t border-gray-100 mt-4">
        <Button 
          variant="secondary" 
          onClick={handleClose}
          aria-label="Close modal"
        >
          Close
        </Button>
      </div>
    </Modal>
  );
};

export default CategoryManagerModal;