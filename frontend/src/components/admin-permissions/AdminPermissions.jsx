// src/components/admin-permissions/AdminPermissions.jsx
import React, { useEffect, useState } from "react";
import { ShieldCheck, UserCog, ShieldPlus } from "lucide-react";
import Card from "../common/Card";
import Button from "../common/Button";
import Spinner from "../common/Spinner";
import Modal from "../common/Modal";
import { permissionService } from "../../services/permissionService";
import { showToast } from "../../utils/toast";
import { TAB_TREE as STATIC_TAB_TREE } from "../../utils/permissionTabs";

const ROLE_BADGE = {
  "super-admin": { label: "Super Admin", className: "bg-purple-100 text-purple-700" },
  admin: { label: "Admin", className: "bg-blue-100 text-blue-700" },
  user: { label: "Staff", className: "bg-gray-100 text-gray-600" },
};

const emptyDraft = () => ({ allTabs: false, tabs: [] });

const draftFromAccount = (account) => ({
  allTabs: Boolean(account?.permissions?.allTabs),
  tabs: Array.isArray(account?.permissions?.tabs) ? [...account.permissions.tabs] : [],
});

// One line describing what tabs an account currently has, for the table's
// "Tabs" column — kept out of the modal so the table stays scannable.
const tabsSummary = (account) => {
  if (account.role === "super-admin") return "All tabs";
  if (account.role !== "admin") return "—";
  if (account.permissions?.allTabs) return "All tabs";
  const count = account.permissions?.tabs?.length || 0;
  return count > 0 ? `${count} tab(s)` : "No tabs yet";
};

const AdminPermissions = () => {
  const [tabTree, setTabTree] = useState(STATIC_TAB_TREE);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  // The account currently open in the edit modal, plus its in-progress
  // (unsaved) draft. `mode` distinguishes "promote a staff login to admin"
  // from "edit an existing admin's tabs" — same modal, different copy and
  // save behaviour.
  const [editingAccount, setEditingAccount] = useState(null);
  const [editMode, setEditMode] = useState("edit"); // "edit" | "promote"
  const [draft, setDraft] = useState(emptyDraft());

  const loadAll = async () => {
    setLoading(true);
    try {
      const [tabsRes, accountsRes] = await Promise.all([
        permissionService.getTabs(),
        permissionService.getAdmins(),
      ]);
      setTabTree(tabsRes.data?.data ?? STATIC_TAB_TREE);
      setAccounts(Array.isArray(accountsRes.data?.data) ? accountsRes.data.data : []);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const openEdit = (account) => {
    setEditingAccount(account);
    setEditMode("edit");
    setDraft(draftFromAccount(account));
  };

  const openPromote = (account) => {
    setEditingAccount(account);
    setEditMode("promote");
    setDraft(emptyDraft());
  };

  const closeModal = () => {
    setEditingAccount(null);
    setDraft(emptyDraft());
  };

  const toggleAllTabs = () => {
    setDraft((d) => ({ ...d, allTabs: !d.allTabs }));
  };

  const toggleTab = (tabKey) => {
    setDraft((d) => {
      const has = d.tabs.includes(tabKey);
      return { ...d, tabs: has ? d.tabs.filter((t) => t !== tabKey) : [...d.tabs, tabKey] };
    });
  };

  // Checking a main tab also checks all of its sub-tabs (convenience);
  // unchecking it clears them too. Sub-tabs can still be unchecked
  // individually afterwards for finer control.
  const toggleTabWithSubTabs = (tab) => {
    setDraft((d) => {
      const has = d.tabs.includes(tab.key);
      const subKeys = (tab.subTabs || []).map((s) => s.key);
      if (has) {
        return { ...d, tabs: d.tabs.filter((t) => t !== tab.key && !subKeys.includes(t)) };
      }
      return { ...d, tabs: [...new Set([...d.tabs, tab.key, ...subKeys])] };
    });
  };

  const handleSave = async () => {
    if (!editingAccount) return;
    setSavingId(editingAccount._id);
    try {
      const { data } =
        editMode === "promote"
          ? await permissionService.makeAdmin(editingAccount._id, draft)
          : await permissionService.updatePermissions(editingAccount._id, draft);
      setAccounts((prev) => prev.map((a) => (a._id === editingAccount._id ? data.data : a)));
      showToast("success", editMode === "promote" ? "Account promoted to admin" : "Permissions updated");
      closeModal();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to update permissions");
    } finally {
      setSavingId(null);
    }
  };

  const handleRevoke = async (account) => {
    if (!window.confirm(`Revoke admin access for ${account.name || account.email}? They'll become a regular staff login.`)) {
      return;
    }
    setSavingId(account._id);
    try {
      await permissionService.updatePermissions(account._id, { revoke: true });
      showToast("success", "Admin access revoked");
      loadAll();
    } catch (err) {
      showToast("error", err.response?.data?.message || "Failed to revoke admin access");
    } finally {
      setSavingId(null);
    }
  };

  // Plain render helper: the old useMemo here closed over stale handlers
  // (handleRevoke / modal openers) and a small table gains nothing from it.
  const renderContent = () => {
    if (loading) {
      return (
        <div className="py-12">
          <Spinner />
        </div>
      );
    }

    if (accounts.length === 0) {
      return (
        <p className="text-sm text-gray-500 py-6 text-center">
          No accounts yet.
        </p>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-left">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase text-gray-500">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Tabs</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const badge = ROLE_BADGE[account.role] || ROLE_BADGE.user;
              const busy = savingId === account._id;
              return (
                <tr key={account._id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-800">{account.name || account.email}</div>
                    <div className="text-xs text-gray-400">{account.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-600">{tabsSummary(account)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end items-center gap-3">
                      {account.role === "super-admin" && (
                        <span className="text-xs text-gray-400">Full access &middot; can&apos;t be changed</span>
                      )}
                      {account.role === "admin" && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEdit(account)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 hover:underline disabled:opacity-50"
                          >
                            <UserCog size={14} />
                            Manage tabs
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevoke(account)}
                            disabled={busy}
                            className="text-sm text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        </>
                      )}
                      {account.role === "user" && (
                        <button
                          type="button"
                          onClick={() => openPromote(account)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 hover:underline disabled:opacity-50"
                        >
                          <ShieldPlus size={14} />
                          Make Admin
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="text-blue-600" size={22} />
        <h1 className="text-xl font-bold text-gray-800">Admin Permissions</h1>
      </div>
    
      <Card noPadding>{renderContent()}</Card>

      <Modal
        isOpen={Boolean(editingAccount)}
        onClose={closeModal}
        title={
          editMode === "promote"
            ? `Make Admin — ${editingAccount?.name || editingAccount?.email || ""}`
            : `Manage Tabs — ${editingAccount?.name || editingAccount?.email || ""}`
        }
        size="max-w-lg"
        actions={
          <>
            <Button variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={savingId === editingAccount?._id}>
              {editMode === "promote" ? "Make Admin" : "Save Permissions"}
            </Button>
          </>
        }
      >
        <label className="flex items-center gap-2 pb-2 border-b border-gray-100 font-medium text-gray-800">
          <input
            type="checkbox"
            checked={draft.allTabs}
            onChange={toggleAllTabs}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Show All Tabs
        </label>

        <div className={`mt-3 ${draft.allTabs ? "opacity-50 pointer-events-none" : ""}`}>
          {tabTree.map((tab) => (
            <div key={tab.key} className="py-1.5">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={draft.tabs.includes(tab.key)}
                  onChange={() => toggleTabWithSubTabs(tab)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                {tab.label}
              </label>
              {tab.subTabs?.length > 0 && (
                <div className="ml-6 mt-1 space-y-1">
                  {tab.subTabs.map((sub) => (
                    <label key={sub.key} className="flex items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={draft.tabs.includes(sub.key)}
                        onChange={() => toggleTab(sub.key)}
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
      </Modal>
    </div>
  );
};

export default AdminPermissions;
