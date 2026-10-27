// src/components/dashboard/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  Calendar,
  Clock,
  DollarSign,
  Wallet,
  Receipt,
  CreditCard,
  UserCheck,
  CalendarClock,
} from "lucide-react";
import Card from "../common/Card";
import Spinner from "../common/Spinner";
import api from "../../utils/api";
import { staffService } from "../../services/staffService";
import { holidayService } from "../../services/holidayService";
import { payrollService } from "../../services/payrollService";
import { attendanceService } from "../../services/attendanceService";
import { advanceService } from "../../services/advanceService";
import { staffBasicPayrollService } from "../../services/staffBasicPayrollService";

import { formatMoney } from "../../utils/brand";
const TABS = ["Today", "This Month", "This Year", "All", "Custom"];

const asList = (res) => res?.value?.data?.data ?? res?.value?.data ?? [];
const asCount = (res) => {
  const d = res?.value?.data;
  if (!d) return 0;
  return d.length ?? d.data?.length ?? d.pagination?.total ?? 0;
};

const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Today");
  const [stats, setStats] = useState({
    staff: 0,
    holidays: 0,
    payroll: 0,
    pendingLeaves: 0,
    totalExpense: 0,
    activeAdvances: 0,
    staffPayrolls: 0,
    attendanceToday: 0,
  });
  const [holidayList, setHolidayList] = useState([]);
  const [leaveList, setLeaveList] = useState([]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [
          staffRes,
          holidayRes,
          payrollRes,
          leaveRes,
          expenseRes,
          advanceRes,
          staffPayrollRes,
          attendanceRes,
        ] = await Promise.allSettled([
          staffService.getAll(),
          holidayService.getAll(),
          payrollService.getAll(),
          attendanceService.getLeaves({ status: "pending" }),
          api.get("/api/expenses/summary"),
          advanceService.getAll({ status: "pending" }),
          staffBasicPayrollService.getAll(),
          attendanceService.getAttendance(),
        ]);

        if (!mounted) return;

        const holidays = asList(holidayRes);
        const leaves = asList(leaveRes);
        const attendanceRecords = asList(attendanceRes);
        const today = new Date();

        setStats({
          staff: asCount(staffRes),
          holidays: asCount(holidayRes),
          payroll: asCount(payrollRes),
          pendingLeaves: asCount(leaveRes),
          totalExpense:
            expenseRes.status === "fulfilled"
              ? (expenseRes.value.data?.total ?? 0)
              : 0,
          activeAdvances: asCount(advanceRes),
          staffPayrolls: asCount(staffPayrollRes),
          attendanceToday: Array.isArray(attendanceRecords)
            ? attendanceRecords.filter((r) => {
                const d = r.date || r.attendanceDate || r.createdAt;
                return d && isSameDay(new Date(d), today);
              }).length
            : 0,
        });

        setHolidayList(
          Array.isArray(holidays)
            ? holidays
                .filter(
                  (h) =>
                    new Date(h.date) >= new Date(new Date().toDateString()),
                )
                .sort((a, b) => new Date(a.date) - new Date(b.date))
                .slice(0, 5)
            : [],
        );

        setLeaveList(Array.isArray(leaves) ? leaves.slice(0, 8) : []);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const cards = useMemo(
    () => [
      {
        label: "Total Staff",
        value: stats.staff,
        sub: "All staff",
        icon: Users,
        color: "text-blue-600 bg-blue-50",
        path: "/staffmemberLayout/staffmember",
      },
      {
        label: "Attendance Today",
        value: stats.attendanceToday,
        sub: "Checked in today",
        icon: UserCheck,
        color: "text-emerald-600 bg-emerald-50",
        path: "/hrmlayout/leaveattendance",
      },
      {
        label: "Pending Leaves",
        value: stats.pendingLeaves,
        sub: "Awaiting approval",
        icon: Clock,
        color: "text-orange-600 bg-orange-50",
        path: "/hrmlayout/leaveattendance",
      },
      {
        label: "Upcoming Holidays",
        value: stats.holidays,
        sub: "This year",
        icon: Calendar,
        color: "text-green-600 bg-green-50",
        path: "/hrmlayout/holidays",
      },
      {
        label: "Payroll Records",
        value: stats.payroll,
        sub: "All periods",
        icon: DollarSign,
        color: "text-purple-600 bg-purple-50",
        path: "/hrmlayout/payroll",
      },
      {
        label: "Total Expense",
        value: formatMoney(stats.totalExpense),
        sub: "All time",
        icon: Receipt,
        color: "text-red-600 bg-red-50",
        path: "/hrmlayout/payroll",
      },
      {
        label: "Active Advances",
        value: stats.activeAdvances,
        sub: "Pending repayment",
        icon: Wallet,
        color: "text-pink-600 bg-pink-50",
        path: "/hrmlayout/advance",
      },
      {
        label: "Staff Basic Payroll",
        value: stats.staffPayrolls,
        sub: "Staff records",
        icon: CreditCard,
        color: "text-indigo-600 bg-indigo-50",
        path: "/hrmlayout/staffbasicpayroll",
      },
    ],
    [stats],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((c) => {
          const isActive = c.label === "Total Staff";
          return (
            <Card
              key={c.label}
              noPadding
              className={`cursor-pointer hover:shadow-lg transition-shadow ${
                isActive ? "!bg-gray-100" : ""
              }`}
            >
              <button
                onClick={() => navigate(c.path)}
                className="w-full text-left flex items-center gap-3 p-4"
              >
                <div className={`p-3 rounded-full shrink-0 ${c.color}`}>
                  <c.icon size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                    {c.label}
                  </p>
                  <p className="text-xl font-bold text-gray-800 truncate">
                    {c.value}
                  </p>
                  <p className="text-[11px] text-gray-400 truncate">{c.sub}</p>
                </div>
              </button>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center gap-1 mb-6 bg-white border border-gray-200 rounded-lg p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-blue-600 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card
          noPadding
          className="lg:col-span-1"
          headerClassName="!border-b-0"
          title={undefined}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h3 className="text-base font-semibold text-gray-800">
              Upcoming Holidays
            </h3>
            <CalendarClock size={18} className="text-gray-400" />
          </div>
          <div className="p-6">
            {holidayList.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-6">
                No upcoming holidays found
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {holidayList.map((h) => (
                  <li
                    key={h._id || h.id}
                    className="py-3 flex items-center justify-between"
                  >
                    <span className="text-sm font-medium text-gray-700">
                      {h.name || h.title}
                    </span>
                    <span className="text-xs text-gray-500">
                      {h.date ? new Date(h.date).toLocaleDateString() : "-"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card noPadding className="lg:col-span-2">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-base font-semibold text-gray-800">
              Pending Leave Requests
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wide bg-gray-50">
                  <th className="px-6 py-3 font-medium">Staff</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Reason</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leaveList.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-8 text-center text-gray-400"
                    >
                      No pending leave requests found
                    </td>
                  </tr>
                ) : (
                  leaveList.map((l) => (
                    <tr key={l._id || l.id}>
                      <td className="px-6 py-3 text-gray-700">
                        {l.userId?.staffName ||
                          l.userId?.name ||
                          l.staffName ||
                          "-"}
                      </td>
                      <td className="px-6 py-3 text-gray-600 capitalize">
                        {l.leaveType || "-"}
                      </td>
                      <td className="px-6 py-3 text-gray-600">
                        {l.leaveDate
                          ? new Date(l.leaveDate).toLocaleDateString()
                          : "-"}
                      </td>
                      <td className="px-6 py-3 text-gray-600 truncate max-w-[200px]">
                        {l.reason || "-"}
                      </td>
                      <td className="px-6 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-600 capitalize">
                          {l.status || "pending"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
