// src/hooks/useForm.js
import { useState, useCallback } from "react";

export const useForm = (initialState, validateFn) => {
  const [form, setForm] = useState(initialState);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  }, []);

  const setField = useCallback((name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  }, []);

  const setFields = useCallback((data) => {
    setForm((prev) => ({ ...prev, ...data }));
  }, []);

  const validate = useCallback(() => {
    if (!validateFn) return true;
    const newErrors = validateFn(form);
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [form, validateFn]);

  const reset = useCallback(() => {
    setForm(initialState);
    setErrors({});
    setIsSubmitting(false);
  }, [initialState]);

  const clearError = useCallback((field) => {
    setErrors((prev) => ({ ...prev, [field]: "" }));
  }, []);

  return {
    form,
    errors,
    isSubmitting,
    setIsSubmitting,
    handleChange,
    setField,
    setFields,
    validate,
    reset,
    clearError,
  };
};