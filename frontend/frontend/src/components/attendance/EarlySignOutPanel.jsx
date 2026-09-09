// src/components/attendance/EarlySignOutPanel.jsx
import React, { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldOff, RefreshCcw } from "lucide-react";
import { attendanceService } from "../../services/attendanceService";
import { showToast } from "../../utils/toast";
import Spinner from "../common/Spinner";

const formatDuration = (totalMinutes) => {
  const mins = Math.max(0, Math.floor(totalMinutes || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
};

const formatClockTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "-";

const EarlySignOutPanel = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await attendanceService.getOpenAttendanceToday();
      setRecords(res.data?.records || []);
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Couldn't load today's signed-in staff",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  const toggleApproval = async (userId, allow) => {
    setBusyId(userId);
    try {
      const res = await attendanceService.setEarlySignOutPermission(userId, allow);
      showToast("success", res.data?.message || "Updated");
      await load();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to update permission");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">
          Currently Signed In — Early Sign-Out Approvals 1
        </h3>
        <button
          onClick={load}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          title="Refresh"
        >
          <RefreshCcw size={15} />
        </button>
      </div>

      {loading && !records.length ? (
        <div className="flex justify-center py-6">
          <Spinner size="sm" />
        </div>
      ) : records.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">
          No one is currently signed in.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100">
          {records.map((r) => {
            const requiredMet = r.workedMinutes >= r.requiredMinutes;
            return (
              <div
                key={r.attendanceId}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{r.name}</p>
                  <p className="text-xs text-gray-400">
                    In at {formatClockTime(r.loginTime)} · Worked{" "}
                    {formatDuration(r.workedMinutes)}
                    {!requiredMet && ` · ${formatDuration(r.remainingMinutes)} left`}
                  </p>
                </div>

                {r.earlySignOutApproved ? (
                  <button
                    onClick={() => toggleApproval(r.userId, false)}
                    disabled={busyId === r.userId}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 shrink-0"
                  >
                    <ShieldCheck size={13} />
                    Approved
                  </button>
                ) : (
                  <button
                    onClick={() => toggleApproval(r.userId, true)}
                    disabled={busyId === r.userId || requiredMet}
                    title={
                      requiredMet
                        ? "Already met the required working hours"
                        : "Allow this user to sign out early"
                    }
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50 shrink-0"
                  >
                    <ShieldOff size={13} />
                    {requiredMet ? "Not needed" : "Allow Early Sign-Out"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EarlySignOutPanel;
