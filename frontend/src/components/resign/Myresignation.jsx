// src/components/resignation/MyResignation.jsx
import React, { useCallback, useEffect, useState } from "react";
import {
  LogOut,
  CalendarDays,
  CheckCircle2,
  Clock3,
  XCircle,
  Undo2,
  Check,
  Info,
  Send,
} from "lucide-react";
import Button from "../common/Button";
import DatePicker from "../common/DatePicker";
import TextArea from "../common/TextArea";
import Spinner from "../common/Spinner";
import Modal from "../common/Modal";
import { resignationService } from "../../services/resignationService";
import { showToast } from "../../utils/toast";
import { refreshSidebarCounts } from "../../hooks/useSidebarCounts";

// Mirrors the mobile app's ResignPanel "How it works" steps exactly, so
// staff see the same process on either platform.
const STEPS = [
  { title: "Submit request", description: "Share your last working day and reason for leaving." },
  { title: "Manager review", description: "Your reporting manager reviews and countersigns the request." },
  { title: "HR clearance", description: "HR schedules an exit interview and settles handover items." },
  { title: "Full & final settlement", description: "Dues are settled and the relieving letter is issued." },
];

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

const emptyForm = { lastWorkingDay: "", reason: "" };

// When an admin rejects with remarks the backend stores them inside the
// reason as "your reason [Admin: remarks]". Pull them apart so a rejected
// request can show "what you wrote" and "what the admin said" separately.
const splitAdminRemarks = (reason = "") => {
  const m = String(reason).match(/^([\s\S]*?)\s*\[Admin:\s*([\s\S]*?)\]\s*$/);
  return m ? { text: m[1].trim(), remarks: m[2].trim() } : { text: String(reason).trim(), remarks: "" };
};

const MyResignation = () => {
  const [resignation, setResignation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetchMine = useCallback(async () => {
    try {
      setLoading(true);
      const res = await resignationService.getMine();
      setResignation(res.data?.data || null);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load your resignation status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMine();
  }, [fetchMine]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const validate = () => {
    const next = {};
    if (!form.lastWorkingDay) next.lastWorkingDay = "Please select your last working day";
    if (!form.reason.trim()) next.reason = "Please add a reason";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await resignationService.submit({
        lastWorkingDay: form.lastWorkingDay,
        reason: form.reason.trim(),
      });
      setResignation(res.data?.data || null);
      setForm(emptyForm);
      showToast("success", res.data?.message || "Resignation submitted.");
      refreshSidebarCounts();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to submit resignation");
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    setWithdrawing(true);
    try {
      await resignationService.withdraw();
      showToast("success", "Resignation withdrawn.");
      setConfirmOpen(false);
      await fetchMine();
      refreshSidebarCounts();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to withdraw resignation");
    } finally {
      setWithdrawing(false);
    }
  };

  const noticeDays = resignation?.noticePeriodDays ?? 30;

  // A rejected request is closed: the staff member is free to apply again,
  // so it must show the apply form (with the rejection details on top)
  // instead of a dead-end read-only card. Only pending/approved requests
  // are "active" and block a new submission (same rule as the backend).
  const isRejected = resignation?.status === "rejected";
  const hasActiveRequest = !!resignation && !isRejected;
  const rejectedInfo = isRejected ? splitAdminRemarks(resignation.reason) : null;

  // Where the request is in the 4-step process, for the timeline on the
  // right: index of the step currently in progress (-1 = nothing yet).
  const currentStep = !hasActiveRequest
    ? 0
    : resignation.status === "pending"
      ? 1
      : resignation.status === "approved"
        ? 2
        : -1;

  // Suggested last working day = today + notice period.
  const noticeEnd = new Date();
  noticeEnd.setDate(noticeEnd.getDate() + noticeDays);
  const noticeEndLabel = formatDate(noticeEnd);

  const daysLeft = resignation?.lastWorkingDay
    ? Math.ceil(
        (new Date(resignation.lastWorkingDay).setHours(0, 0, 0, 0) -
          new Date().setHours(0, 0, 0, 0)) /
          86400000,
      )
    : null;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:h-full lg:overflow-hidden">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center shadow-sm">
            <LogOut className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800 leading-tight">My Resignation</h1>
            <p className="text-xs text-gray-500">Submit and track your resignation request</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-gray-200 shadow-sm text-sm text-gray-600">
          <CalendarDays className="w-4 h-4 text-indigo-600" />
          Notice period
          <span className="font-bold text-gray-800">{noticeDays} days</span>
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:flex-1 lg:min-h-0">
        {/* ── Left: form or current status ─────────────────────────── */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col lg:min-h-0">
          {loading ? (
            <div className="flex-1 flex items-center justify-center p-10">
              <Spinner />
            </div>
          ) : hasActiveRequest ? (
            <>
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-800">Your resignation</h3>
                <StatusBadge status={resignation.status} />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
                    <p className="text-xs text-gray-500">Last working day</p>
                    <p className="text-lg font-bold text-gray-800 mt-1">
                      {formatDate(resignation.lastWorkingDay)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
                    <p className="text-xs text-gray-500">
                      {daysLeft != null && daysLeft < 0 ? "Relieved" : "Days remaining"}
                    </p>
                    <p className="text-lg font-bold text-gray-800 mt-1">
                      {daysLeft == null
                        ? "-"
                        : daysLeft < 0
                          ? `${Math.abs(daysLeft)} days ago`
                          : `${daysLeft} ${daysLeft === 1 ? "day" : "days"}`}
                    </p>
                  </div>
                </div>
                {resignation.reason && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Reason</p>
                    <p className="text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded-xl p-4 whitespace-pre-line">
                      {resignation.reason}
                    </p>
                  </div>
                )}
              </div>
              {resignation.status === "pending" && (
                <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500">
                    Changed your mind? You can withdraw while it&apos;s pending.
                  </p>
                  <Button
                    variant="outline"
                    className="whitespace-nowrap !text-red-600 !border-red-300 hover:!bg-red-50"
                    onClick={() => setConfirmOpen(true)}
                  >
                    <Undo2 size={15} />
                    Withdraw
                  </Button>
                </div>
              )}
            </>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 lg:min-h-0">
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-800">
                  {isRejected ? "Submit a new resignation" : "Submit resignation"}
                </h3>
                {isRejected && <StatusBadge status="rejected" />}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-4">
                {isRejected && (
                  <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm">
                    <p className="font-semibold text-red-700">
                      Your previous resignation request was rejected
                    </p>
                    <p className="text-red-700/80 mt-1">
                      Last working day requested:{" "}
                      <span className="font-medium">{formatDate(resignation.lastWorkingDay)}</span>
                    </p>
                    {rejectedInfo?.text && (
                      <p className="text-red-700/80 mt-1 whitespace-pre-line">
                        Your reason: {rejectedInfo.text}
                      </p>
                    )}
                    {rejectedInfo?.remarks && (
                      <p className="text-red-800 mt-1 whitespace-pre-line">
                        <span className="font-semibold">Admin remarks:</span> {rejectedInfo.remarks}
                      </p>
                    )}
                    <p className="text-red-700/80 mt-2">
                      You can apply again - choose a new last working day and add your reason below.
                    </p>
                  </div>
                )}
                <div>
                  <DatePicker
                    label="Last Working Day"
                    name="lastWorkingDay"
                    value={form.lastWorkingDay}
                    onChange={handleChange}
                    error={errors.lastWorkingDay}
                    minDate={new Date()}
                    maxDate={new Date(new Date().getFullYear() + 1, 11, 31)}
                    required
                  />
                  <p className="flex items-start gap-1.5 text-xs text-gray-500 mt-1.5">
                    <Info size={13} className="text-indigo-500 mt-px flex-shrink-0" />
                    <span>
                      With a {noticeDays}-day notice period, your notice ends on{" "}
                      <span className="font-medium text-gray-700">{noticeEndLabel}</span>.
                    </span>
                  </p>
                </div>
                <div className="flex-1 flex flex-col min-h-[8rem] [&>div]:flex-1 [&_textarea]:flex-1 [&_textarea]:max-h-64">
                  <TextArea
                    label="Reason"
                    name="reason"
                    value={form.reason}
                    onChange={handleChange}
                    error={errors.reason}
                    placeholder="Let your manager and HR know why you're leaving..."
                    className="resize-none text-sm"
                    required
                  />
                </div>
              </div>
              <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl flex items-center justify-between gap-3">
                <p className="hidden sm:block text-xs text-gray-500">
                  Your manager and HR will be notified.
                </p>
                <Button
                  type="submit"
                  variant="danger"
                  loading={submitting}
                  className="whitespace-nowrap flex-shrink-0"
                >
                  <Send size={15} />
                  Submit resignation
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* ── Right: how it works ─────────────────────────────────── */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col lg:min-h-0">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-800">How it works</h3>
          </div>
          <ol className="flex-1 min-h-0 overflow-y-auto p-5">
            {STEPS.map((step, i) => {
              const done = currentStep > i;
              const active = currentStep === i;
              const last = i === STEPS.length - 1;
              return (
                <li key={step.title} className="relative flex gap-3 pb-6 last:pb-0">
                  {!last && (
                    <span
                      className={`absolute left-[15px] top-8 bottom-0 w-0.5 ${
                        done ? "bg-emerald-400" : "bg-gray-200"
                      }`}
                    />
                  )}
                  <div
                    className={`relative z-10 w-8 h-8 flex-shrink-0 rounded-full font-bold text-sm flex items-center justify-center ${
                      done
                        ? "bg-emerald-500 text-white"
                        : active
                          ? "bg-indigo-600 text-white ring-4 ring-indigo-100"
                          : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {done ? <Check size={16} strokeWidth={3} /> : i + 1}
                  </div>
                  <div className="pt-1">
                    <p
                      className={`font-semibold text-sm ${
                        active ? "text-indigo-700" : "text-gray-800"
                      }`}
                    >
                      {step.title}
                      {active && hasActiveRequest && (
                        <span className="ml-2 text-[11px] font-medium text-indigo-500">
                          In progress
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Withdraw resignation"
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={withdrawing}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleWithdraw} loading={withdrawing}>
              Withdraw
            </Button>
          </>
        }
      >
        <p className="text-gray-600">Are you sure you want to withdraw your resignation request?</p>
      </Modal>
    </div>
  );
};

export default MyResignation;