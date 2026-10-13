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
  LogOut,
} from "lucide-react";
import BrandLogo from "./BrandLogo";
import { useBrand } from "../../contexts/BrandContext";
import { useSidebarCounts } from "../../hooks/useSidebarCounts";
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
  { label: "Staff Basic Payroll", icon: Wallet, path: "/hrmlayout/staffbasicpayroll", adminOnly: true, tabKey: "staffbasicpayroll" },
   { label: "Payroll", icon: DollarSign, path: "/hrmlayout/payroll", adminOnly: true, tabKey: "payroll" },
  { label: "Advance", icon: Wallet, path: "/hrmlayout/advance", adminOnly: true, tabKey: "advance" },
    { label: "Attendance", icon: Clock, path: "/hrmlayout/leaveattendance", adminOnly: true, tabKey: "attendance", countKey: "presentToday" },
      { label: "Leave", icon: CalendarCheck, path: "/hrmlayout/leave", adminOnly: true, tabKey: "leave" },
        { label: "Resignations", icon: LogOut, path: "/hrmlayout/resignations", adminOnly: true, tabKey: "resignations", countKey: "pendingResignations" },
  { label: "Holidays", icon: Calendar, path: "/hrmlayout/holidays", adminOnly: false, countKey: "holidays" },


 
  
  { label: "Expenses (office)", icon: Receipt, path: "/hrmlayout/expenses", adminOnly: true, tabKey: "expenses" },
  // Admin: review every staff member's resignation requests (submitted from
  // either the website or the mobile app) and approve/reject them.

  // Super-admin only — manage which tabs each admin account can see.
  { label: "Admin Permissions", icon: ShieldCheck, path: "/hrmlayout/permissions", adminOnly: true, superAdminOnly: true },
  // Staff self-service — each screen only ever shows the logged-in
  // account's own records. My Leave Requests is `staffOnly`: it's the
  // Sick/Casual/Paid/Unpaid checkbox self-apply flow meant for plain staff
  // (role "user") only — admins and the super admin already have the full
  // "Apply Leave" flow for any staff member (including themselves, if
  // they're also on the staff list) from Attendance → Leave, so this entry
  // is hidden for both instead of just the super admin.
  { label: "My Leave Requests", icon: CalendarPlus, path: "/hrmlayout/my-leave-requests", adminOnly: false, staffOnly: true },
  // Plain staff's own "Attendance" tab — separate from the admin-only
  // "Attendance" entry above (which lists every staff member and lets an
  // admin open any of their calendars). `staffOnly` keeps this off the
  // admin/super-admin sidebar, where the fuller Attendance screen already
  // covers this and more.
  { label: "Attendance", icon: Clock, path: "/hrmlayout/my-attendance", adminOnly: false, staffOnly: true, countKey: "presentToday" },
  { label: "My Payslips", icon: FileText, path: "/hrmlayout/my-payslips", adminOnly: false, hideForSuperAdmin: true },
  { label: "My Resignation", icon: LogOut, path: "/hrmlayout/my-resignation", adminOnly: false, hideForSuperAdmin: true },
];

// Small notification-style pills on the sidebar. Numbers come from
// GET /api/hrm/sidebar-counts (see hooks/useSidebarCounts.js):
//   holidays            - declared holidays in the CURRENT month (Saturday /
//                         Sunday holidays are not counted)
//   pendingResignations - resignation requests no admin has acted on yet
//   presentToday        - staff present today (shown even when 0)
const COUNT_BADGES = {
  holidays: { title: "Holidays this month", className: "bg-sky-500/20 text-sky-200", showZero: false },
  pendingResignations: { title: "Resignation requests waiting for action", className: "bg-rose-500 text-white", showZero: false },
  presentToday: { title: "Present today", className: "bg-emerald-500/20 text-emerald-300", showZero: true },
};

const CountBadge = ({ countKey, value }) => {
  const cfg = COUNT_BADGES[countKey];
  if (!cfg || value == null) return null;
  if (value <= 0 && !cfg.showZero) return null;
  return (
    <span
      title={`${cfg.title}: ${value}`}
      aria-label={`${cfg.title}: ${value}`}
      className={`ml-auto min-w-[1.5rem] text-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold leading-none ${cfg.className}`}
    >
      {value > 99 ? "99+" : value}
    </span>
  );
};

const Sidebar = ({ isOpen, toggleSidebar, isMobile = false }) => {
  const brand = useBrand();
  // Hooks must run before the early return below. The hidden mobile copy of
  // the sidebar doesn't poll - only the one that is actually on screen does.
  const counts = useSidebarCounts(!(isMobile && !isOpen));
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
    if (item.staffOnly && admin) return false;
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
        } flex flex-col`}
        style={{ backgroundColor: brand.sidebarColor }}
      >
        <div className="flex items-center justify-center h-16 border-b border-white/10 shrink-0">
          <BrandLogo
            className="h-10 max-w-[200px] object-contain"
            showName
            textClassName="text-white"
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
              {item.countKey && (
                <CountBadge countKey={item.countKey} value={counts[item.countKey]} />
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;