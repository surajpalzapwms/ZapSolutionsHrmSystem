// src/components/layout/ProfileMenu.jsx
//
// Header avatar + profile card. Clicking the avatar opens a small card with
// the profile photo (add / change / remove) and the Log out button together
// — for every role, including the super admin (who has no staff record; the
// backend keeps that photo on the login account itself).
//
// The photo is the same one uploaded from the mobile app's Profile screen,
// so it shows here too once the user logs in on the website.
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Camera, LogOut, Trash2 } from "lucide-react";
import api from "../../utils/api";
import { documentService, fileUrl } from "../../services/documentService";
import { showToast } from "../../utils/toast";

// Phone/camera photos can be several MB. Shrink to a 512px square JPEG
// before upload: much faster to send and to show in the header.
const toSquareJpeg = (file, size = 512) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        const out = Math.min(size, side);
        const canvas = document.createElement("canvas");
        canvas.width = out;
        canvas.height = out;
        canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, out, out);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({
          data: dataUrl.split(",")[1] || "",
          mimeType: "image/jpeg",
          fileName: "photo.jpg",
        });
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });

const Avatar = memo(function Avatar({ photoUrl, initials, size }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);
  const src = photoUrl && !failed ? fileUrl(photoUrl) : null;
  const style = { width: size, height: size };
  return src ? (
    <img
      src={src}
      alt=""
      style={style}
      className="rounded-full object-cover bg-gray-100"
      onError={() => setFailed(true)}
      decoding="async"
    />
  ) : (
    <div
      style={{ ...style, fontSize: Math.round(size * 0.38) }}
      className="rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold"
    >
      {initials || "U"}
    </div>
  );
});

const ProfileMenu = ({ user, displayName, role, initials, onLogout, onUserChange }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const photoUrl = user?.photoUrl || null;

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Re-read photoUrl from the server and save it with the login.
  const syncPhoto = useCallback(async () => {
    const res = await api.get("/api/auth/me");
    const next = { ...(user || {}), photoUrl: res.data?.data?.photoUrl || null };
    try {
      localStorage.setItem("user", JSON.stringify(next));
    } catch {
      /* storage full / blocked — still update the screen */
    }
    onUserChange?.(next);
  }, [user, onUserChange]);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("error", "Please choose an image (JPG / PNG).");
      return;
    }
    setBusy(true);
    try {
      const payload = await toSquareJpeg(file);
      await documentService.uploadMine({ type: "photo", ...payload });
      await syncPhoto();
      showToast("success", "Profile photo updated");
    } catch (err) {
      showToast("error", err.response?.data?.message || err.message || "Could not upload the photo");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await documentService.deleteMine("photo");
      await syncPhoto();
      showToast("success", "Profile photo removed");
    } catch (err) {
      showToast("error", err.response?.data?.message || "Could not remove the photo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative border-l border-gray-200 pl-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg hover:bg-gray-50 p-1 cursor-pointer"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Profile"
      >
        <Avatar photoUrl={photoUrl} initials={initials} size={36} />
        <div className="hidden sm:block leading-tight text-left">
          <p className="text-sm font-medium text-gray-800 truncate max-w-[160px]">{displayName}</p>
          <p className="text-xs text-gray-500 capitalize">{String(role).replace("-", " ")}</p>
        </div>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Profile"
          className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-2xl shadow-xl z-50 p-5"
        >
          <div className="flex flex-col items-center text-center">
            <div className="relative">
              <Avatar photoUrl={photoUrl} initials={initials} size={88} />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shadow hover:bg-blue-700 disabled:opacity-60"
                title={photoUrl ? "Change photo" : "Add photo"}
              >
                <Camera size={15} />
              </button>
            </div>
            <p className="mt-3 text-sm font-semibold text-gray-800 truncate max-w-full">{displayName}</p>
            <p className="text-xs text-gray-500 capitalize">{String(role).replace("-", " ")}</p>
            {user?.email && <p className="text-xs text-gray-400 truncate max-w-full">{user.email}</p>}

            <div className="flex items-center gap-4 mt-3 text-sm">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-60"
              >
                {busy ? "Please wait…" : photoUrl ? "Change photo" : "Add profile photo"}
              </button>
              {photoUrl && !busy && (
                <button
                  type="button"
                  onClick={onRemove}
                  className="inline-flex items-center gap-1 font-semibold text-red-600 hover:text-red-700"
                >
                  <Trash2 size={13} /> Remove
                </button>
              )}
            </div>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700"
          >
            <LogOut size={16} /> Log out
          </button>
        </div>
      )}
    </div>
  );
};

export default memo(ProfileMenu);
