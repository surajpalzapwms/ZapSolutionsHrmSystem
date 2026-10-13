// src/components/staff/StaffDocumentsSection.jsx
// Staff details: profile photo + Aadhaar card, PAN card, light bill.
// Admin / super admin can view, upload (image or PDF), replace and remove.
// The same files staff upload themselves from the mobile app.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Eye, Trash2, Upload, FileText, ImageIcon } from "lucide-react";
import Button from "../common/Button";
import Spinner from "../common/Spinner";
import { documentService, fileUrl, readFileForUpload } from "../../services/documentService";
import { formatDateToDDMMMYYYY } from "../../utils/dateUtils";
import { showToast } from "../../utils/toast";

const MAX_BYTES = 8 * 1024 * 1024;

const initials = (name = "") => {
  const w = String(name).trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase();
};

const StaffDocumentsSection = ({ staffId, staffName }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const inputRef = useRef(null);
  const pendingType = useRef(null);

  const load = useCallback(async () => {
    if (!staffId) return;
    try {
      setLoading(true);
      const res = await documentService.getForStaff(staffId);
      setData(res.data?.data || null);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [staffId]);

  useEffect(() => {
    load();
  }, [load]);

  const pick = (type) => {
    pendingType.current = type;
    if (inputRef.current) {
      inputRef.current.accept = type === "photo" ? "image/*" : "image/*,application/pdf";
      inputRef.current.value = "";
      inputRef.current.click();
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    const type = pendingType.current;
    if (!file || !type) return;
    if (file.size > MAX_BYTES) {
      showToast("error", "File is too large (max 8 MB)");
      return;
    }
    let number = "";
    if (type === "aadhaar" || type === "pan") {
      number =
        window.prompt(
          type === "pan" ? "PAN number (optional, e.g. ABCDE1234F)" : "Aadhaar number (optional, 12 digits)",
          data?.documents?.find((d) => d.type === type)?.number || "",
        ) || "";
    }
    setBusy(type);
    try {
      const payload = { type, number, ...(await readFileForUpload(file)) };
      const res = await documentService.uploadForStaff(staffId, payload);
      setData(res.data?.data || null);
      showToast("success", res.data?.message || "Uploaded");
    } catch (err) {
      showToast("error", err.response?.data?.message || "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Remove ${doc.label} for ${staffName}?`)) return;
    setBusy(doc.type);
    try {
      const res = await documentService.deleteForStaff(staffId, doc.type);
      setData(res.data?.data || null);
      showToast("success", res.data?.message || "Removed");
    } catch (err) {
      showToast("error", err.response?.data?.message || "Could not remove");
    } finally {
      setBusy(null);
    }
  };

  const docs = data?.documents || [];
  const photo = docs.find((d) => d.type === "photo");
  const others = docs.filter((d) => d.type !== "photo");

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
        Photo &amp; Documents
      </p>
      <input ref={inputRef} type="file" className="hidden" onChange={onFile} />

      {loading ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : !data ? null : (
        <div className="space-y-2">
          {/* Profile photo */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
            <div className="flex items-center gap-3">
              {data.photoUrl ? (
                <img
                  src={fileUrl(data.photoUrl)}
                  alt={staffName}
                  className="w-12 h-12 rounded-full object-cover border border-gray-200"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center">
                  {initials(staffName)}
                </div>
              )}
              <div>
                <p className="text-sm font-semibold text-gray-800">Profile Photo</p>
                <p className="text-xs text-gray-500">
                  {photo?.uploaded ? `Updated ${formatDateToDDMMMYYYY(photo.uploadedAt)}` : "Not uploaded — initials are shown"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {busy === "photo" ? (
                <Spinner />
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => pick("photo")}>
                    <Upload size={14} /> {photo?.uploaded ? "Change" : "Upload"}
                  </Button>
                  {photo?.uploaded && (
                    <Button size="sm" variant="outline" onClick={() => remove(photo)}>
                      <Trash2 size={14} />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {others.map((doc) => (
            <div
              key={doc.type}
              className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5"
            >
              <div className="flex items-center gap-3 min-w-0">
                {doc.uploaded && doc.isImage ? (
                  <a href={fileUrl(doc.url)} target="_blank" rel="noreferrer">
                    <img src={fileUrl(doc.url)} alt={doc.label} className="w-12 h-12 rounded-md object-cover border border-gray-200" />
                  </a>
                ) : (
                  <div
                    className={`w-12 h-12 rounded-md flex items-center justify-center ${
                      doc.uploaded ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {doc.uploaded ? <FileText size={20} /> : <ImageIcon size={20} />}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{doc.label}</p>
                  {doc.uploaded ? (
                    <p className="text-xs text-gray-500 truncate">
                      {doc.number ? `No. ${doc.number} · ` : ""}
                      Uploaded {formatDateToDDMMMYYYY(doc.uploadedAt)}
                      {doc.uploadedByName ? ` by ${doc.uploadedByName}` : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600">Not uploaded</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {busy === doc.type ? (
                  <Spinner />
                ) : (
                  <>
                    {doc.uploaded && (
                      <a href={fileUrl(doc.url)} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline">
                          <Eye size={14} /> View
                        </Button>
                      </a>
                    )}
                    <Button size="sm" variant="outline" onClick={() => pick(doc.type)}>
                      <Upload size={14} /> {doc.uploaded ? "Replace" : "Upload"}
                    </Button>
                    {doc.uploaded && (
                      <Button size="sm" variant="outline" onClick={() => remove(doc)}>
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StaffDocumentsSection;
