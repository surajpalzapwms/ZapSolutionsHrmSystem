// src/components/presence/PcAgentSetup.jsx
// Lets a staff member install the Windows "HRM presence agent" on their own
// PC and see / remove the devices that do automatic attendance for them.
import React, { useCallback, useEffect, useState } from "react";
import { Monitor, Smartphone, Globe, Download, Trash2, X, Wifi } from "lucide-react";
import { presenceService } from "../../services/presenceService";
import { showToast } from "../../utils/toast";

const icon = (platform) =>
  platform === "pc" ? Monitor : platform === "web" ? Globe : Smartphone;

const ago = (value) => {
  if (!value) return "never";
  const mins = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(value).toLocaleDateString();
};

const PcAgentSetup = ({ open, onClose }) => {
  const [data, setData] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await presenceService.getMine();
      setData(res.data);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  const download = async () => {
    setBusy(true);
    try {
      const res = await presenceService.downloadWindowsAgent(name.trim() || undefined);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Install-HrmAttendanceAgent.ps1";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast("success", "Installer downloaded — run it on this PC");
      load();
    } catch {
      showToast("error", "Couldn't create the installer");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await presenceService.revokeDevice(id);
      load();
    } catch {
      showToast("error", "Couldn't remove the device");
    }
  };

  const devices = data?.devices || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Wifi size={18} className="text-blue-600" /> Automatic attendance
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5 text-sm text-gray-600">
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-[13px] leading-relaxed text-blue-900">
            When your phone, this website or your PC is on the <b>office Wi-Fi</b>, you are signed in
            automatically. When you leave the office network the time is saved; if you come back it is
            cleared. If you don&apos;t come back, you are signed out at the time you left.
            {data && (
              <div className="mt-2 font-medium">
                Right now this browser is {data.fromOfficeNetwork ? "on the office network ✅" : "not on the office network"}
                {data.ip ? <> (network address <span className="font-mono">{data.ip}</span>)</> : null}.
                {!data.officeNetworkConfigured && (
                  <span className="block text-amber-700">
                    The office Wi-Fi hasn&apos;t been set up yet — ask an admin to press &quot;Set this Wi-Fi as office network&quot; on the Attendance page.
                  </span>
                )}
              </div>
            )}
          </div>

          <div>
            <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
              <Monitor size={16} /> Sign out automatically when you shut down your PC
            </h3>
            <ol className="list-decimal ml-5 space-y-1 text-[13px]">
              <li>Download the installer below <b>on your own office PC</b> (Windows 10/11).</li>
              <li>Right-click the file → <b>Run with PowerShell</b>. For shutdown detection, run it from an
                Administrator PowerShell: <code className="bg-gray-100 px-1 rounded">powershell -ExecutionPolicy Bypass -File .\Install-HrmAttendanceAgent.ps1</code></li>
              <li>Done — the PC now checks in every 5 minutes and reports when it shuts down.</li>
            </ol>
            <div className="mt-3 flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="PC name (optional), e.g. Desk 12"
                maxLength={60}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={download}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                <Download size={15} /> {busy ? "Preparing…" : "Download"}
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              The file contains a personal key for your account only. Don&apos;t share it; remove the PC below to disable it.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-800 mb-2">My devices</h3>
            {devices.length === 0 ? (
              <p className="text-[13px] text-gray-400">No devices yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
                {devices.map((d) => {
                  const Icon = icon(d.platform);
                  return (
                    <li key={d._id} className="flex items-center gap-3 px-3 py-2">
                      <Icon size={16} className="text-gray-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-gray-800 truncate">{d.name || d.platform}</p>
                        <p className="text-[11px] text-gray-400">
                          {d.lastSeenAt ? `Last check-in ${ago(d.lastSeenAt)}` : "Waiting for first check-in"}
                          {d.lastSeenAt && (d.inOffice ? " · office network" : " · outside office")}
                        </p>
                      </div>
                      <button onClick={() => remove(d._id)} title="Remove" className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
                        <Trash2 size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PcAgentSetup;
