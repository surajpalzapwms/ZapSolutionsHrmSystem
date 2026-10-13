// src/hooks/useExport.js
import { useState, useCallback } from "react";
import { showToast } from "../utils/toast";

export const useExport = (exportFn, filename = "export") => {
  const [loading, setLoading] = useState(false);

  const exportData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await exportFn();
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast("success", "Data exported successfully");
    } catch {
      showToast("error", "Failed to export data");
    } finally {
      setLoading(false);
    }
  }, [exportFn, filename]);

  return { exportData, loading };
};