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
} from "lucide-react";
import { getCurrentUser, isAdminUser } from "../../utils/authUser";

const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/hrmlayout", adminOnly: false },
  { label: "Staff", icon: Users, path: "/staffmemberLayout/staffmember", adminOnly: true },
  { label: "Holidays", icon: Calendar, path: "/hrmlayout/holidays", adminOnly: false },
  { label: "Attendance", icon: Clock, path: "/hrmlayout/leaveattendance", adminOnly: true },
  { label: "Leave", icon: CalendarCheck, path: "/hrmlayout/leave", adminOnly: true },
  { label: "Payroll", icon: DollarSign, path: "/hrmlayout/payroll", adminOnly: true },
  { label: "Staff Basic Payroll", icon: Wallet, path: "/hrmlayout/staffbasicpayroll", adminOnly: true },
  { label: "Advance", icon: Wallet, path: "/hrmlayout/advance", adminOnly: true },
  { label: "Expenses", icon: Receipt, path: "/hrmlayout/expenses", adminOnly: true },
  // Staff self-service — each screen only ever shows the logged-in
  // account's own records, so these are irrelevant for admins (who manage
  // everyone via the Attendance / Staff Basic Payroll pages instead).
  { label: "My Leave Requests", icon: CalendarPlus, path: "/hrmlayout/my-leave-requests", adminOnly: false, hideForAdmin: true },
  { label: "My Payslips", icon: FileText, path: "/hrmlayout/my-payslips", adminOnly: false, hideForAdmin: true },
];

const Sidebar = ({ isOpen, toggleSidebar, isMobile = false }) => {
  if (isMobile && !isOpen) return null;

  // Non-admin ("user" role) staff only get Dashboard + Holidays + their own
  // self-service screens — everything else (Staff list, Attendance,
  // Payroll, Staff Basic Payroll, Advance, Expenses) is admin-only. Admins
  // keep the full, unchanged nav plus the admin-only management screens,
  // but don't need the self-service ones since those only ever show the
  // logged-in account's own records.
  const admin = isAdminUser(getCurrentUser());
  const visibleNavItems = NAV_ITEMS.filter((item) =>
    admin ? !item.hideForAdmin : !item.adminOnly,
  );

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
