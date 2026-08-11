// src/components/common/Sidebar.jsx
import React from "react";
import { NavLink } from "react-router-dom";
import {
  Calendar,
  Clock,
  DollarSign,
  Users,
  Wallet,
  Receipt,
  LayoutDashboard,
  FileText,
  CalendarPlus,
  CalendarCheck,
  ShieldCheck,
} from "lucide-react";
import {
  getCurrentUser,
  isAdminUser,
  isSuperAdminUser,
  hasTabAccess,
} from "../../utils/authUser";

// `tabKey` links a nav item to a permissions tab (see utils/permissionTabs.js).
// Items with no tabKey (Dashboard, Holidays, the self-service screens) are
// never gated by permissions — only by role.
//
// Dashboard and Holidays are default tabs for everyone. My Leave Requests
// and My Payslips are also default for staff and admins — but NOT the
// super admin: those two screens resolve data by matching the logged-in
// account's email to a Staff record, and the super admin (the original
// bootstrap login) never has one, so it would just show "no staff profile
// linked" errors for that role. `hideForSuperAdmin` keeps them off the
// super admin's sidebar specifically.
const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/hrmlayout", adminOnly: false },
  { label: "Staff", icon: Users, path: "/staffmemberLayout/staffmember", adminOnly: true, tabKey: "staff" },
  { label: "Holidays", icon: Calendar, path: "/hrmlayout/holidays", adminOnly: false },
  { label: "Attendance", icon: Clock, path: "/hrmlayout/leaveattendance", adminOnly: true, tabKey: "attendance" },
  { label: "Leave", icon: CalendarCheck, path: "/hrmlayout/leave", adminOnly: true, tabKey: "leave" },
  { label: "Payroll", icon: DollarSign, path: "/hrmlayout/payroll", adminOnly: true, tabKey: "payroll" },
  { label: "Staff Basic Payroll", icon: Wallet, path: "/hrmlayout/staffbasicpayroll", adminOnly: true, tabKey: "staffbasicpayroll" },
  { label: "Advance", icon: Wallet, path: "/hrmlayout/advance", adminOnly: true, tabKey: "advance" },
  { label: "Expenses", icon: Receipt, path: "/hrmlayout/expenses", adminOnly: true, tabKey: "expenses" },
  // Super-admin only — manage which tabs each admin account can see.
  { label: "Admin Permissions", icon: ShieldCheck, path: "/hrmlayout/permissions", adminOnly: true, superAdminOnly: true },
  // Staff self-service — each screen only ever shows the logged-in
  // account's own records.
  { label: "My Leave Requests", icon: CalendarPlus, path: "/hrmlayout/my-leave-requests", adminOnly: false, hideForSuperAdmin: true },
  { label: "My Payslips", icon: FileText, path: "/hrmlayout/my-payslips", adminOnly: false, hideForSuperAdmin: true },
];

const Sidebar = ({ isOpen, toggleSidebar, isMobile = false }) => {
  if (isMobile && !isOpen) return null;

  // Non-admin ("user" role) staff only get Dashboard + Holidays + their own
  // self-service screens — everything else (Staff list, Attendance,
  // Payroll, Staff Basic Payroll, Advance, Expenses) is admin-only.
  //
  // Super admin always sees every tab ("Show All"). A promoted admin only
  // sees the specific tabs the super admin granted them on the Permissions
  // screen (or every tab, if they were granted "Show All" there too).
  const currentUser = getCurrentUser();
  const admin = isAdminUser(currentUser);
  const superAdmin = isSuperAdminUser(currentUser);

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.superAdminOnly && !superAdmin) return false;
    if (item.hideForSuperAdmin && superAdmin) return false;
    if (!admin) return !item.adminOnly;
    // Superadmin (or an item with no tab gate, e.g. the default tabs and
    // the Permissions link itself) always shows; a plain admin needs the
    // specific tab granted.
    if (!item.tabKey || superAdmin) return true;
    return hasTabAccess(item.tabKey, currentUser);
  });

  return (
    <>
      {isMobile && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={toggleSidebar}
        />
      )}
      <aside
        className={`${
          isMobile
            ? "fixed top-0 left-0 h-full z-50 w-64 shadow-2xl"
            : "w-64 h-full"
        } bg-[#0b1220] flex flex-col`}
      >
        <div className="flex items-center justify-center h-16 border-b border-white/10 shrink-0">
          <img
            src="/mainlogo.png"
            alt="Company Logo"
            className="h-10 object-contain"
          />
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/hrmlayout"}
              onClick={isMobile ? toggleSidebar : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 mb-1 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
                }`
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
