// src/components/resign/ResignationRequests.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  LogOut,
  RefreshCw,
  CheckCircle2,
  Clock3,
  XCircle,
  Undo2,
} from "lucide-react";
import Card from "../common/Card";
import Button from "../common/Button";
import Spinner from "../common/Spinner";
import { resignationService } from "../../services/resignationService";
import { showToast } from "../../utils/toast";
import { refreshSidebarCounts } from "../../hooks/useSidebarCounts";

// Same badge styling as the staff self-service screen (Myresignation.jsx)
// so a request looks identical whether the staff member or an admin is
// looking at it.
const STATUS_STYLES = {
  pending: { className: "bg-amber-100 text-amber-700", icon: Clock3, label: "Pending" },
  approved: { className: "bg-green-100 text-green-700", icon: CheckCircle2, label: "Approved" },
  rejected: { className: "bg-red-100 text-red-600", icon: XCircle, label: "Rejected" },
  withdrawn: { className: "bg-gray-100 text-gray-600", icon: Undo2, label: "Withdrawn" },
};

const StatusBadge = ({ status }) => {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  const Icon = style.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium capitalize ${style.className}`}
    >
      <Icon size={12} />
      {style.label}
    </span>
  );
};

const formatDate = (d) => {
  if (!d) return "-";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

// A resignation submitted from the mobile app may come back with the staff
// name/email either flattened onto the record or nested under a populated
// `staffId` / `userId` field, depending on how the backend serializes it —
// check every shape so the row never shows "Unknown Staff".
const getStaffName = (r) =>
  r.staffName || r.userId?.staffName || r.staffId?.staffName || r.staff?.name || "Unknown Staff";
const getStaffEmail = (r) =>
  r.email || r.userId?.email || r.staffId?.email || r.staff?.email || "";

const FILTERS = ["all", "pending", "approved", "rejected", "withdrawn"];

const ResignationRequests = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");
  const [actingId, setActingId] = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const res = await resignationService.getAll();
      const list = res.data?.data ?? res.data?.resignations ?? res.data ?? [];
      setRequests(Array.isArray(list) ? list : []);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load resignation requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const visible = useMemo(() => {
    if (filter === "all") return requests;
    return requests.filter((r) => (r.status || "pending") === filter);
  }, [requests, filter]);

  const pendingCount = useMemo(
    () => requests.filter((r) => (r.status || "pending") === "pending").length,
    [requests],
  );

  const handleApprove = async (r) => {
    setActingId(r._id);
    try {
      await resignationService.approve(r._id);
      showToast("success", `${getStaffName(r)}'s resignation approved`);
      await fetchAll();
      refreshSidebarCounts();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to approve request");
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (r) => {
    setActingId(r._id);
    try {
      await resignationService.reject(r._id);
      showToast("success", `${getStaffName(r)}'s resignation rejected`);
      await fetchAll();
      refreshSidebarCounts();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to reject request");
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <LogOut className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">Resignations</h1>
          {pendingCount > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">
              {pendingCount} pending
            </span>
          )}
        </div>
        <Button variant="outline" onClick={fetchAll}>
          <RefreshCw size={16} className="mr-2" />
          Refresh
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${
              filter === f
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <Card noPadding>
        {loading ? (
          <div className="p-10 flex justify-center">
            <Spinner />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            No {filter !== "all" ? filter : ""} resignation requests to show.
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {visible.map((r) => (
              <div
                key={r._id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-800">{getStaffName(r)}</p>
                    <StatusBadge status={r.status || "pending"} />
                  </div>
                  {getStaffEmail(r) && (
                    <p className="text-xs text-gray-400">{getStaffEmail(r)}</p>
                  )}
                  <p className="text-sm text-gray-600 mt-1">
                    Last working day:{" "}
                    <span className="font-medium">{formatDate(r.lastWorkingDay)}</span>
                    {r.createdAt && (
                      <span className="text-gray-400"> &middot; submitted {formatDate(r.createdAt)}</span>
                    )}
                  </p>
                  {r.reason && <p className="text-sm text-gray-500 mt-1">{r.reason}</p>}
                </div>

                {(r.status || "pending") === "pending" && (
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="success"
                      onClick={() => handleApprove(r)}
                      disabled={actingId === r._id}
                    >
                      <CheckCircle2 size={14} />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleReject(r)}
                      disabled={actingId === r._id}
                    >
                      <XCircle size={14} />
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default ResignationRequests;
