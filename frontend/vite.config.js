import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Debug console.log calls (some forms log 40 lines per save) are removed
  // from the production build; warnings and errors are kept.
  esbuild: {
    pure: ["console.log", "console.debug"],
  },
  build: {
    target: "es2020",
    // exceljs (~940 KB) is intentionally its own lazy chunk, loaded only
    // when an admin downloads the leave template — not on page load.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Keep framework code in its own long-cached chunk so a change in
        // app code doesn't force users to re-download React on every deploy.
        // Heavy, rarely-used libs (xlsx, exceljs, jspdf) are NOT listed here
        // — they stay in their own lazy chunks and only load on demand.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id))
            return "react-vendor";
          if (/[\\/]node_modules[\\/](axios|react-hot-toast|goober)[\\/]/.test(id))
            return "app-vendor";
        },
      },
    },
  },
});
