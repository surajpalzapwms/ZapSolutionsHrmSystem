// src/components/invite/AcceptInvite.jsx
//
// PUBLIC page: /invite/:token
// The person who got a one-time admin link creates their OWN login here —
// nobody types a password for them. The link works once.
//   - company-admin link (from the super admin): becomes THE admin of the company
//   - branch-admin link  (from the company admin): becomes THE admin of one branch
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Eye, EyeOff, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import Spinner from "../common/Spinner";
import PhoneInput from "../common/PhoneInput";
import { inviteService } from "../../services/inviteService";
import { loadBrandFromServer } from "../../utils/brand";
import { showToast } from "../../utils/toast";

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary,#2563eb)]";
const MIN_PASSWORD = 8;
const errMsg = (err, fallback) => err?.response?.data?.message || fallback;

export default function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, invite: null, error: "" });
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", contactNumber: "", password: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let alive = true;
    inviteService
      .get(token)
      .then((res) => {
        if (!alive) return;
        const invite = res.data?.data;
        setState({ loading: false, invite, error: "" });
        setForm((f) => ({ ...f, email: invite?.email || "" }));
        // Show the company's own logo / colours while the person signs up.
        if (invite?.companySlug) loadBrandFromServer({ company: invite.companySlug });
      })
      .catch((err) => alive && setState({ loading: false, invite: null, error: errMsg(err, "This invite link is not valid.") }));
    return () => {
      alive = false;
    };
  }, [token]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.firstName.trim()) return showToast("error", "Please enter your first name");
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return showToast("error", "Please enter a valid e-mail address");
    if (form.password.length < MIN_PASSWORD) return showToast("error", `Password must be at least ${MIN_PASSWORD} characters`);
    if (form.password !== form.confirm) return showToast("error", "The two passwords do not match");
    setSaving(true);
    try {
      const res = await inviteService.accept(token, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        contactNumber: /^\+\d+\s*$/.test(form.contactNumber.trim()) ? "" : form.contactNumber.trim(),
        password: form.password,
      });
      setDone(res.data?.data || {});
    } catch (err) {
      showToast("error", errMsg(err, "Could not create your account"));
    } finally {
      setSaving(false);
    }
  };

  const { loading, invite, error } = state;
  const isBranch = invite?.type === "branch-admin";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-lg border border-gray-100 p-6 sm:p-8">
        {loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : error ? (
          <div className="text-center space-y-3 py-4">
            <AlertTriangle className="mx-auto text-amber-500" size={36} />
            <h1 className="text-lg font-bold text-gray-800">Invite link problem</h1>
            <p className="text-sm text-gray-600">{error}</p>
            <button type="button" onClick={() => navigate("/login")} className="text-sm font-semibold text-[var(--brand-primary,#2563eb)]">
              Go to login
            </button>
          </div>
        ) : done ? (
          <div className="text-center space-y-3 py-4">
            <CheckCircle2 className="mx-auto text-emerald-500" size={40} />
            <h1 className="text-lg font-bold text-gray-800">Your account is ready</h1>
            <p className="text-sm text-gray-600">
              You can now log in to <b>{done.companyName}</b>
              {done.branchName ? <> — branch <b>{done.branchName}</b></> : null} with <b>{done.email}</b> and the password you chose.
            </p>
            <button
              type="button"
              onClick={() => navigate(`/login?company=${encodeURIComponent(done.companySlug || "")}`, { replace: true })}
              className="mt-2 w-full rounded-lg bg-[var(--brand-primary,#2563eb)] px-4 py-2.5 text-sm font-semibold text-white"
            >
              Go to login
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="text-center space-y-1">
              <ShieldCheck className="mx-auto text-[var(--brand-primary,#2563eb)]" size={34} />
              <h1 className="text-xl font-bold text-gray-800">{isBranch ? "Create your branch admin account" : "Create your admin account"}</h1>
              <p className="text-sm text-gray-600">
                {invite.companyName}
                {isBranch ? <> · <b>{invite.branchName}</b> branch</> : null}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input className={inputCls} placeholder="First name *" value={form.firstName} onChange={set("firstName")} autoComplete="given-name" />
              <input className={inputCls} placeholder="Last name" value={form.lastName} onChange={set("lastName")} autoComplete="family-name" />
            </div>
            <input
              type="email"
              className={`${inputCls} ${invite.email ? "bg-gray-100" : ""}`}
              placeholder="Your login e-mail *"
              value={form.email}
              onChange={set("email")}
              readOnly={!!invite.email}
              autoComplete="email"
            />
            <PhoneInput name="contactNumber" value={form.contactNumber} onChange={(e) => setForm((f) => ({ ...f, contactNumber: e.target.value }))} />
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                className={`${inputCls} pr-10`}
                placeholder={`Password (${MIN_PASSWORD}+ characters) *`}
                value={form.password}
                onChange={set("password")}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" aria-label="Show or hide password">
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <input
              type={showPw ? "text" : "password"}
              className={inputCls}
              placeholder="Confirm password *"
              value={form.confirm}
              onChange={set("confirm")}
              autoComplete="new-password"
            />
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-[var(--brand-primary,#2563eb)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Creating…" : "Create my account"}
            </button>
            <p className="text-center text-xs text-gray-500">This link works only once.</p>
          </form>
        )}
      </div>
    </div>
  );
}
