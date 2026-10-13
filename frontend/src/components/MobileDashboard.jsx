// src/components/MobileDashboard.jsx
import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  Calendar,
  Clock,
  DollarSign,
  Wallet,
  LayoutDashboard,
} from "lucide-react";
import Card from "./common/Card";
import SignInOutCard from "./dashboard/SignInOutCard";
import { isAdminUser, isSuperAdminUser, hasTabAccess } from "../utils/authUser";

const QUICK_LINKS = [
  { label: "Staff", icon: Users, path: "/staffmemberLayout/staffmember", color: "text-blue-600 bg-blue-50", adminOnly: true, tabKey: "staff" },
  { label: "Holidays", icon: Calendar, path: "/hrmlayout/holidays", color: "text-green-600 bg-green-50", adminOnly: false },
  { label: "Attendance", icon: Clock, path: "/hrmlayout/leaveattendance", color: "text-orange-600 bg-orange-50", adminOnly: true, tabKey: "attendance" },
  { label: "Payroll", icon: DollarSign, path: "/hrmlayout/payroll", color: "text-purple-600 bg-purple-50", adminOnly: true, tabKey: "payroll" },
  { label: "Staff Payroll", icon: Wallet, path: "/hrmlayout/staffbasicpayroll", color: "text-pink-600 bg-pink-50", adminOnly: true, tabKey: "staffbasicpayroll" },
];

const readUser = () => {
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const MobileDashboard = () => {
  const navigate = useNavigate();
  const user = readUser();
  const admin = isAdminUser(user);
  const superAdmin = isSuperAdminUser(user);
  const visibleLinks = QUICK_LINKS.filter((item) => {
    if (!item.adminOnly) return true;
    if (!admin) return false;
    if (superAdmin || !item.tabKey) return true;
    return hasTabAccess(item.tabKey, user);
  });

  return (
    <div className="px-4 py-5">
      <div className="flex items-center gap-2 mb-5">
        <LayoutDashboard className="w-5 h-5 text-blue-600" />
        <h1 className="text-lg font-bold text-gray-800">
          {user?.name ? `Hi, ${user.name}` : "Dashboard"}
        </h1>
      </div>

      {!admin && (
        <div className="mb-4">
          <SignInOutCard />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {visibleLinks.map((item) => (
          <Card
            key={item.path}
            noPadding
            className="p-4 active:scale-95 transition-transform cursor-pointer"
          >
            <button
              onClick={() => navigate(item.path)}
              className="w-full flex flex-col items-start gap-3 text-left"
            >
              <div className={`p-2.5 rounded-full ${item.color}`}>
                <item.icon size={18} />
              </div>
              <span className="text-sm font-semibold text-gray-800">{item.label}</span>
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default MobileDashboard;
