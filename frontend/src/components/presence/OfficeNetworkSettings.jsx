// src/components/presence/OfficeNetworkSettings.jsx
// Admin: tell the system which Wi-Fi is the office, shown inside a modal
// (OfficeNetworkSettingsModal below, opened from the Live office presence
// panel).
//
// Two ways an office is recognised (backend utils/officeNetwork.js):
//  1. Wi-Fi NAME (recommended). Phones (app) and PCs (agent) send the name of
//     the Wi-Fi they are on. Works even when the office internet IP changes.
//  2. Network ADDRESS (public IP). Used for the website, which can't read the
//     Wi-Fi name. When the ISP changes the office IP, phones / PCs on the
//     office Wi-Fi teach the server the new address automatically ("Learned").
import React, { useCallback, useEffect, useState } from "react";
import { Router, Trash2, CheckCircle2, AlertTriangle, Wifi, Globe, Sparkles } from "lucide-react";
import Modal from "../common/Modal";
import { presenceService } from "../../services/presenceService";
import { showToast } from "../../utils/toast";

const fmtTime = (d) =>
  d
    ? new Date(d).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

const Section = ({ icon: Icon, title, hint, children }) => (
  <section className="rounded-xl border border-gray-200 p-4">
    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
      <Icon size={15} className="text-blue-600" /> {title}
    </h3>
    {hint ? <p className="mt-0.5 text-xs text-gray-500">{hint}</p> : null}
    <div className="mt-3">{children}</div>
  </section>
);

const Chip = ({ children, onRemove, muted, title }) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
      muted ? "border-gray-200 bg-gray-50 text-gray-500" : "border-blue-200 bg-blue-50 text-blue-800"
    }`}
  >
    {children}
    {onRemove ? (
      <button onClick={onRemove} className="text-gray-400 hover:text-red-600" title="Remove">
        <Trash2 size={12} />
      </button>
    ) : null}
  </span>
);

export const OfficeNetworkSettings = ({ onChanged, onInfo }) => {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wifiName, setWifiName] = useState("");
  const [manual, setManual] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await presenceService.getOfficeNetworks();
      setInfo(res.data);
      onInfo?.(res.data);
    } catch {
      setInfo(null);
    }
  }, [onInfo]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const res = await fn();
      showToast("success", res?.data?.message || okMsg || "Saved");
      await load();
      onChanged?.();
      return true;
    } catch (err) {
      showToast("error", err.response?.data?.message || "Couldn't save");
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Saves the typed Wi-Fi name AND this computer's current network address.
  const saveThisWifi = async () => {
    const ssid = wifiName.trim();
    const ok = await run(() =>
      presenceService.addOfficeNetwork({ name: ssid || "Office Wi-Fi", ...(ssid ? { ssid } : {}) }),
    );
    if (ok) setWifiName("");
  };

  const addNameOnly = async () => {
    const ssid = wifiName.trim();
    if (!ssid) return;
    const ok = await run(() => presenceService.addOfficeWifi({ ssid, name: ssid }));
    if (ok) setWifiName("");
  };

  const addManual = async () => {
    const ip = manual.trim();
    if (!ip) return;
    const ok = await run(() => presenceService.addOfficeNetwork({ name: "Office Wi-Fi", ip }));
    if (ok) setManual("");
  };

  const removeNet = async (id) => {
    if (!window.confirm("Remove this office address?")) return;
    await run(() => presenceService.removeOfficeNetwork(id), "Removed");
  };

  const removeWifi = async (w) => {
    if (!window.confirm(`Remove Wi-Fi "${w.ssid}"? Staff on it will no longer be signed in automatically.`)) return;
    await run(() => presenceService.removeOfficeWifi(w._id), "Removed");
  };

  if (!info) {
    return <p className="py-8 text-center text-sm text-gray-400">Loading office Wi-Fi settings…</p>;
  }

  const nets = info.data || [];
  const learned = info.learned || [];
  const wifis = info.wifis || [];
  const wifiEnv = info.wifiFromEnv || [];
  const nothing =
    nets.length === 0 && learned.length === 0 && wifis.length === 0 && wifiEnv.length === 0 &&
    (info.fromEnv || []).length === 0 && !info.allowPrivateLan;

  return (
    <div className="space-y-4">
      {/* Status of THIS computer */}
      <div
        className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
          info.youAreOnOfficeNetwork ? "border-emerald-200 bg-emerald-50" : nothing ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-gray-50"
        }`}
      >
        {info.youAreOnOfficeNetwork ? (
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
        ) : (
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
        )}
        <div>
          {info.onServerPc ? (
            <p className="text-gray-700">
              You opened the site on the PC that runs the backend. This PC&apos;s network:{" "}
              <span className="font-mono">{info.serverLan?.length ? info.serverLan.join(", ") : "not connected"}</span>
            </p>
          ) : (
            <p className="text-gray-700">
              This computer&apos;s network address: <span className="font-mono font-medium">{info.yourIp || "?"}</span>{" "}
              {info.youAreOnOfficeNetwork ? (
                <span className="font-medium text-emerald-700">— recognised as office</span>
              ) : (
                <span className="text-gray-500">— not recognised as office</span>
              )}
            </p>
          )}
          {nothing ? (
            <p className="mt-0.5 text-xs text-amber-800">
              No office Wi-Fi saved yet — automatic attendance can&apos;t work until you add one below.
            </p>
          ) : null}
        </div>
      </div>

      {/* 1. Wi-Fi names */}
      <Section
        icon={Wifi}
        title="Office Wi-Fi names (recommended)"
        hint="Staff phones (app) and PCs (attendance agent) are signed in the moment they connect to one of these Wi-Fi names — even when the office internet IP changes."
      >
        <div className="flex flex-wrap gap-2">
          {wifis.length === 0 && wifiEnv.length === 0 ? (
            <span className="text-xs text-gray-400">No Wi-Fi name saved yet.</span>
          ) : null}
          {wifis.map((w) => (
            <Chip
              key={w._id}
              onRemove={() => removeWifi(w)}
              title={w.bssids?.length ? `Only these routers: ${w.bssids.join(", ")}` : "Any router with this name"}
            >
              <Wifi size={12} /> {w.ssid}
            </Chip>
          ))}
          {wifiEnv.map((n) => (
            <Chip key={n} muted title="Set in the server .env (OFFICE_WIFI_NAMES)">
              .env · {n}
            </Chip>
          ))}
        </div>

        <label className="mt-4 block text-xs font-medium text-gray-700">Wi-Fi name (exactly as it appears on phones)</label>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            value={wifiName}
            onChange={(e) => setWifiName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveThisWifi()}
            placeholder="e.g. ZAP-Office"
            maxLength={64}
            className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={saveThisWifi}
            disabled={busy}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            title="Saves this Wi-Fi name and this computer's current network address"
          >
            {busy ? "Saving…" : "Set this Wi-Fi as office network"}
          </button>
          <button
            onClick={addNameOnly}
            disabled={busy || !wifiName.trim()}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title="Save only the Wi-Fi name (use when you are not in the office right now)"
          >
            Add name only
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          Press <b>Set this Wi-Fi as office network</b> while this computer is connected to the office Wi-Fi. Add every
          office Wi-Fi name (e.g. the 2.4 GHz and 5 GHz networks).
        </p>
      </Section>

      {/* 2. Network addresses */}
      <Section
        icon={Globe}
        title="Office network addresses (for the website)"
        hint="A browser can't read the Wi-Fi name, so the website is matched by the office's internet address. When your ISP changes it, the new one is learned automatically from staff phones / PCs on the office Wi-Fi."
      >
        <div className="flex flex-wrap gap-2">
          {nets.length === 0 && learned.length === 0 && (info.fromEnv || []).length === 0 ? (
            <span className="text-xs text-gray-400">No address saved yet.</span>
          ) : null}
          {nets.map((n) => (
            <Chip key={n._id} onRemove={() => removeNet(n._id)} title={n.ssid ? `Wi-Fi ${n.ssid}` : undefined}>
              <Router size={12} /> <span className="font-mono">{n.ip}</span>
            </Chip>
          ))}
          {learned.map((n) => (
            <Chip
              key={n._id}
              muted
              onRemove={() => removeNet(n._id)}
              title={`Learned from a device on Wi-Fi "${n.ssid || "office"}" · last confirmed ${fmtTime(n.lastConfirmedAt)} · expires ${fmtTime(n.expiresAt)}`}
            >
              <Sparkles size={12} className="text-violet-500" /> <span className="font-mono">{n.ip}</span>
              <span className="text-[10px]">learned</span>
            </Chip>
          ))}
          {(info.fromEnv || []).map((ip) => (
            <Chip key={ip} muted title="Set in the server .env (OFFICE_ALLOWED_IPS)">
              .env · <span className="font-mono">{ip}</span>
            </Chip>
          ))}
        </div>

        <details className="mt-4 group">
          <summary className="cursor-pointer text-xs font-medium text-gray-600 hover:text-gray-800">
            Add an address or range by hand
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addManual()}
              placeholder="e.g. 203.0.113.5 or 2401:4900:88b1:ac1e::/64"
              className="min-w-[220px] flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={addManual}
              disabled={busy || !manual.trim()}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50"
            >
              Add
            </button>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            Phones on mobile networks often use IPv6 — add that range here if needed.
          </p>
        </details>

        {info.trustProxyHops && info.forwardedFor && info.yourIp &&
        !info.forwardedFor.split(",").map((s) => s.trim()).includes(info.yourIp) ? (
          <p className="mt-2 text-[11px] text-amber-700">
            The server sees <span className="font-mono">{info.yourIp}</span> but the request came via{" "}
            <span className="font-mono">{info.forwardedFor}</span>. If the first one is not your real address, set
            TRUST_PROXY_HOPS in the backend .env.
          </p>
        ) : null}
      </Section>
    </div>
  );
};

/** The settings above, in their own modal. */
export const OfficeNetworkSettingsModal = ({ isOpen, onClose, onChanged }) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="Office Wi-Fi settings"
    size="max-w-2xl"
    closeOnBackdrop
    actions={
      <button
        onClick={onClose}
        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Done
      </button>
    }
  >
    {isOpen ? <OfficeNetworkSettings onChanged={onChanged} /> : null}
  </Modal>
);

export default OfficeNetworkSettings;
