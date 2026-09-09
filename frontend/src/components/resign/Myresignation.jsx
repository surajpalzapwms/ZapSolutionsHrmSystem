// src/components/resignation/MyResignation.jsx
import React, { useCallback, useEffect, useState } from "react";
import { LogOut, CalendarDays, CheckCircle2, Clock3, XCircle, Undo2 } from "lucide-react";
import Card from "../common/Card";
import Button from "../common/Button";
import DatePicker from "../common/DatePicker";
import TextArea from "../common/TextArea";
import Spinner from "../common/Spinner";
import Modal from "../common/Modal";
import { resignationService } from "../../services/resignationService";
import { showToast } from "../../utils/toast";

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
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to withdraw resignation");
    } finally {
      setWithdrawing(false);
    }
  };

  const noticeDays = resignation?.noticePeriodDays ?? 30;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <LogOut className="w-5 h-5 text-blue-600" />
        <h1 className="text-xl font-bold text-gray-800">My Resignation</h1>
      </div>

      {/* Notice period */}
      <Card className="text-center" bodyClassName="flex flex-col items-center">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mb-2">
          <CalendarDays className="w-6 h-6 text-indigo-600" />
        </div>
        <p className="text-sm text-gray-500">Standard notice period</p>
        <p className="text-2xl font-extrabold text-gray-800 mt-1">{noticeDays} days</p>
      </Card>

      {/* How it works */}
      <Card title="How it works">
        <div className="space-y-5">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flex gap-3">
              <div className="w-7 h-7 flex-shrink-0 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center">
                {i + 1}
              </div>
              <div>
                <p className="font-semibold text-gray-800">{step.title}</p>
                <p className="text-sm text-gray-500">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Current status / submit form */}
      {loading ? (
        <div className="p-10 flex justify-center">
          <Spinner />
        </div>
      ) : resignation ? (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-gray-800">Your resignation</h3>
            <StatusBadge status={resignation.status} />
          </div>
          <p className="text-gray-700">
            Last working day: <span className="font-semibold">{formatDate(resignation.lastWorkingDay)}</span>
          </p>
          {resignation.reason && <p className="text-sm text-gray-500 mt-1">{resignation.reason}</p>}

          {resignation.status === "pending" && (
            <Button
              variant="outline"
              fullWidth
              className="mt-5 !text-red-600 !border-red-300 hover:!bg-red-50"
              onClick={() => setConfirmOpen(true)}
            >
              Withdraw request
            </Button>
          )}
        </Card>
      ) : (
        <Card title="Submit resignation">
          <form onSubmit={handleSubmit} className="space-y-4">
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
            <TextArea
              label="Reason"
              name="reason"
              value={form.reason}
              onChange={handleChange}
              error={errors.reason}
              placeholder="Let your manager and HR know why you're leaving..."
              required
            />
            <div className="flex justify-end">
              <Button type="submit" variant="danger" loading={submitting}>
                Submit resignation
              </Button>
            </div>
          </form>
        </Card>
      )}

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