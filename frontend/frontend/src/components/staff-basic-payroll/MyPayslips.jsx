// src/components/staff-basic-payroll/MyPayslips.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
import PayslipModal from "./PayslipModal";
import Spinner from "../common/Spinner";
import { staffService } from "../../services/staffService";
import { showToast } from "../../utils/toast";

/**
 * Lets a logged-in staff member ("user" role) view and download their own
 * payslips — the same PayslipModal the admin uses, scoped to the caller's
 * own Staff record (resolved via /api/staff/me). The backend's
 * GET /api/payroll additionally enforces this server-side for non-admins,
 * so this page can never be used to pull up someone else's payslips.
 */
const MyPayslips = () => {
  const navigate = useNavigate();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true);
        const res = await staffService.getMyProfile();
        const staff = res.data?.data;
        if (!staff) throw new Error("No staff profile found");
        setRecord({ employeeId: staff._id, staffName: staff.staffName });
      } catch (err) {
        const message =
          err.response?.data?.message ||
          "No staff profile is linked to your account yet. Contact your admin.";
        setError(message);
        showToast("error", message);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handleClose = () => navigate(-1);

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-5 h-5 text-blue-600" />
        <h1 className="text-xl font-bold text-gray-800">My Payslips</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : error ? (
        <div className="text-center text-gray-500 py-16">{error}</div>
      ) : (
        <PayslipModal isOpen={true} onClose={handleClose} record={record} />
      )}
    </div>
  );
};

export default MyPayslips;
