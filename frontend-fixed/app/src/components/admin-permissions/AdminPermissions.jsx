
import React, { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Search,
  Crown,
} from "lucide-react";
import Card from "../common/Card";
import Button from "../common/Button";
import Spinner from "../common/Spinner";
import { permissionService } from "../../services/permissionService";
import { staffService } from "../../services/staffService";
import { showToast } from "../../utils/toast";
import { TAB_TREE as STATIC_TAB_TREE } from "../../utils/permissionTabs";

// ── helpers ────────────────────────────────────────────────────────────
const unwrap = (res, fallback = []) =>
  res?.data?.data ?? res?.data ?? fallback;

const nameOf = (r) => r?.staffName || r?.name || r?.email || "Unnamed";
const emailKey = (e) => (e ? String(e).toLowerCase().trim() : "");
const isSuperAdminRole = (role) =>
  String(role || "").toLowerCase() === "super-admin";

// One admin's editable permission state (kept per-row so switching rows
// never mixes unsaved changes).
const buildDraft = (perms = {}) => ({
  allTabs: Boolean(perms.allTabs),
  tabs: Array.isArray(perms.tabs) ? [...perms.tabs] : [],
});

// A small pill that summarises what a row can currently see.
const AccessBadge = ({ role, isAdmin, draft }) => {
  if (isSuperAdminRole(role)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
        <Crown size={12} /> Full access
      </span>
    );
  }
  if (!isAdmin) {
    return <span className="text-xs text-gray-400">Staff · no admin access</span>;
  }
  if (draft?.allTabs) {
    return (
      <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
        All tabs
      </span>
    );
  }
  const n = draft?.tabs?.length || 0;
  return (
    <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
      {n} tab{n === 1 ? "" : "s"}
    </span>
  );
};

const AdminPermissions = () => {
  const [tabTree, setTabTree] = useState(STATIC_TAB_TREE);
  const [rows, setRows] = useState([]); // unified staff + admin rows
  const [drafts, setDrafts] = useState({}); // keyed by row.key
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [search, setSearch] = useState("");

  const loadAll = async () => {
    setLoading(true);
    try {
      const [tabsRes, adminsRes, staffRes] = await Promise.all([
        permissionService.getTabs().catch(() => ({})),
        permissionService.getAdmins().catch(() => ({})),
        staffService.getAll().catch(() => ({})),
      ]);

      const tree = unwrap(tabsRes, STATIC_TAB_TREE);
      const admins = unwrap(adminsRes, []);
      const staff = unwrap(staffRes, []);

      // Index admins by email and by id so we can attach them to staff.
      const adminByEmail = new Map();
      const adminById = new Map();
      admins.forEach((a) => {
        if (a.email) adminByEmail.set(emailKey(a.email), a);
        if (a._id) adminById.set(String(a._id), a);
      });

      const usedAdminIds = new Set();
      const staffRows = staff.map((s) => {
        const admin = s.email ? adminByEmail.get(emailKey(s.email)) : null;
        if (admin?._id) usedAdminIds.add(String(admin._id));
        return {
          key: `staff-${s._id}`,
          staffId: s._id,
          adminId: admin?._id ?? null,
          name: nameOf(s),
          email: s.email || admin?.email || "",
          role: admin?.role || s.role || "user",
          isAdmin: Boolean(admin),
          permissions: admin?.permissions || {},
        };
      });

      // Admin accounts with no matching staff record (e.g. the super
      // admin, or admins created directly) — show them at the top so they
      // can still be managed / seen.
      const orphanAdminRows = admins
        .filter((a) => !usedAdminIds.has(String(a._id)))
        .map((a) => ({
          key: `admin-${a._id}`,
          staffId: null,
          adminId: a._id,
          name: nameOf(a),
          email: a.email || "",
          role: a.role || "admin",
          isAdmin: true,
          permissions: a.permissions || {},
        }));

      // Super admins first, then other admins, then plain staff (A→Z).
      const merged = [...orphanAdminRows, ...staffRows].sort((a, b) => {
        const rank = (r) =>
          isSuperAdminRole(r.role) ? 0 : r.isAdmin ? 1 : 2;
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });

      const nextDrafts = {};
      merged.forEach((r) => {
        nextDrafts[r.key] = buildDraft(r.permissions);
      });

      setTabTree(tree);
      setRows(merged);
      setDrafts(nextDrafts);
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to load staff & admins"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  // ── draft editing ──────────────────────────────────────────────────────
  const setDraft = (key, updater) =>
    setDrafts((prev) => ({
      ...prev,
      [key]: updater(prev[key] || { allTabs: false, tabs: [] }),
    }));

  const toggleAllTabs = (key) =>
    setDraft(key, (d) => ({ ...d, allTabs: !d.allTabs }));

  const toggleSubTab = (key, subKey) =>
    setDraft(key, (d) => {
      const has = d.tabs.includes(subKey);
      return {
        ...d,
        tabs: has ? d.tabs.filter((t) => t !== subKey) : [...d.tabs, subKey],
      };
    });

  // Checking a main tab also checks all its sub-tabs; unchecking clears them.
  const toggleTabWithSubs = (key, tab) =>
    setDraft(key, (d) => {
      const has = d.tabs.includes(tab.key);
      const subKeys = (tab.subTabs || []).map((s) => s.key);
      if (has) {
        return {
          ...d,
          tabs: d.tabs.filter((t) => t !== tab.key && !subKeys.includes(t)),
        };
      }
      return { ...d, tabs: [...new Set([...d.tabs, tab.key, ...subKeys])] };
    });

  const toggleExpand = (key) =>
    setExpandedKey((prev) => (prev === key ? null : key));

  // ── Make Admin checkbox ────────────────────────────────────────────────
  const handleMakeAdminToggle = async (row) => {
    if (isSuperAdminRole(row.role)) return; // super admin is locked

    // Currently an admin → unchecking = revoke.
    if (row.isAdmin) {
      if (
        !window.confirm(
          `Revoke admin access for ${row.name}? They'll go back to a regular staff login.`
        )
      ) {
        return;
      }
      setBusyKey(row.key);
      try {
        await permissionService.updatePermissions(row.adminId, {
          revoke: true,
        });
        showToast("success", `${row.name} is no longer an admin`);
        await loadAll();
      } catch (err) {
        showToast(
          "error",
          err.response?.data?.message || "Failed to revoke admin access"
        );
      } finally {
        setBusyKey(null);
      }
      return;
    }

    // Not an admin yet → checking = promote, then open the row so the
    // super admin can pick which tabs this new admin can see.
    if (!row.staffId) {
      showToast("error", "This account has no staff record to promote.");
      return;
    }
    setBusyKey(row.key);
    try {
      await permissionService.promoteStaff(row.staffId);
      showToast("success", `${row.name} is now an admin — pick their tabs`);
      await loadAll();
      setExpandedKey(row.key); // auto-open the permission editor
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message ||
          "Couldn't make admin. Make sure the staff has an email & password set."
      );
    } finally {
      setBusyKey(null);
    }
  };

  // ── Save granted tabs for an existing admin ────────────────────────────
  const handleSave = async (row) => {
    const draft = drafts[row.key];
    setBusyKey(row.key);
    try {
      const { data } = await permissionService.updatePermissions(
        row.adminId,
        draft
      );
      const updated = data?.data;
      // Reflect saved permissions locally without a full reload.
      setRows((prev) =>
        prev.map((r) =>
          r.key === row.key
            ? { ...r, permissions: updated?.permissions || draft }
            : r
        )
      );
      showToast("success", `Permissions saved for ${row.name}`);
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.message || "Failed to save permissions"
      );
    } finally {
      setBusyKey(null);
    }
  };

  // ── filtered rows ──────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q)
    );
  }, [rows, search]);

  // ── the tab / sub-tab checkbox editor (shown when a row is expanded) ───
  const renderPermissionEditor = (row) => {
    const draft = drafts[row.key] || { allTabs: false, tabs: [] };
    return (
      <div className="bg-gray-50/70 px-4 py-4 space-y-4">
        <label className="flex items-center gap-2 pb-2 border-b border-gray-200 font-medium text-gray-800">
          <input
            type="checkbox"
            checked={draft.allTabs}
            onChange={() => toggleAllTabs(row.key)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Show All Tabs
          <span className="text-xs font-normal text-gray-400">
            (full access, including tabs added later)
          </span>
        </label>

        <div
          className={
            draft.allTabs
              ? "opacity-40 pointer-events-none grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3"
              : "grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3"
          }
        >
          {tabTree.map((tab) => (
            <div
              key={tab.key}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
                <input
                  type="checkbox"
                  checked={draft.tabs.includes(tab.key)}
                  onChange={() => toggleTabWithSubs(row.key, tab)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                {tab.label}
              </label>
              {tab.subTabs?.length > 0 && (
                <div className="ml-6 mt-2 space-y-1.5">
                  {tab.subTabs.map((sub) => (
                    <label
                      key={sub.key}
                      className="flex items-center gap-2 text-sm text-gray-600"
                    >
                      <input
                        type="checkbox"
                        checked={draft.tabs.includes(sub.key)}
                        onChange={() => toggleSubTab(row.key, sub.key)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      {sub.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            onClick={() => handleSave(row)}
            loading={busyKey === row.key}
          >
            Save Permissions
          </Button>
        </div>
      </div>
    );
  };

  // ── main render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-blue-600" size={22} />
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              Staff &amp; Admin Permissions
            </h1>
            <p className="text-sm text-gray-500">
              Tick <strong>Make Admin</strong> to promote a staff member, then
              choose the tabs and sub-tabs they can see.
            </p>
          </div>
        </div>
        <div className="relative w-full sm:w-64">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search staff…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <Card title="Staff Access Control" noPadding>
        {loading ? (
          <div className="py-12">
            <Spinner />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase text-gray-500">
                  <th className="px-4 py-3">Staff</th>
                  <th className="px-4 py-3 text-center">Make Admin</th>
                  <th className="px-4 py-3">Access</th>
                  <th className="px-4 py-3 text-right">Tabs</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-gray-400"
                    >
                      No staff to show.
                    </td>
                  </tr>
                )}

                {filteredRows.map((row) => {
                  const superAdmin = isSuperAdminRole(row.role);
                  const expanded = expandedKey === row.key;
                  const draft = drafts[row.key];
                  const canEdit = row.isAdmin && !superAdmin;

                  return (
                    <React.Fragment key={row.key}>
                      <tr className="border-b border-gray-100 hover:bg-gray-50">
                        {/* Staff */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {superAdmin && (
                              <Crown size={14} className="text-amber-500" />
                            )}
                            <div>
                              <div className="font-medium text-gray-800">
                                {row.name}
                              </div>
                              {row.email && (
                                <div className="text-xs text-gray-400">
                                  {row.email}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Make Admin toggle */}
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={row.isAdmin}
                            disabled={superAdmin || busyKey === row.key}
                            onChange={() => handleMakeAdminToggle(row)}
                            title={
                              superAdmin
                                ? "Super admin always has full access"
                                : row.isAdmin
                                ? "Uncheck to revoke admin access"
                                : "Check to make this staff an admin"
                            }
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                        </td>

                        {/* Access badge */}
                        <td className="px-4 py-3">
                          <AccessBadge
                            role={row.role}
                            isAdmin={row.isAdmin}
                            draft={draft}
                          />
                        </td>

                        {/* Expand tabs editor */}
                        <td className="px-4 py-3 text-right">
                          {canEdit ? (
                            <button
                              type="button"
                              onClick={() => toggleExpand(row.key)}
                              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 hover:underline"
                            >
                              {expanded ? "Hide" : "Edit tabs"}
                              {expanded ? (
                                <ChevronUp size={16} />
                              ) : (
                                <ChevronDown size={16} />
                              )}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                      </tr>

                      {canEdit && expanded && (
                        <tr>
                          <td colSpan={4} className="p-0 border-b border-gray-100">
                            {renderPermissionEditor(row)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-gray-400">
        The super admin always has full access. A promoted admin only sees the
        tabs and sub-tabs ticked above; everything else stays hidden from their
        sidebar and is blocked even by direct URL.
      </p>
    </div>
  );
};

export default AdminPermissions;
