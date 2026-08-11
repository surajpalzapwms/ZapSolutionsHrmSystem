// src/hooks/useApi.js
import { useState, useCallback } from "react";
import { showToast } from "../utils/toast";

export const useApi = (apiFn, options = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const execute = useCallback(
    async (...args) => {
      try {
        setLoading(true);
        setError(null);
        const result = await apiFn(...args);
        setData(result.data);
        if (options.onSuccess) options.onSuccess(result.data);
        return result.data;
      } catch (err) {
        setError(err);
        const message = err.response?.data?.message || err.message || "An error occurred";
        if (options.showError !== false) {
          showToast("error", message);
        }
        if (options.onError) options.onError(err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [apiFn, options]
  );

  const reset = useCallback(() => {
    setData(null);
    setLoading(false);
    setError(null);
  }, []);

  return { data, loading, error, execute, reset };
};