// src/components/payroll/index.jsx

import React, { useEffect, useMemo, useState } from "react";
import { Download, DollarSign } from "lucide-react";

import { usePayroll } from "./hooks/usePayroll";
import PayrollList from "./PayrollList";
import PayrollForm from "./PayrollForm";
import PayrollSummary from "./PayrollSummary";
import StaffSalaryModal from "./StaffSalaryModal";

import SearchBar from "../common/SearchBar";
import Button from "../common/Button";
import Modal from "../common/Modal";
import Spinner from "../common/Spinner";
import Dropdown from "../common/Dropdown";
import CurrentStaffToggle from "../common/CurrentStaffToggle";

import { showToast } from "../../utils/toast";
import { staffService } from "../../services/staffService";
import { payrollService } from "../../services/payrollService";

import {
  extractList,
  getStaffInfo,
  getStaffOptionId,
  getStaffOptionName,
  getNet,
  getPending,
  getPeriodTime,
  getPeriodLabel,
  downloadCsv,
} from "../../utils/payrollHelpers";

import { formatMoney } from "../../utils/brand";
const Payroll = () => {
  const [isMobileView, setIsMobileView] = useState(false);

  // Download-by-staff state
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [staffOptions, setStaffOptions] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [staffRecords, setStaffRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const {
    loading,
    exporting,
    exportData,
    summary,
    currentData,
    totalPages,
    currentPage,
    setCurrentPage,
    searchTerm,
    setSearchTerm,
    fetchPayroll,
    viewModal,
    addModal,
    currentOnly,
    setCurrentOnly,
    visibleStaffCount,
    totalStaffCount,
  } = usePayroll();

  // -------------------------------------------------------
  // MOBILE VIEW CHECK
  // -------------------------------------------------------
  useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // -------------------------------------------------------
  // LOAD STAFF WHEN DOWNLOAD MODAL OPENS
  // -------------------------------------------------------
  useEffect(() => {
    if (!showDownloadModal) return;

    let cancelled = false;

    staffService
      .getAll()
      .then((res) => {
        if (!cancelled) setStaffOptions(extractList(res));
      })
      .catch((error) => {
        console.error("Failed to load staff:", error);
        if (!cancelled) {
          setStaffOptions([]);
          showToast("error", "Failed to load staff");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showDownloadModal]);

  // -------------------------------------------------------
  // LOAD PAYROLL RECORDS FOR SELECTED STAFF
  // -------------------------------------------------------
  useEffect(() => {
    if (!selectedStaffId) {
      setStaffRecords([]);
      return;
    }

    let cancelled = false;
    setRecordsLoading(true);

    payrollService
      // send both names; the backend uses whichever it knows
      .getAll({ employeeId: selectedStaffId, staffId: selectedStaffId })
      .then((res) => {
        if (cancelled) return;

        // Filter here too, in case the backend ignores the param
        const list = extractList(res)
          .filter((r) => getStaffInfo(r).id === String(selectedStaffId))
          .sort((a, b) => getPeriodTime(a) - getPeriodTime(b));

        setStaffRecords(list);
      })
      .catch((error) => {
        console.error("Failed to load staff payroll records:", error);
        if (!cancelled) {
          setStaffRecords([]);
          showToast("error", "Failed to load salary records");
        }
      })
      .finally(() => {
        if (!cancelled) setRecordsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedStaffId]);

  // -------------------------------------------------------
  // VIEW SALARY
  // -------------------------------------------------------
  const handleViewSalary = (staffRow) => {
    viewModal.open({
      staffId: staffRow.staffId,
      staffName: staffRow.staffName,
    });
  };

  // -------------------------------------------------------
  // ADD PAYROLL
  // -------------------------------------------------------
  // PayrollForm saves by itself (a new payroll, or one more part-payment
  // on a part-paid month) and passes back { message } for the toast.
  const handleAddSuccess = async (result) => {
    addModal.close();
    await fetchPayroll();
    showToast("success", result?.message || "Payroll saved");
  };

  // -------------------------------------------------------
  // CLOSE DOWNLOAD MODAL
  // -------------------------------------------------------
  const closeDownloadModal = () => {
    setShowDownloadModal(false);
    setSelectedStaffId("");
    setStaffRecords([]);
  };

  // -------------------------------------------------------
  // DOWNLOAD STAFF CSV
  // -------------------------------------------------------
  const handleDownloadStaffCSV = async () => {
    if (!selectedStaffId) return;

    setDownloading(true);

    try {
      const res = await payrollService.export({
        employeeId: selectedStaffId,
        staffId: selectedStaffId,
      });

      const selectedStaff = staffOptions.find(
        (staff) => getStaffOptionId(staff) === String(selectedStaffId)
      );
      const staffName = selectedStaff ? getStaffOptionName(selectedStaff) : "staff";

      downloadCsv(
        res?.data ?? res,
        `${staffName.replace(/\s+/g, "_")}_salary_history.csv`
      );

      showToast("success", "Salary history downloaded");
    } catch (error) {
      console.error("Failed to download salary history:", error);
      showToast("error", "Failed to download salary history");
    } finally {
      setDownloading(false);
    }
  };

  // -------------------------------------------------------
  // STAFF DROPDOWN OPTIONS
  // -------------------------------------------------------
  const staffSelectOptions = useMemo(
    () =>
      staffOptions.map((staff) => ({
        value: getStaffOptionId(staff),
        label: getStaffOptionName(staff),
      })),
    [staffOptions]
  );

  // Dropdown may pass a value, an option object, or an event
  const handleStaffChange = (value) => {
    const next =
      value?.target?.value ?? value?.value ?? (typeof value === "string" ? value : "");
    setSelectedStaffId(next);
  };

  return (
    <div className={`${isMobileView ? "px-3" : "p-6"} relative`}>
      {/* HEADER */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">Payroll</h1>
        </div>

        {!isMobileView && (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDownloadModal(true)}
              className="flex items-center gap-2"
            >
              <Download size={16} />
              Download by Staff
            </Button>

            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search by name or code..."
              className="w-64"
            />
          </div>
        )}
      </div>

      {/* SUMMARY */}
      <PayrollSummary summary={summary} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Button variant="primary" size="sm" onClick={() => addModal.open()}>
          Add Payroll
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={exportData}
          loading={exporting}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl shadow-md transition-colors"
        >
          <Download size={16} className="mr-1" />
          Export CSV
        </Button>

        {isMobileView && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDownloadModal(true)}
            className="flex items-center gap-2"
          >
            <Download size={16} />
            Download by Staff
          </Button>
        )}

        <CurrentStaffToggle
          className="ml-auto"
          checked={currentOnly}
          onChange={setCurrentOnly}
          shownCount={visibleStaffCount}
          totalCount={totalStaffCount}
        />
      </div>

      {/* MOBILE SEARCH */}
      {isMobileView && (
        <SearchBar
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search by name or code..."
          className="mb-4"
        />
      )}

      {/* LIST */}
      {loading ? (
        <Spinner />
      ) : (
        <PayrollList
          payroll={currentData}
          onViewSalary={handleViewSalary}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      )}

      {/* ADD PAYROLL MODAL */}
      <Modal
        isOpen={addModal.isOpen}
        onClose={addModal.close}
        title="Add Payroll"
        size="max-w-3xl"
      >
        <PayrollForm onSubmit={handleAddSuccess} onCancel={addModal.close} />
      </Modal>

      {/* STAFF SALARY MODAL */}
      <StaffSalaryModal
        isOpen={viewModal.isOpen}
        onClose={viewModal.close}
        staffId={viewModal.data?.staffId}
        staffName={viewModal.data?.staffName}
        onChanged={fetchPayroll}
      />

      {/* DOWNLOAD BY STAFF MODAL */}
      <Modal
        isOpen={showDownloadModal}
        onClose={closeDownloadModal}
        title="Download Salary by Staff"
        size="max-w-lg"
      >
        <div className="space-y-4">
          <Dropdown
            label="Staff Name"
            value={selectedStaffId}
            onChange={handleStaffChange}
            options={staffSelectOptions}
            placeholder="Select a staff member"
          />

          {!selectedStaffId ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              Select a staff member to see all salary paid to them.
            </p>
          ) : recordsLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : staffRecords.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              No payroll records found for this staff member.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Period</th>
                    <th className="text-right px-3 py-2 font-medium">Net</th>
                    <th className="text-right px-3 py-2 font-medium">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {staffRecords.map((record, index) => {
                    const pending = getPending(record);
                    return (
                      <tr
                        key={record._id || record.id || index}
                        className="border-t border-gray-100"
                      >
                        <td className="px-3 py-2">{getPeriodLabel(record)}</td>
                        <td className="px-3 py-2 text-right text-green-600 font-medium">
                          {formatMoney(getNet(record))}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span
                            className={
                              pending > 0
                                ? "text-red-600 font-semibold"
                                : "text-gray-400"
                            }
                          >
                            {formatMoney(pending)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={closeDownloadModal}>
              Close
            </Button>

            <Button
              type="button"
              variant="primary"
              onClick={handleDownloadStaffCSV}
              loading={downloading}
              disabled={!selectedStaffId || staffRecords.length === 0}
              className="flex items-center gap-2"
            >
              <Download size={16} />
              Download CSV
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Payroll;