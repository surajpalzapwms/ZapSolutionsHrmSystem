// src/components/staff/index.jsx
import React, { useState } from "react";
import { Plus, Users as UsersIcon } from "lucide-react";
import { useStaff } from "./hooks/useStaff";
import StaffList from "./StaffList";
import StaffForm from "./StaffForm";
import StaffDashboard from "./StaffDashboard";
import StaffDetailsModal from "./StaffDetailsModal";
import StaffLettersModal from "./StaffLettersModal";
import SearchBar from "../common/SearchBar";
import Button from "../common/Button";
import Modal from "../common/Modal";
import CurrentStaffToggle from "../common/CurrentStaffToggle";
import { showToast } from "../../utils/toast";
import { confirmStaffDelete } from "../../utils/confirmationDialog";
import { staffService, clearStaffListCache } from "../../services/staffService";
import { getCurrentUser, isSuperAdminUser, hasTabAccess } from "../../utils/authUser";

const Staff = () => {
  const [isMobileView, setIsMobileView] = useState(false);
  const [lettersStaff, setLettersStaff] = useState(null);

  // A plain admin only sees "Add Staff" if the super admin granted them
  // the staff.add sub-tab — mirrors the backend's requireTabAccess check
  // on POST /api/staff, so the button never leads to a 403.
  const currentUser = getCurrentUser();
  const canAddStaff = isSuperAdminUser(currentUser) || hasTabAccess("staff.add", currentUser);

  const {
    teams,
    allStaff,
    currentData,
    totalPages,
    currentPage,
    setCurrentPage,
    selected,
    searchTerm,
    setSearchTerm,
    toggleSelect,
    toggleSelectAll,
    deleteStaff,
    deleteSelected,
    toggleStatus,
    fetchStaff,
    editModal,
    addModal,
    currentOnly,
    setCurrentOnly,
    visibleCount,
    filteredCount,
  } = useStaff();

  const [editingStaff, setEditingStaff] = useState(null);
  // Populated by StaffForm's onStaffIdChange callback — the generated
  // preview ID for a new staff member, or the real staffId when editing.
  // Shown in the modal header, next to the X, via Modal's headerRight slot.
  const [modalStaffId, setModalStaffId] = useState("");

  // The staff member currently shown in the read-only "View" details modal
  // (probation start/end, confirmation start, leaving date, all at once).
  const [viewingStaff, setViewingStaff] = useState(null);

  React.useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleEdit = (member) => {
    setEditingStaff(member);
    setModalStaffId(member?.staffId || "");
    editModal.open();
  };

  const handleOpenAddModal = () => {
    setModalStaffId("");
    addModal.open();
  };

  const handleView = (member) => {
    setViewingStaff(member);
  };

  // Fetches what will be removed so the dialog can list it. Falls back to
  // an empty summary if the preview call fails — the confirmation still shows.
  const loadPurgePreview = async (ids) => {
    const totals = {};
    await Promise.all(
      ids.map(async (id) => {
        try {
          const { data } = await staffService.deletePreview(id);
          const counts = data?.data?.counts || {};
          Object.entries(counts).forEach(([k, v]) => { totals[k] = (totals[k] || 0) + (Number(v) || 0); });
        } catch {
          /* preview is informational only */
        }
      }),
    );
    return totals;
  };

  const handleDelete = async (member) => {
    const counts = await loadPurgePreview([member._id]);
    const confirm = await confirmStaffDelete({
      names: [member.staffName],
      counts,
      confirmWord: member.staffId || "DELETE",
    });
    if (confirm.isConfirmed) {
      await deleteStaff(member._id, member.staffName);
    }
  };

  const handleDeleteSelected = async () => {
    const ids = selected.map((s) => s.id);
    const names = ids.map((id) => allStaff.find((m) => m._id === id)?.staffName || id);
    const counts = await loadPurgePreview(ids);
    const confirm = await confirmStaffDelete({ names, counts, confirmWord: "DELETE" });
    if (confirm.isConfirmed) {
      await deleteSelected();
    }
  };

  const handleAddSuccess = () => {
    addModal.close();
    fetchStaff();
    showToast("success", "Staff member added successfully");
  };

  const handleEditSuccess = () => {
    editModal.close();
    fetchStaff();
    showToast("success", "Staff member updated successfully");
  };

  return (
    <div className={`${isMobileView ? "px-3" : "p-6"} relative`}>
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <UsersIcon className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">Staff</h1>
        </div>
        {!isMobileView && (
          <div className="flex items-center gap-4">
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
              Total: {filteredCount}
            </span>
            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search staff..."
              className="w-64"
            />
          </div>
        )}
      </div>

      <StaffDashboard staff={allStaff} teams={teams} />

      {/* ACTIONS — buttons on the left, "Current staff only" toggle on the
          right, all in one row (same layout as the Payroll tab) */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {canAddStaff && (
          <Button variant="primary" size="sm" onClick={handleOpenAddModal}>
            Add Staff
          </Button>
        )}
        {selected.length > 0 && (
          <Button variant="danger" size="sm" onClick={handleDeleteSelected}>
            Delete ({selected.length})
          </Button>
        )}

        <CurrentStaffToggle
          className="ml-auto"
          checked={currentOnly}
          onChange={setCurrentOnly}
          shownCount={visibleCount}
          totalCount={allStaff.length}
        />
      </div>

      {isMobileView && (
        <SearchBar
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search staff..."
          className="mb-4"
        />
      )}

      <StaffList
        staff={currentData}
        selected={selected}
        toggleSelect={toggleSelect}
        toggleSelectAll={toggleSelectAll}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onToggleStatus={toggleStatus}
        onView={handleView}
        onLetters={setLettersStaff}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />

      <StaffDetailsModal
        isOpen={!!viewingStaff}
        onClose={() => setViewingStaff(null)}
        staff={viewingStaff}
        onPhotoChanged={(photoUrl) => {
          // Show the new photo in the header and in the table straight away.
          setViewingStaff((cur) => (cur ? { ...cur, photoUrl } : cur));
          clearStaffListCache();
          fetchStaff();
        }}
      />

      <StaffLettersModal
        isOpen={!!lettersStaff}
        onClose={() => setLettersStaff(null)}
        staff={lettersStaff}
      />

      <Modal
        isOpen={addModal.isOpen}
        onClose={addModal.close}
        title="Add Staff Member"
        size="max-w-2xl"
        headerRight={
          modalStaffId && (
            <span className="text-sm text-gray-500">
              Staff ID:{" "}
              <span className="font-medium text-gray-700">{modalStaffId}</span>
            </span>
          )
        }
      >
        <StaffForm
          onSubmit={handleAddSuccess}
          onCancel={addModal.close}
          onStaffIdChange={setModalStaffId}
        />
      </Modal>

      <Modal
        isOpen={editModal.isOpen}
        onClose={editModal.close}
        title="Edit Staff Member"
        size="max-w-2xl"
        headerRight={
          modalStaffId && (
            <span className="text-sm text-gray-500">
              Staff ID:{" "}
              <span className="font-medium text-gray-700">{modalStaffId}</span>
            </span>
          )
        }
      >
        <StaffForm
          initialData={editingStaff}
          onSubmit={handleEditSuccess}
          onCancel={editModal.close}
          onStaffIdChange={setModalStaffId}
          isEdit
        />
      </Modal>
    </div>
  );
};

export default Staff;