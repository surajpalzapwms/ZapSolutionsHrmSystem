// src/components/presence/LivePresencePanel.jsx
// Admin: who is in the office right now, who left the office network (and
// when), and who was signed out automatically today.
import React, { useCallback, useEffect, useState } from "react";
import { Wifi, WifiOff, RefreshCcw, ChevronDown, ChevronUp, Monitor, Smartphone, Globe, Settings, AlertTriangle } from "lucide-react";
import { presenceService } from "../../services/presenceService";
import { OfficeNetworkSettingsModal } from "./OfficeNetworkSettings";

const t = (v) =>
  v ? new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";

const STATUS = {
  in_office: { label: "In office", cls: "bg-emerald-50 text-emerald-700" },
  away: { label: "Left office", cls: "bg-amber-50 text-amber-700" },
  signed_in: { label: "Signed in", cls: "bg-blue-50 text-blue-700" },
  signed_out: { label: "Signed out", cls: "bg-gray-100 text-gray-600" },
  auto_signed_out: { label: "Auto signed out", cls: "bg-violet-50 text-violet-700" },
};

const REASON = { pc_shutdown: "PC shutdown", left_office: "left office", day_end: "not signed out" };
const DevIcon = ({ p }) => {
  const I = p === "pc" ? Monitor : p === "web" ? Globe : Smartphone;
  return <I size={12} />;
};

const LivePresencePanel = ({ onCountChange }) => {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await presenceService.getLive();
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  const rows = data?.data || [];
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

  // Number on the 🔔 in the Attendance header = today's presence entries.
  useEffect(() => {
    onCountChange?.(rows.length);
  }, [rows.length, onCountChange]);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-4">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Wifi size={16} className="text-blue-600" />
          Live office presence (automatic attendance)
          <span className="text-xs font-normal text-gray-500">
            · {counts.in_office || 0} in office · {counts.away || 0} left · {counts.auto_signed_out || 0} auto signed out
          </span>
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            title="Choose which Wi-Fi is the office"
          >
            <Settings size={14} /> Office Wi-Fi settings
          </button>
          <button onClick={load} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" title="Refresh">
            <RefreshCcw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      <OfficeNetworkSettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} onChanged={load} />

      {open && (
        <div className="px-4 pb-4">
          {data?.settings && data.settings.officeNetworkConfigured === false ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle size={14} /> No office Wi-Fi saved yet — staff can&apos;t be signed in automatically.
              </span>
              <button onClick={() => setSettingsOpen(true)} className="font-semibold underline">
                Set up office Wi-Fi
              </button>
            </div>
          ) : null}
          {rows.length === 0 ? (
            <p className="text-sm text-gray-400 py-3 text-center">No attendance yet today.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-3 font-medium">Staff</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Sign in</th>
                    <th className="py-2 pr-3 font-medium">Last disconnect</th>
                    <th className="py-2 pr-3 font-medium">Sign out</th>
                    <th className="py-2 font-medium">Devices</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((r) => {
                    const st = STATUS[r.status] || STATUS.signed_in;
                    return (
                      <tr key={r.userId} className="align-top">
                        <td className="py-2 pr-3">
                          <p className="font-medium text-gray-800">{r.name}</p>
                          <p className="text-[11px] text-gray-400">{r.source === "auto" ? "auto sign-in" : r.source === "self" ? "signed in by button" : r.source}</p>
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{t(r.loginTime)}</td>
                        <td className="py-2 pr-3 tabular-nums">
                          {r.lastDisconnectAt ? (
                            <span className="inline-flex items-center gap-1 text-amber-700"><WifiOff size={12} />{t(r.lastDisconnectAt)}</span>
                          ) : "--"}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {t(r.logoutTime)}
                          {r.autoSignedOut && <p className="text-[11px] text-violet-600">{REASON[r.signOutReason] || "auto"}</p>}
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-1">
                            {r.devices.map((d) => (
                              <span
                                key={d._id}
                                title={`${d.name || d.platform} · last check-in ${t(d.lastSeenAt)}`}
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${d.inOffice ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}
                              >
                                <DevIcon p={d.platform} />
                                {d.name || d.platform}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LivePresencePanel;
