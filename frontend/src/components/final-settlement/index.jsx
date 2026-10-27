// src/components/final-settlement/index.jsx
//
// "Final Settlement" page: lists every staff member who has left, lets the
// admin pick one from a dropdown, then shows the same Full & Final Settlement
// Statement preview (and PDF download) that used to live behind the "View"
// button in the staff details.
import React, { useEffect, useMemo, useState } from "react";
import { FileText, Download } from "lucide-react";

import Select from "../common/Select";
import Button from "../common/Button";
import Spinner from "../common/Spinner";
import { SettlementStatementView } from "../staff/SettlementStatement";
import { useSettlementStatement } from "../staff/hooks/useSettlementStatement";
import { staffService } from "../../services/staffService";
import { hasLeftOrganization } from "../../utils/staffStatus";
import { generateSettlementPDF } from "../../utils/settlementGenerator";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";
import { showToast } from "../../utils/toast";

const FinalSettlement = () => {
  const [staffList, setStaffList] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [downloading, setDownloading] = useState(false);

  // Everyone who has left (lean list: only the fields this page needs).
  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError("");
    staffService
      .getLeft()
      .then((res) => {
        if (cancelled) return;
        const all = res.data?.data || [];
        const left = all
          .filter((s) => hasLeftOrganization(s) && s.relievingDate)
          .sort(
            (a, b) =>
              new Date(b.relievingDate) - new Date(a.relievingDate) ||
              String(a.staffName).localeCompare(String(b.staffName)),
          );
        setStaffList(left);
      })
      .catch((err) => {
        if (!cancelled) {
          setListError(
            err.response?.data?.message ||
              "Couldn't load the staff list. Please try again.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(
    () =>
      staffList.map((s) => ({
        value: s._id,
        label: `${s.staffName}${s.staffId ? ` (${s.staffId})` : ""} — left ${formatDateToDDMMMYYYY(
          s.relievingDate,
        )}`,
      })),
    [staffList],
  );

  const selectedStaff = useMemo(
    () => staffList.find((s) => s._id === selectedId) || null,
    [staffList, selectedId],
  );

  const { loading, error, data } = useSettlementStatement(selectedStaff);

  const handleDownload = async () => {
    if (!data) return;
    setDownloading(true);
    try {
      await generateSettlementPDF(data);
    } catch {
      showToast("error", "Couldn't generate the PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">Final Settlement</h1>
        </div>
        <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
          Left staff: {staffList.length}
        </span>
      </div>

      {listLoading ? (
        <div className="py-16">
          <Spinner />
        </div>
      ) : listError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {listError}
        </div>
      ) : (
        <div className="mx-auto max-w-4xl">
          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <label
              htmlFor="final-settlement-staff"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Select staff
            </label>
            <Select
              name="final-settlement-staff"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              options={options}
              placeholder={
                options.length
                  ? "Select a staff member who has left"
                  : "No staff have left yet"
              }
              disabled={!options.length}
            />
          </div>

          {!selectedStaff ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
              <FileText size={32} className="mb-3 text-gray-300" />
              <p className="text-sm text-gray-500">
                {options.length
                  ? "Select a staff member above to preview their Full & Final Settlement Statement."
                  : "Once a staff member has left, their settlement statement will be available here."}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-800">
                  Full &amp; Final Settlement Statement
                </h2>
                {selectedStaff.staffId && (
                  <span className="text-sm text-gray-500">
                    Staff ID:{" "}
                    <span className="font-medium text-gray-700">
                      {selectedStaff.staffId}
                    </span>
                  </span>
                )}
              </div>

              <div className="px-6 py-5">
                <SettlementStatementView
                  staff={selectedStaff}
                  loading={loading}
                  error={error}
                  data={data}
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4">
                <Button
                  variant="primary"
                  onClick={handleDownload}
                  disabled={!data || loading}
                  loading={downloading}
                >
                  {!downloading && <Download size={16} />}
                  Download PDF
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FinalSettlement;
