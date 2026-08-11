// src/components/expenses/CategoryManagerModal.jsx
import React, { useState } from "react";
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

  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    const ok = await addCategory(newName.trim());
    setAdding(false);
    if (ok) {
      setNewName("");
      onChanged?.();
    }
  };

  const startEdit = (cat) => {
    setEditingId(cat._id);
    setEditName(cat.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  const saveEdit = async (id) => {
    if (!editName.trim()) return;
    const ok = await renameCategory(id, editName.trim());
    if (ok) {
      cancelEdit();
      onChanged?.();
    }
  };

  const handleDelete = async (cat) => {
    const confirm = await confirmDialog({
      text: `Are you sure you want to delete the <b>${cat.name}</b> category?`,
      icon: "warning",
      confirmButtonText: "Yes, delete",
    });
    if (confirm.isConfirmed) {
      const ok = await deleteCategory(cat._id);
      if (ok) onChanged?.();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manage Expense Categories" size="max-w-md">
      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <InputField
          className="flex-1"
          placeholder="e.g. Internet Bill"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" variant="primary" loading={adding}>
          <Plus size={16} />
          Add
        </Button>
      </form>

      {loading ? (
        <Spinner size="sm" />
      ) : (
        <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 border rounded-md">
          {categories.length === 0 ? (
            <p className="text-sm text-gray-500 p-3">No categories yet</p>
          ) : (
            categories.map((cat) => (
              <div key={cat._id} className="flex items-center justify-between gap-2 p-2">
                {editingId === cat._id ? (
                  <>
                    <InputField
                      className="flex-1"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <button
                      onClick={() => saveEdit(cat._id)}
                      className="text-green-600 shrink-0"
                      title="Save"
                      type="button"
                    >
                      <Check size={16} />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="text-gray-500 shrink-0"
                      title="Cancel"
                      type="button"
                    >
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-gray-800">{cat.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => startEdit(cat)}
                        className="text-indigo-600"
                        title="Rename"
                        type="button"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(cat)}
                        className="text-red-600"
                        title="Delete"
                        type="button"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}

      <div className="flex justify-end pt-4">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
};

export default CategoryManagerModal;
