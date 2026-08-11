// src/components/expenses/hooks/useExpenseCategory.js
import { useState, useEffect, useCallback } from "react";
import { expenseCategoryService } from "../../../services/expenseCategoryService";
import { showToast } from "../../../utils/toast";

export const useExpenseCategory = () => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      const res = await expenseCategoryService.getAll();
      setCategories(res.data?.data || res.data || []);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const addCategory = useCallback(
    async (name) => {
      try {
        await expenseCategoryService.create({ name });
        showToast("success", "Category added successfully");
        await fetchCategories();
        return true;
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to add category");
        return false;
      }
    },
    [fetchCategories]
  );

  const renameCategory = useCallback(
    async (id, name) => {
      try {
        await expenseCategoryService.update(id, { name });
        showToast("success", "Category updated successfully");
        await fetchCategories();
        return true;
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to update category");
        return false;
      }
    },
    [fetchCategories]
  );

  const deleteCategory = useCallback(
    async (id) => {
      try {
        await expenseCategoryService.delete(id);
        showToast("success", "Category deleted successfully");
        await fetchCategories();
        return true;
      } catch (err) {
        showToast("error", err.response?.data?.message || "Failed to delete category");
        return false;
      }
    },
    [fetchCategories]
  );

  return {
    categories,
    loading,
    fetchCategories,
    addCategory,
    renameCategory,
    deleteCategory,
  };
};
