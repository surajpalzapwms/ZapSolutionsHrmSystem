// src/components/staff/AddStaffMemberPage.jsx
import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, UserPlus } from "lucide-react";
import StaffForm from "./StaffForm";
import Card from "../common/Card";
import { showToast } from "../../utils/toast";

const AddStaffMemberPage = () => {
  const navigate = useNavigate();
  const backToList = () => navigate("/staffmemberLayout/staffmember");

  const handleSubmit = () => {
    showToast("success", "Staff member added successfully");
    backToList();
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button
        onClick={backToList}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft size={16} /> Back to Staff
      </button>

      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-gray-800">Add Staff Member</h1>
      </div>

      <Card>
        <StaffForm onSubmit={handleSubmit} onCancel={backToList} />
      </Card>
    </div>
  );
};

export default AddStaffMemberPage;
