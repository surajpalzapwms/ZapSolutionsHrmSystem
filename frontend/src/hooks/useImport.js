// src/hooks/useImport.js
import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { showToast } from "../utils/toast";

export const useImport = (importFn, options = {}) => {
  const [parsedData, setParsedData] = useState([]);
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          // cellDates: true makes date-formatted cells come through as real JS
          // Date objects instead of Excel's numeric serial date, so callers
          // don't have to reverse-engineer the serial format.
          const workbook = XLSX.read(data, { type: "array", cellDates: true });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

          const headerRow = rows[0];
          const dataRows = rows.slice(1);

          const parsed = dataRows.map((row) => {
            const obj = {};
            headerRow.forEach((header, index) => {
              obj[header] = row[index] || "";
            });
            return obj;
          });

          // Optional reshape step (e.g. merging several "one row per day"
          // entries into a single date-range record) before the data is
          // stored/previewed/sent to the backend.
          const finalData = options.transform
            ? options.transform(parsed)
            : parsed;

          setParsedData(finalData);
          if (options.onParse) options.onParse(finalData);
          showToast("success", `Parsed ${finalData.length} record(s)`);
        } catch {
          showToast("error", "Failed to parse file");
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [options],
  );

  const importData = useCallback(async () => {
    if (parsedData.length === 0) {
      showToast("warning", "No data to import");
      return;
    }
    try {
      setUploading(true);
      const result = await importFn(parsedData);
      showToast(
        "success",
        result.data?.message || "Data imported successfully",
      );
      setParsedData([]);
      return result;
    } catch (error) {
      showToast("error", error.response?.data?.message || "Failed to import");
      throw error;
    } finally {
      setUploading(false);
    }
  }, [parsedData, importFn]);

  const reset = useCallback(() => {
    setParsedData([]);
    setUploading(false);
  }, []);

  return {
    parsedData,
    uploading,
    handleFileUpload,
    importData,
    reset,
  };
};
