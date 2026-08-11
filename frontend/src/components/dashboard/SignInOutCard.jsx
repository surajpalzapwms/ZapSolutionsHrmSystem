// src/components/dashboard/SignInOutCard.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LogIn, LogOut, Clock, ShieldCheck } from "lucide-react";
import Card from "../common/Card";
import Spinner from "../common/Spinner";
import { attendanceService } from "../../services/attendanceService";
import { showToast } from "../../utils/toast";

// Fallbacks — only used until the backend tells us this user's actual
// values via `meta` (shiftStartTime/shiftEndTime can differ per user, e.g.
// 10:00–18:30 for most staff, 9:00–17:30 for some).
const DEFAULT_SHIFT_START = "10:00";
const DEFAULT_SHIFT_END = "18:30";
const DEFAULT_LUNCH_START = "13:30";
const DEFAULT_LUNCH_END = "14:15";
const DEFAULT_REQUIRED_MINUTES = 7 * 60 + 45; // 7h 45m net of lunch

// How often we refresh from the server while signed in — this is what
// picks up an admin's early-sign-out approval without a page refresh.
// Kept short so approval shows up quickly rather than needing a manual
// browser refresh; we also refetch immediately on tab focus below.
const STATUS_POLL_MS = 10000;
const TICK_MS = 30000;

const formatClockTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

const formatDuration = (totalMinutes) => {
  const mins = Math.max(0, Math.floor(totalMinutes || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
};

const formatShiftLabel = (hm) => {
  if (!hm) return "";
  const [h, m] = hm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const parseHM = (hm, fallback) => {
  const str =
    typeof hm === "string" && /^\d{1,2}:\d{2}$/.test(hm) ? hm : fallback;
  const [h, m] = str.split(":").map(Number);
  return { h, m };
};

const clockOn = (referenceDate, h, m) => {
  const d = new Date(referenceDate);
  d.setHours(h, m, 0, 0);
  return d;
};

const overlapMinutes = (aStart, aEnd, bStart, bEnd) => {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (end <= start) return 0;
  return Math.floor((end - start) / 60000);
};

// Mirrors the backend's getClampedWorkingMinutes: only the time inside the
// user's shift window counts, and the lunch break is subtracted from that.
const clampedWorkingMinutes = (loginTime, now, shift) => {
  const login = new Date(loginTime);
  const { h: startH, m: startM } = parseHM(
    shift.shiftStartTime,
    DEFAULT_SHIFT_START,
  );
  const { h: endH, m: endM } = parseHM(shift.shiftEndTime, DEFAULT_SHIFT_END);
  const { h: lsH, m: lsM } = parseHM(shift.lunchStart, DEFAULT_LUNCH_START);
  const { h: leH, m: leM } = parseHM(shift.lunchEnd, DEFAULT_LUNCH_END);

  const windowStart = clockOn(login, startH, startM);
  const windowEnd = clockOn(login, endH, endM);
  const lunchStart = clockOn(login, lsH, lsM);
  const lunchEnd = clockOn(login, leH, leM);

  const clampedLogin = login < windowStart ? windowStart : login;
  const clampedNow = now > windowEnd ? windowEnd : now;
  if (clampedNow <= clampedLogin) return 0;

  const gross = Math.floor((clampedNow - clampedLogin) / 60000);
  const lunch = overlapMinutes(clampedLogin, clampedNow, lunchStart, lunchEnd);
  return Math.max(0, gross - lunch);
};

const SignInOutCard = () => {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [attendance, setAttendance] = useState(null);
  const [meta, setMeta] = useState(null);
  const [liveMinutes, setLiveMinutes] = useState(0);
  const [statusError, setStatusError] = useState(false);

  const fetchStatus = useCallback(async () => {
    setStatusError(false);
    try {
      const res = await attendanceService.getMyTodayAttendance();
      setAttendance(res.data?.attendance || null);
      setMeta(res.data?.meta || null);
    } catch (err) {
      setStatusError(true);
      showToast(
        "error",
        err.response?.data?.message ||
          "Couldn't load today's attendance status",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Listen for login/logout events to refresh the status
  useEffect(() => {
    const handleLogin = () => {
      fetchStatus();
    };

    // Add event listener for user login
    window.addEventListener("userLoggedIn", handleLogin);
    // Also listen for storage changes (if token is updated in another tab)
    const handleStorageChange = (e) => {
      if (e.key === "token") {
        fetchStatus();
      }
    };
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("userLoggedIn", handleLogin);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [fetchStatus]);

  // Refetch the moment the tab/window regains focus or becomes visible again
  // — so switching back to this tab after an admin approves shows the
  // updated Sign Out state right away instead of waiting for the next poll.
  useEffect(() => {
    const handleFocus = () => fetchStatus();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchStatus();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchStatus]);

  const isSignedIn = !!attendance?.loginTime && !attendance?.logoutTime;
  const isSignedOut = !!attendance?.loginTime && !!attendance?.logoutTime;

  const shift = useMemo(
    () => ({
      shiftStartTime: meta?.shiftStartTime || DEFAULT_SHIFT_START,
      shiftEndTime: meta?.shiftEndTime || DEFAULT_SHIFT_END,
      lunchStart: meta?.lunchStart || DEFAULT_LUNCH_START,
      lunchEnd: meta?.lunchEnd || DEFAULT_LUNCH_END,
    }),
    [meta],
  );
  const requiredMinutes = meta?.requiredMinutes || DEFAULT_REQUIRED_MINUTES;

  // REMOVED: earlySignOutApproved check - staff can sign out anytime now
  // const earlySignOutApproved = !!meta?.earlySignOutApproved;

  // Live ticking timer while signed in — recomputed from loginTime + the
  // user's shift/lunch window, same formula the backend enforces. Also
  // re-polls the server periodically so an admin's early-sign-out approval
  // (or a shift change) shows up without a page refresh.
  useEffect(() => {
    if (!isSignedIn) {
      setLiveMinutes(0);
      return undefined;
    }

    const recompute = () => {
      const sessionSoFar = clampedWorkingMinutes(
        attendance.loginTime,
        new Date(),
        shift,
      );
      setLiveMinutes((attendance.sessionMinutes || 0) + sessionSoFar);
    };
    recompute();

    const tickId = setInterval(recompute, TICK_MS);
    const pollId = setInterval(fetchStatus, STATUS_POLL_MS);
    return () => {
      clearInterval(tickId);
      clearInterval(pollId);
    };
  }, [
    isSignedIn,
    attendance?.loginTime,
    attendance?.sessionMinutes,
    shift,
    fetchStatus,
  ]);

  const remainingMinutes = Math.max(0, requiredMinutes - liveMinutes);
  const requiredMet = liveMinutes >= requiredMinutes;

  // REMOVED: earlySignOutApproved condition - staff can sign out regardless of hours worked
  const canSignOut = isSignedIn; // Staff can always sign out when signed in

  const handleSignIn = async () => {
    setSubmitting(true);
    try {
      const res = await attendanceService.signIn();
      setAttendance(res.data?.attendance || null);
      setMeta(res.data?.meta || null);
      showToast("success", res.data?.message || "Signed in successfully");
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to sign in");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    if (!canSignOut) return;
    setSubmitting(true);
    try {
      const res = await attendanceService.signOut();
      setAttendance(res.data?.attendance || null);
      setMeta(res.data?.meta || null);
      showToast("success", res.data?.message || "Signed out successfully");
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to sign out");
      // The backend may have refused because the requirement wasn't met —
      // resync so the button state matches the server's view.
      fetchStatus();
    } finally {
      setSubmitting(false);
    }
  };

  const workedLabel = useMemo(() => {
    if (isSignedOut)
      return attendance.totalTime?.slice(0, 5) || formatDuration(0);
    if (isSignedIn) return formatDuration(liveMinutes);
    return null;
  }, [isSignedOut, isSignedIn, attendance, liveMinutes]);

  if (loading) {
    return (
      <div className="max-w-md mx-auto mb-6">
        <Card noPadding>
          <div className="flex items-center justify-center py-8">
            <Spinner size="sm" />
          </div>
        </Card>
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="max-w-md mx-auto mb-6">
        <Card noPadding>
          <div className="p-5 flex items-center justify-between gap-4">
            <p className="text-sm text-red-500">
              Couldn't check today's attendance status.
            </p>
            <button
              onClick={fetchStatus}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            >
              Retry
            </button>
          </div>
        </Card>
      </div>
    );
  }

  // Determine button state
  const renderButton = () => {
    // If user has signed out for the day
    if (isSignedOut) {
      return (
        <span className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-500 w-full">
          Day complete
        </span>
      );
    }

    // If user is signed in (has loginTime but no logoutTime)
    if (isSignedIn) {
      return (
        <div className="flex flex-col gap-1.5">
          <button
            onClick={handleSignOut}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors w-full bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
          >
            <LogOut size={16} />
            {submitting ? "Signing out..." : "Sign Out"}
          </button>
          {/* REMOVED: the status message about required hours and admin approval */}
          {/* Staff can now sign out freely - show optional remaining time info */}
          {isSignedIn && !requiredMet && (
            <p className="text-[11px] text-center text-gray-400">
              {formatDuration(remainingMinutes)} remaining to meet shift
              requirement
            </p>
          )}
        </div>
      );
    }

    return (
      <button
        onClick={handleSignIn}
        disabled={submitting}
        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors w-full"
      >
        <LogIn size={16} />
        {submitting ? "Signing in..." : "Sign In"}
      </button>
    );
  };

  return (
    <div className="max-w-md">
      <Card noPadding>
        <div className="p-4 flex flex-col gap-3">
          {/* Header Section - Fixed with justify-between */}
          <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
            <div
              className={`p-2 rounded-full shrink-0 ${
                isSignedIn
                  ? "text-emerald-600 bg-emerald-50"
                  : isSignedOut
                    ? "text-gray-500 bg-gray-100"
                    : "text-blue-600 bg-blue-50"
              }`}
            >
              <Clock size={18} />
            </div>
            <div className="flex-1 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                Attendance
                {isSignedIn && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE
                  </span>
                )}
              </p>
              <p className="text-[10px] text-gray-400 whitespace-nowrap">
                {formatShiftLabel(shift.shiftStartTime)} –{" "}
                {formatShiftLabel(shift.shiftEndTime)}
              </p>
            </div>
          </div>

          {/* Status Details - Each on its own line with label left, value right */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Status</span>
              <span
                className={`text-sm font-semibold ${
                  isSignedIn
                    ? "text-emerald-600"
                    : isSignedOut
                      ? "text-gray-700"
                      : "text-red-500"
                }`}
              >
                {isSignedIn
                  ? "Signed In"
                  : isSignedOut
                    ? "Completed"
                    : "Not Signed In"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Login</span>
              <span className="text-sm font-medium text-gray-700">
                {attendance?.loginTime
                  ? formatClockTime(attendance.loginTime)
                  : "--"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Worked</span>
              <span className="text-sm font-semibold text-blue-600">
                {workedLabel || "--"}
              </span>
            </div>

            {/* Remaining time — only meaningful while signed in and short of the requirement */}
            {isSignedIn && !requiredMet && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Remaining</span>
                <span className="text-sm font-semibold text-amber-600">
                  {formatDuration(remainingMinutes)}
                </span>
              </div>
            )}

            {/* REMOVED: Admin approval badge section */}

            {/* Logout Time (only if signed out) */}
            {isSignedOut && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Logout</span>
                <span className="text-sm font-medium text-gray-700">
                  {attendance?.logoutTime
                    ? formatClockTime(attendance.logoutTime)
                    : "--"}
                </span>
              </div>
            )}
          </div>

          {/* Action Button */}
          <div className="mt-2">{renderButton()}</div>
        </div>
      </Card>
    </div>
  );
};

export default SignInOutCard;
