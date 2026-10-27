// src/components/common/StaffAvatar.jsx
//
// Round profile photo of a staff member, or their initials when there is no
// photo (or it can't be loaded). The photo is the one uploaded from the mobile
// app / the staff details screen — the API sends it as `photoUrl`.
//
//   <StaffAvatar name={row.staffName} photoUrl={row.photoUrl} size={32} />
import React, { memo, useEffect, useState } from "react";
import { fileUrl } from "../../services/documentService";

const initialsOf = (name) =>
  String(name || "?")
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

const StaffAvatar = ({ name, photoUrl, size = 32, className = "" }) => {
  const [failed, setFailed] = useState(false);
  // A new photo (new link) gets a fresh chance to load.
  useEffect(() => setFailed(false), [photoUrl]);

  const style = { width: size, height: size };
  const src = photoUrl && !failed ? fileUrl(photoUrl) : null;

  if (src) {
    return (
      <img
        src={src}
        alt={name || "Staff"}
        style={style}
        className={`rounded-full object-cover bg-gray-100 flex-shrink-0 ${className}`}
        onError={() => setFailed(true)}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <div
      style={{ ...style, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      className={`rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold flex-shrink-0 ${className}`}
      aria-label={name || "Staff"}
    >
      {initialsOf(name)}
    </div>
  );
};

export default memo(StaffAvatar);
