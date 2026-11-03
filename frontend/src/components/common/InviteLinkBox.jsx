// src/components/common/InviteLinkBox.jsx
// Shows a freshly made one-time invite link with Copy / WhatsApp / E-mail.
// The link exists only right after it is created (the server keeps just a
// hash), so this box is where it must be copied from.
import React, { useState } from "react";
import { Copy, Check, Mail, MessageCircle } from "lucide-react";
import { inviteLinkFor } from "../../utils/company";
import { showToast } from "../../utils/toast";

export default function InviteLinkBox({ token, expiresAt, what = "admin account", lockedEmail }) {
  const link = inviteLinkFor(token);
  const [copied, setCopied] = useState(false);
  const message = `You have been invited to create your ${what}. Open this one-time link and set your own name, e-mail and password:\n${link}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("error", "Could not copy — select the link and copy it by hand");
    }
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
      <div className="text-sm font-semibold text-emerald-900">Invite link ready — send it to the person</div>
      <div className="flex gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-0 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs sm:text-sm text-gray-800"
        />
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800"
        >
          <MessageCircle size={14} /> WhatsApp
        </a>
        <a
          href={`mailto:${lockedEmail || ""}?subject=${encodeURIComponent("Your admin invite")}&body=${encodeURIComponent(message)}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800"
        >
          <Mail size={14} /> E-mail
        </a>
      </div>
      <p className="text-xs text-emerald-800">
        Works <b>once</b>
        {expiresAt ? <> and expires on {new Date(expiresAt).toLocaleDateString()}</> : null}. This link is shown only now
        — copy it before closing. If it is lost, make a new link (the old one stops working).
      </p>
    </div>
  );
}
