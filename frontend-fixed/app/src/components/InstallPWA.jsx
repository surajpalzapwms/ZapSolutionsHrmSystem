// src/components/InstallPWA.jsx
import React, { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

const InstallPWA = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-white shadow-xl border border-gray-200 rounded-xl px-4 py-3 max-w-sm w-[92%]">
      <div className="p-2 bg-blue-50 rounded-full text-blue-600">
        <Download size={18} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-gray-800">Install HRM App</p>
        <p className="text-xs text-gray-500">Add to your home screen for quick access</p>
      </div>
      <button
        onClick={handleInstall}
        className="text-sm font-medium text-blue-600 hover:text-blue-700 px-2"
      >
        Install
      </button>
      <button
        onClick={() => setVisible(false)}
        className="text-gray-400 hover:text-gray-600"
      >
        <X size={16} />
      </button>
    </div>
  );
};

export default InstallPWA;
