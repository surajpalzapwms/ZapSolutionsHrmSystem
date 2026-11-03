// src/utils/imageFiles.js
// Turns a picked image file into a small PNG data URL (stored in the
// database, used on the website and printed in PDFs — PNG works everywhere).

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

export const fileToPngDataUrl = (file, { maxW = 360, maxH = 140 } = {}) =>
  new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No file"));
    if (!file.type.startsWith("image/")) return reject(new Error("Please choose an image file (PNG, JPG, WebP or SVG)"));
    if (file.size > MAX_INPUT_BYTES) return reject(new Error("That image is too big. Please choose one under 8 MB."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not read this image"));
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
