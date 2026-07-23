// src/components/payroll/AddPayrollPage.jsx
import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, DollarSign } from "lucide-react";
import PayrollForm from "./PayrollForm";
import Card from "../common/Card";
import { showToast } from "../../utils/toast";

const AddPayrollPage = () => {
  const navigate = useNavigate();
  const backToList = () => navigate("/hrmlayout/payroll");

  const handleSubmit = () => {
    showToast("success", "Payroll record added successfully");
    backToList();
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button
        onClick={backToList}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft size={16} /> Back to Payroll
      </button>

      <div className="flex items-center gap-2 mb-4">
        <DollarSign className="w-5 h-5 text-purple-600" />
        <h1 className="text-xl font-bold text-gray-800">Add Payroll</h1>
      </div>

      <Card>
        <PayrollForm onSubmit={handleSubmit} onCancel={backToList} />
      </Card>
    </div>
  );
};

export default AddPayrollPage;
