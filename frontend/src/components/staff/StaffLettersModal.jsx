
import React, { useCallback, useEffect, useState } from "react";
import { Download, Eye, ExternalLink, FilePlus2, Pencil, Undo2 } from "lucide-react";
import Modal from "../common/Modal";
import Spinner from "../common/Spinner";
import { letterService } from "../../services/letterService";
import { showToast } from "../../utils/toast";
import { confirmDialog } from "../../utils/confirmationDialog";
import LetterDetailsModal from "./LetterDetailsModal";

// Every letter opens the details form before generating:
//   Offer / Joining / Confirmation — name, Mr./Ms., designation, salary…
//   Termination — works for ANY staff member: pick the last working day
//                 (past, today or a future date).
//   Leaving / Experience — the last working day comes from the staff
//                 member's resignation; otherwise pick any date.
const FORM_LETTERS = ["offer", "joining", "confirmation", "termination", "leaving", "experience"];
// These need a last working day chosen in the form, so they can only be
// previewed / downloaded once generated.
const RELIEVING_LETTERS = ["termination", "leaving", "experience"];
const canOpen = (l) => l.eligible && (l.issued || !RELIEVING_LETTERS.includes(l.type));

const fmt = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";

const StaffLettersModal = ({ isOpen, onClose, staff }) => {
  const [letters, setLetters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null); // letter type being changed
  const [formFor, setFormFor] = useState(null); // letter whose details form is open
  // In-app PDF preview: { letter, url } — check the letter here first, then
  // download only once it looks right.
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const staffId = staff?._id;

  const load = useCallback(async () => {
    if (!staffId) return;
    try {
      setLoading(true);
      const res = await letterService.getForStaff(staffId);
      setLetters(res.data?.data || []);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load letters");
    } finally {
      setLoading(false);
    }
  }, [staffId]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  // Free the blob URL whenever the preview changes or closes.
  useEffect(() => {
    const url = preview?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview?.url]);

  const fileName = (l) =>
    `${l.title.replace(/\s+/g, "_")}-${(staff?.staffName || "staff").replace(/\s+/g, "_")}.pdf`;

  const openPreview = async (l) => {
    try {
      setBusy(l.type);
      setPreviewLoading(true);
      setPreview({ letter: l, url: null });
      const res = await letterService.download(staffId, l.type);
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      setPreview({ letter: l, url });
    } catch {
      setPreview(null);
      showToast("error", "Failed to load the letter preview");
    } finally {
      setPreviewLoading(false);
      setBusy(null);
    }
  };

  const closePreview = () => setPreview(null);

  const downloadPreviewed = () => {
    if (!preview?.url) return;
    const a = document.createElement("a");
    a.href = preview.url;
    a.download = fileName(preview.letter);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const issue = async (l) => {
    if (FORM_LETTERS.includes(l.type)) {
      setFormFor(l);
      return;
    }
    try {
      setBusy(l.type);
      const res = await letterService.issue(staffId, l.type);
      setLetters(res.data?.data || []);
      showToast("success", `${l.title} generated — now enabled for ${staff.staffName}`);
      openPreview(l);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to generate letter");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (l) => {
    const ok = await confirmDialog({
      text: `Withdraw <b>${l.title}</b>? It will be disabled in ${staff.staffName}'s app.`,
      icon: "warning",
      confirmButtonText: "Yes, withdraw",
    });
    if (!ok.isConfirmed) return;
    try {
      setBusy(l.type);
      const res = await letterService.revoke(staffId, l.type);
      setLetters(res.data?.data || []);
      showToast("success", `${l.title} withdrawn`);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to withdraw letter");
    } finally {
      setBusy(null);
    }
  };

  const download = async (l) => {
    try {
      setBusy(l.type);
      const res = await letterService.download(staffId, l.type);
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(l);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      showToast("error", "Failed to download letter");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={staff ? `${staff.staffName} — Letters` : "Letters"}
      size="max-w-2xl"
    >
      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 mb-2">
            Letters stay disabled in the staff member's app until you generate them here.
          </p>
          {letters.map((l) => (
            <div
              key={l.type}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                l.issued ? "border-green-200 bg-green-50/50" : "border-gray-200"
              }`}
            >
              <div>
                <p className="font-medium text-gray-800">{l.title}</p>
                <p className="text-xs">
                  {l.issued ? (
                    <span className="text-green-700">
                      Generated {fmt(l.issuedAt)}
                      {l.issuedByName ? ` by ${l.issuedByName}` : ""}
                      {!l.eligible && (
                        <span className="text-amber-600"> · {l.reason}</span>
                      )}
                    </span>
                  ) : l.eligible ? (
                    <span className="text-gray-500">
                      Not generated — disabled for staff
                      {RELIEVING_LETTERS.includes(l.type) ? " · you'll choose the last working day" : ""}
                    </span>
                  ) : (
                    <span className="text-amber-600">{l.reason}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canOpen(l) && (
                  <button
                    type="button"
                    onClick={() => download(l)}
                    disabled={busy === l.type}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                    title="Download PDF"
                  >
                    <Download size={14} /> PDF
                  </button>
                )}
                {l.issued && FORM_LETTERS.includes(l.type) && (
                  <button
                    type="button"
                    onClick={() => setFormFor(l)}
                    disabled={busy === l.type}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                    title="Change the details on this letter and generate it again"
                  >
                    <Pencil size={14} /> Edit details
                  </button>
                )}
                {l.issued ? (
                  <button
                    type="button"
                    onClick={() => revoke(l)}
                    disabled={busy === l.type}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"
                  >
                    <Undo2 size={14} /> Withdraw
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => issue(l)}
                    disabled={!l.eligible || busy === l.type}
                    title={l.eligible ? "Generate and enable for staff" : l.reason}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    <FilePlus2 size={14} /> Generate
                  </button>
                )}
                {canOpen(l) && (
                  <button
                    type="button"
                    onClick={() => openPreview(l)}
                    disabled={busy === l.type}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50"
                    title="Preview the letter before downloading"
                  >
                    <Eye size={14} /> Preview
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <LetterDetailsModal
        isOpen={!!formFor}
        onClose={() => setFormFor(null)}
        staff={staff}
        letter={formFor}
        onGenerated={(rows) => {
          if (rows.length) setLetters(rows);
          // Show the regenerated letter straight away so the change can be
          // checked without downloading it.
          if (formFor) openPreview(formFor);
        }}
      />
      <Modal
        isOpen={!!preview}
        onClose={closePreview}
        title={preview ? `Preview — ${preview.letter.title}` : "Preview"}
        size="max-w-4xl"
        bodyClassName="!p-0 bg-gray-100"
        actions={
          <>
            {preview?.url && (
              <a
                href={preview.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                <ExternalLink size={15} /> Open in new tab
              </a>
            )}
            {preview?.letter && FORM_LETTERS.includes(preview.letter.type) &&
              letters.find((x) => x.type === preview.letter.type)?.issued && (
              <button
                type="button"
                onClick={() => {
                  const l = preview.letter;
                  closePreview();
                  setFormFor(l);
                }}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100"
              >
                <Pencil size={15} /> Edit details
              </button>
            )}
            <button
              type="button"
              onClick={downloadPreviewed}
              disabled={!preview?.url}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Download size={15} /> Download PDF
            </button>
          </>
        }
      >
        {previewLoading || !preview?.url ? (
          <div className="flex items-center justify-center h-[70vh]">
            <Spinner />
          </div>
        ) : (
          <iframe
            title="Letter preview"
            src={`${preview.url}#toolbar=0&navpanes=0&view=FitH`}
            className="w-full h-[70vh] border-0 block"
          />
        )}
      </Modal>
    </Modal>
  );
};

export default StaffLettersModal;
