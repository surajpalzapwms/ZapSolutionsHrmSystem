// src/components/staff/StaffDashboard.jsx
import React, { useMemo } from "react";
import { Users, UserCheck, UserX, Layers, CalendarPlus } from "lucide-react";

const startOfThisMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Summary cards for the Staff page.
 * Reads from the `staff` / `teams` props already fetched by the parent
 * (via useStaff), instead of hitting a separate report endpoint.
 */
export default function StaffDashboard({ staff = [], teams = [] }) {
  const stats = useMemo(() => {
    const total = staff.length;
    const active = staff.filter((s) => s.enabled).length;
    const inactive = total - active;

    const monthStart = startOfThisMonth();
    const joinedThisMonth = staff.filter((s) => {
      if (!s.date) return false;
      const joined = new Date(s.date);
      return !isNaN(joined.getTime()) && joined >= monthStart;
    }).length;

    return { total, active, inactive, teamCount: teams.length, joinedThisMonth };
  }, [staff, teams]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
      <SummaryCard
        icon={<Users size={18} className="text-blue-600" />}
        label="Total Staff"
        value={stats.total}
      />
      <SummaryCard
        icon={<UserCheck size={18} className="text-green-600" />}
        label="Active"
        value={stats.active}
      />
      <SummaryCard
        icon={<UserX size={18} className="text-red-500" />}
        label="Inactive"
        value={stats.inactive}
      />
      <SummaryCard
        icon={<Layers size={18} className="text-purple-600" />}
        label="Teams"
        value={stats.teamCount}
      />
      <SummaryCard
        icon={<CalendarPlus size={18} className="text-amber-600" />}
        label="Joined This Month"
        value={stats.joinedThisMonth}
      />
    </div>
  );
}

function SummaryCard({ icon, label, value }) {
  return (
    <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-lg font-semibold text-gray-800">{value}</div>
      </div>
    </div>
  );
}
