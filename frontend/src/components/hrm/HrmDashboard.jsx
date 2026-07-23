// src/components/hrm/HrmDashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Calendar,
  Clock,
  DollarSign,
  Wallet,
  Users,
  UserCheck,
  UserX,
  CreditCard,
  CalendarClock,
  CheckCircle2,
  XCircle,
  Award,
  Eye,
} from "lucide-react";
import Card from "../common/Card";
import Modal from "../common/Modal";
import Spinner from "../common/Spinner";
import DatePicker from "../common/DatePicker";
import SignInOutCard from "../dashboard/SignInOutCard";
import { staffService } from "../../services/staffService";
import { holidayService } from "../../services/holidayService";
import { payrollService } from "../../services/payrollService";
import { attendanceService } from "../../services/attendanceService";
import { advanceService } from "../../services/advanceService";
import { officeExpenseService } from "../../services/officeExpenseService";
import { getTodayDate, formatDateToDDMMMYYYY } from "../../utils/dateUtils";
import { getCurrentUser, isAdminUser } from "../../utils/authUser";

const RANGE_TABS = [
  { key: "today", label: "Today" },
  { key: "month", label: "This Month" },
  { key: "year", label: "This Year" },
  { key: "all", label: "All" },
  { key: "custom", label: "Custom" },
];

// The Upcoming Holidays card only ever deals with dates from today onward,
// so "All" (which would include past holidays too) doesn't apply here.
// "Today" is also excluded since a single day rarely has a holiday, making
// that tab low-value for this card.
const HOLIDAY_RANGE_TABS = RANGE_TABS.filter(
  (t) => t.key !== "all" && t.key !== "today",
);

// Active Staff always shows the full current roster and the most recent
// joiners — it isn't a "how many joined in X range" metric, so Month /
// Year / All / Custom don't apply here. Only Today is offered.
const ACTIVE_STAFF_RANGE_TABS = RANGE_TABS.filter((t) => t.key === "today");

const fmtClockTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const fmtMoney = (n) =>
  `₹${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtExtraMinutes = (minutes = 0) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
};

const sameId = (a, b) => {
  if (!a || !b) return false;
  const idA = typeof a === "object" ? a._id : a;
  const idB = typeof b === "object" ? b._id : b;
  return String(idA) === String(idB);
};

// Extracts a local "YYYY-MM-DD" calendar-day key from a value that may be
// either a plain date-only string (e.g. Attendance.date, already the
// correct calendar day and must NOT be re-parsed) or a full timestamp
// (e.g. createdAt, converted using local time so it lines up with what's
// on screen). Feeding a "YYYY-MM-DD" string into `new Date(...)` parses it
// as UTC midnight, which silently shifts it to the wrong calendar day once
// converted back to local time in most timezones — that was dropping
// today's own attendance rows from the "Today" tab.
const toDayKey = (value) => {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

const todayKey = () => toDayKey(new Date());

// Whether dateStr falls between fromDate and toDate (inclusive). Used by the
// Upcoming Holidays "Custom" filter, which needs a from/to range rather than
// the single-day match the other cards' Custom filter uses.
const inDateRange = (dateStr, fromDate, toDate) => {
  const key = toDayKey(dateStr);
  if (!key) return false;
  if (fromDate && key < toDayKey(fromDate)) return false;
  if (toDate && key > toDayKey(toDate)) return false;
  return true;
};

// Returns true if dateStr falls within the currently selected range.
// "custom" now takes a from/to pair everywhere (via the Custom Date modal)
// instead of a single exact-match date.
const inRange = (dateStr, range, customFrom, customTo) => {
  const key = toDayKey(dateStr);
  if (!key) return false;

  if (range === "all") return true;

  const [y, m] = key.split("-").map(Number);
  const today = new Date();

  if (range === "today") {
    return key === todayKey();
  }
  if (range === "month") {
    return y === today.getFullYear() && m - 1 === today.getMonth();
  }
  if (range === "year") {
    return y === today.getFullYear();
  }
  if (range === "custom") {
    return inDateRange(dateStr, customFrom, customTo);
  }
  return false;
};

const HrmDashboard = () => {
  const navigate = useNavigate();
  const currentUser = useMemo(() => getCurrentUser(), []);
  const admin = isAdminUser(currentUser);

  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState([]);
  const [teams, setTeams] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [staffSummary, setStaffSummary] = useState([]);

  const [range, setRange] = useState("today");
  // Custom range is now a from/to pair, set via the Custom Date modal
  // (matching the Start Date / End Date modal pattern used elsewhere).
  const [customFrom, setCustomFrom] = useState(getTodayDate());
  const [customTo, setCustomTo] = useState(getTodayDate());
  const [customModalOpen, setCustomModalOpen] = useState(false);
  // Draft values edited inside the modal, only committed to
  // customFrom/customTo when "Apply Filter" is pressed.
  const [draftCustomFrom, setDraftCustomFrom] = useState(getTodayDate());
  const [draftCustomTo, setDraftCustomTo] = useState(getTodayDate());
  // Which KPI card is currently selected/highlighted. Defaults to Active
  // Staff on first load, per requirement.
  const [activeCard, setActiveCard] = useState("activeStaff");

  // "All" and "Today" aren't valid ranges for Upcoming Holidays (it only
  // ever looks forward from today, and a single day rarely has a holiday),
  // so drop back to Month if either combination happens. Active Staff only
  // ever offers Today, so force it back there too if some other range was
  // left selected from a previously active card.
  useEffect(() => {
    if (
      activeCard === "upcomingHolidays" &&
      (range === "all" || range === "today")
    ) {
      setRange("month");
    }
    if (activeCard === "activeStaff" && range !== "today") {
      setRange("today");
    }
  }, [activeCard, range]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [
          staffRes,
          teamsRes,
          holidayRes,
          payrollRes,
          advanceRes,
          expenseRes,
          attendanceRes,
          leaveRes,
          staffSummaryRes,
        ] = await Promise.allSettled([
          staffService.getAll(),
          staffService.getTeams(),
          holidayService.getAll(),
          payrollService.getAll(),
          advanceService.getAll(),
          officeExpenseService.getAll(),
          attendanceService.getAttendance(),
          attendanceService.getLeaves(),
          attendanceService.getStaffSummary(),
        ]);
        if (!mounted) return;

        // Most list endpoints wrap their array as { data: [...] }, but
        // GET /holidays wraps it as { holidays: [...] } instead — unwrap()
        // was only ever checking `.data`, so the holidays array was always
        // discarded and the Upcoming Holidays count/table silently showed 0
        // no matter how many holidays actually existed.
        const unwrap = (res) => {
          if (res.status !== "fulfilled") return [];
          const body = res.value?.data;
          const inner = body?.data ?? body?.holidays ?? body?.records ?? body;
          return Array.isArray(inner) ? inner : [];
        };

        setStaff(unwrap(staffRes));
        setTeams(unwrap(teamsRes));
        setHolidays(unwrap(holidayRes));
        setPayroll(unwrap(payrollRes));
        setAdvances(unwrap(advanceRes));
        setExpenses(unwrap(expenseRes));
        setAttendance(unwrap(attendanceRes));
        setLeaves(unwrap(leaveRes));
        setStaffSummary(unwrap(staffSummaryRes));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const staffMap = useMemo(() => {
    const map = {};
    staff.forEach((s) => {
      if (s._id) map[s._id] = s;
      if (s.staffId) map[s.staffId] = s;
    });
    return map;
  }, [staff]);

  // Attendance.userId points at the login User account, not at Staff._id,
  // so staffMap (keyed by Staff._id) never matches it — that's what was
  // showing every attendance-derived name as "Unknown". staffSummary already
  // carries the User<->Staff bridge (attendanceUserId), so use that instead
  // whenever resolving a name from an Attendance/Leave-on-attendance record.
  const attendanceUserIdToStaff = useMemo(() => {
    const map = {};
    staffSummary.forEach((row) => {
      if (row.attendanceUserId) {
        map[String(row.attendanceUserId)] = row;
      }
    });
    return map;
  }, [staffSummary]);

  const resolveStaffForAttendance = (userId) => {
    const id = typeof userId === "object" ? userId?._id : userId;
    if (!id) return null;
    return attendanceUserIdToStaff[String(id)] || staffMap[String(id)] || null;
  };

  // Non-admin users only ever see data scoped to themselves. The login
  // response doesn't include a staffId, so match the logged-in user to
  // their Staff record via email (both User and Staff enforce unique email).
  const myStaffRecord = useMemo(() => {
    if (admin || !currentUser?.email) return null;
    return (
      staff.find(
        (s) =>
          (s.email || "").toLowerCase() === currentUser.email.toLowerCase(),
      ) || null
    );
  }, [admin, currentUser, staff]);

  const myStats = useMemo(() => {
    if (admin) return null;
    const myId = myStaffRecord?._id;

    const myLeaves = myId ? leaves.filter((l) => sameId(l.userId, myId)) : [];
    const myPayroll = myId
      ? payroll.filter((p) => sameId(p.staffId, myId))
      : [];
    const myAdvances = myId
      ? advances.filter((a) => sameId(a.staffId, myId))
      : [];

    const totalLeave = myLeaves.length;
    const pendingPayroll = myPayroll
      .filter((p) => p.status === "pending")
      .reduce((sum, p) => sum + Number(p.netSalary || 0), 0);
    const upcomingAdvance = myAdvances
      .filter((a) => a.status !== "repaid" && a.status !== "rejected")
      .reduce(
        (sum, a) => sum + (Number(a.amount || 0) - Number(a.repaidAmount || 0)),
        0,
      );
    const todayStr = getTodayDate();
    const upcomingHolidays = holidays.filter(
      (h) => new Date(h.startDate) >= new Date(todayStr),
    ).length;

    return { totalLeave, pendingPayroll, upcomingAdvance, upcomingHolidays };
  }, [admin, myStaffRecord, leaves, payroll, advances, holidays]);

  const rangeLabel = RANGE_TABS.find((r) => r.key === range)?.label || "";

  const filteredAttendance = useMemo(
    () =>
      attendance.filter((a) =>
        inRange(a.date || a.createdAt, range, customFrom, customTo),
      ),
    [attendance, range, customFrom, customTo],
  );
  const filteredLeaves = useMemo(
    () =>
      leaves.filter((l) =>
        inRange(l.leaveDate || l.createdAt, range, customFrom, customTo),
      ),
    [leaves, range, customFrom, customTo],
  );
  const filteredPayroll = useMemo(
    () =>
      payroll.filter((p) =>
        inRange(p.paymentDate || p.createdAt, range, customFrom, customTo),
      ),
    [payroll, range, customFrom, customTo],
  );
  const filteredAdvances = useMemo(
    () =>
      advances.filter((a) =>
        inRange(a.date || a.createdAt, range, customFrom, customTo),
      ),
    [advances, range, customFrom, customTo],
  );
  const filteredExpenses = useMemo(
    () =>
      expenses.filter((e) =>
        inRange(e.date || e.createdAt, range, customFrom, customTo),
      ),
    [expenses, range, customFrom, customTo],
  );

  // Payroll rows shown in the Total Payroll / Pending Payroll detail table —
  // same range filter as everything else, with an extra status filter when
  // viewing Pending Payroll specifically.
  const payrollRowsForCard = useMemo(
    () =>
      activeCard === "pendingPayroll"
        ? filteredPayroll.filter((p) => p.status === "pending")
        : filteredPayroll,
    [filteredPayroll, activeCard],
  );

  const stats = useMemo(() => {
    const presentUserIds = new Set(
      filteredAttendance.filter((a) => !a.isLeaveDay).map((a) => a.userId),
    );
    const approvedLeaves = filteredLeaves.filter(
      (l) => l.status === "approved" || l.status === "pending",
    );
    const totalPayroll = filteredPayroll.reduce(
      (sum, p) => sum + Number(p.netSalary || 0),
      0,
    );
    const pendingPayroll = filteredPayroll
      .filter((p) => p.status === "pending")
      .reduce((sum, p) => sum + Number(p.netSalary || 0), 0);
    const totalAdvances = filteredAdvances.reduce(
      (sum, a) => sum + Number(a.amount || 0),
      0,
    );
    const outstandingAdvances = filteredAdvances
      .filter((a) => a.status !== "repaid" && a.status !== "rejected")
      .reduce(
        (sum, a) => sum + (Number(a.amount || 0) - Number(a.repaidAmount || 0)),
        0,
      );
    const todayStr = getTodayDate();
    const upcomingHolidays = holidays.filter(
      (h) => new Date(h.startDate) >= new Date(todayStr),
    );
    const totalExpense = filteredExpenses.reduce(
      (sum, e) => sum + Number(e.amount || 0),
      0,
    );

    return {
      totalStaff: staff.length,
      activeStaff: staff.filter((s) => s.enabled).length,
      present: presentUserIds.size,
      onLeave: approvedLeaves.length,
      totalPayroll,
      pendingPayroll,
      totalAdvances,
      outstandingAdvances,
      totalExpense,
      upcomingHolidays: upcomingHolidays.length,
    };
  }, [
    staff,
    filteredAttendance,
    filteredLeaves,
    filteredPayroll,
    filteredAdvances,
    filteredExpenses,
    holidays,
  ]);

  const cards = [
    {
      key: "activeStaff",
      label: "Active Staff",
      value: stats.activeStaff,
      sub: `of ${stats.totalStaff} total`,
      icon: Users,
      color: "text-blue-600 bg-blue-50",
      valueColor: "text-blue-600",
    },
    {
      key: "present",
      label: "Present",
      value: stats.present,
      sub: rangeLabel,
      icon: UserCheck,
      color: "text-green-600 bg-green-50",
      valueColor: "text-green-600",
    },
    {
      key: "onLeave",
      label: "On Leave",
      value: stats.onLeave,
      sub: rangeLabel,
      icon: UserX,
      color: "text-orange-600 bg-orange-50",
      valueColor: "text-orange-600",
    },
    {
      key: "totalPayroll",
      label: "Total Payroll",
      value: fmtMoney(stats.totalPayroll),
      sub: rangeLabel,
      icon: DollarSign,
      color: "text-purple-600 bg-purple-50",
      valueColor: "text-purple-600",
    },
    {
      key: "pendingPayroll",
      label: "Pending Payroll",
      value: fmtMoney(stats.pendingPayroll),
      sub: rangeLabel,
      icon: Clock,
      color: "text-red-600 bg-red-50",
      valueColor: "text-red-600",
    },
    {
      key: "totalAdvances",
      label: "Total Advances",
      value: fmtMoney(stats.totalAdvances),
      sub: rangeLabel,
      icon: Wallet,
      color: "text-pink-600 bg-pink-50",
      valueColor: "text-pink-600",
    },
    {
      key: "totalExpense",
      label: "Total Expense",
      value: fmtMoney(stats.totalExpense),
      sub: rangeLabel,
      icon: CreditCard,
      color: "text-indigo-600 bg-indigo-50",
      valueColor: "text-indigo-600",
    },
    {
      key: "upcomingHolidays",
      label: "Upcoming Holidays",
      value: stats.upcomingHolidays,
      sub: "All Holidays",
      icon: CalendarClock,
      color: "text-teal-600 bg-teal-50",
      valueColor: "text-teal-600",
    },
  ];

  // Active Staff tab always shows Today only, so these two panels aren't
  // range-filtered at all: Recent Joins is simply the last 7 staff to join
  // (most recent first), and the roster below lists every active staff
  // member — not just ones who joined within some window.
  const recentJoins = useMemo(
    () =>
      staff
        .filter((s) => s.enabled && s.date)
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 7),
    [staff],
  );

  // Active Staff tab's roster table — every currently active staff member.
  const activeStaffRowsForRange = useMemo(
    () =>
      staff
        .filter((s) => s.enabled)
        .slice()
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
    [staff],
  );

  // ── Attendance Mark (range === "today") ─────────────────────────────
  // Active staff who have an attendance entry for today vs. those who
  // don't yet, so it's obvious at a glance who still needs to mark in.
  const todaysAttendanceUserIds = useMemo(() => {
    const ids = new Set();
    attendance.forEach((a) => {
      // A leave-day placeholder record isn't a real sign-in — skip it so
      // staff on leave don't get counted as "Present" for today.
      if (a.isLeaveDay) return;
      if (!a.loginTime) return;
      if (!inRange(a.date || a.createdAt, "today")) return;
      const id = typeof a.userId === "object" ? a.userId?._id : a.userId;
      if (id) ids.add(String(id));
    });
    return ids;
  }, [attendance]);

  // Staff resolved to their attendanceUserId, so today's sign-in status can
  // be looked up correctly (Attendance is keyed by the login User account,
  // not by Staff._id).
  const presentToday = useMemo(
    () =>
      staff.filter((s) => {
        if (!s.enabled) return false;
        const summary = staffSummary.find(
          (row) => String(row.staffId) === String(s._id),
        );
        const attendanceUserId = summary?.attendanceUserId;
        return (
          attendanceUserId &&
          todaysAttendanceUserIds.has(String(attendanceUserId))
        );
      }),
    [staff, staffSummary, todaysAttendanceUserIds],
  );

  const notPresentToday = useMemo(() => {
    const presentIds = new Set(presentToday.map((s) => String(s._id)));
    return staff.filter((s) => s.enabled && !presentIds.has(String(s._id)));
  }, [staff, presentToday]);

  // ── Top 5 Highest Present Staff (range !== "today") ─────────────────
  // Counts present days within the selected range (This Month / This
  // Year / All / Custom) and ranks staff by attendance count.
  const topPresentStaff = useMemo(() => {
    const counts = new Map();
    filteredAttendance.forEach((a) => {
      if (a.isLeaveDay) return;
      const id = typeof a.userId === "object" ? a.userId?._id : a.userId;
      if (!id) return;
      const key = String(id);
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([id, count]) => {
        const s = resolveStaffForAttendance(id);
        return {
          id,
          count,
          staffName: s?.staffName || "Unknown",
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredAttendance, attendanceUserIdToStaff, staffMap]);

  // ── Highest Present Staff wise Leave table (range !== "today") ──────
  // Same range as Top 5 Highest Present Staff — ranks staff by how many
  // leave days they've taken (approved/pending), so it's easy to see who
  // is taking the most leave over the same period. Leave.userId points
  // directly at Staff._id (not a login User account), so resolve via
  // staffMap first.
  const topLeaveStaff = useMemo(() => {
    const counts = new Map();
    filteredLeaves
      .filter((l) => l.status === "approved" || l.status === "pending")
      .forEach((l) => {
        const id = typeof l.userId === "object" ? l.userId?._id : l.userId;
        if (!id) return;
        const key = String(id);
        counts.set(key, (counts.get(key) || 0) + 1);
      });

    return Array.from(counts.entries())
      .map(([id, count]) => {
        const s = staffMap[id] || resolveStaffForAttendance(id);
        return {
          id,
          count,
          staffName: s?.staffName || "Unknown",
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredLeaves, staffMap, attendanceUserIdToStaff]);

  const attendanceRows = useMemo(
    () =>
      filteredAttendance
        .slice()
        .sort(
          (a, b) =>
            new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt),
        )
        .slice(0, 10),
    [filteredAttendance],
  );

  // Full active-staff roster shown when the "Active Staff" card is selected.
  const activeStaffRows = useMemo(
    () => staff.filter((s) => s.enabled),
    [staff],
  );

  // Leave records shown when "On Leave" is selected and range === "today".
  const leaveRows = useMemo(
    () =>
      filteredLeaves
        .slice()
        .sort(
          (a, b) =>
            new Date(b.leaveDate || b.createdAt) -
            new Date(a.leaveDate || a.createdAt),
        ),
    [filteredLeaves],
  );

  // Whether the currently selected card should show the Paid Leave /
  // Leave Taken / Remaining Paid / Extra Hours summary table instead of
  // its normal "today" view. Only applies to On Leave (Present now always
  // shows the staff roster with a "View Attendance" action instead), and
  // only once the user picks a range other than Today.
  const showLeaveSummary = activeCard === "onLeave" && range !== "today";

  // Upcoming holidays, filtered to the selected range.
  const upcomingHolidayRows = useMemo(() => {
    const todayStr = getTodayDate();
    return holidays
      .filter((h) => new Date(h.startDate) >= new Date(todayStr))
      .filter((h) => inRange(h.startDate, range, customFrom, customTo))
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  }, [holidays, range, customFrom, customTo]);

  // Earliest holiday from today onward, regardless of the selected range —
  // used to open the Custom Date modal's calendar on the month it actually
  // falls in (e.g. August) instead of always defaulting to the current
  // month, which is often empty and makes the picker look "stuck".
  const earliestUpcomingHolidayDate = useMemo(() => {
    const todayStr = getTodayDate();
    const upcoming = holidays
      .filter((h) => new Date(h.startDate) >= new Date(todayStr))
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    return upcoming[0]?.startDate || null;
  }, [holidays]);

  // This week's holidays (Mon–Sun containing today), shown as a quick-glance
  // widget on the Upcoming Holidays tab regardless of which range tab is
  // selected.
  const thisWeekHolidays = useMemo(() => {
    const now = new Date();
    const dow = now.getDay(); // 0 = Sunday
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fromKey = toDayKey(monday);
    const toKey = toDayKey(sunday);
    return holidays
      .filter((h) => {
        const key = toDayKey(h.startDate);
        return key && key >= fromKey && key <= toKey;
      })
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  }, [holidays]);

  // Set of Staff._id who have at least one attendance entry within the
  // selected range — used to mark Present / Absent per staff in the
  // Present tab's roster table.
  const presentStaffIdSet = useMemo(() => {
    if (range === "today") {
      return new Set(presentToday.map((s) => String(s._id)));
    }
    const presentAttendanceUserIds = new Set(
      filteredAttendance
        .filter((a) => !a.isLeaveDay)
        .map((a) => {
          const id = typeof a.userId === "object" ? a.userId?._id : a.userId;
          return id ? String(id) : null;
        })
        .filter(Boolean),
    );
    const ids = new Set();
    staffSummary.forEach((row) => {
      if (
        row.attendanceUserId &&
        presentAttendanceUserIds.has(String(row.attendanceUserId))
      ) {
        ids.add(String(row.staffId));
      }
    });
    return ids;
  }, [range, presentToday, filteredAttendance, staffSummary]);

  const handleViewAttendance = (staffId) => {
    navigate(`/hrmlayout/leaveattendance?staffId=${staffId}`);
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  // ── Non-admin ("user") staff: a small, personal dashboard only ─────────
  if (!admin) {
    const myCards = [
      {
        label: "Total Leave",
        value: myStats.totalLeave,
        sub: "All time",
        icon: UserX,
        color: "text-orange-600 bg-orange-50",
        valueColor: "text-orange-600",
        path: "/hrmlayout/leaveattendance",
      },
      {
        label: "Pending Payroll",
        value: fmtMoney(myStats.pendingPayroll),
        sub: "Awaiting payment",
        icon: Clock,
        color: "text-red-600 bg-red-50",
        valueColor: "text-red-600",
        path: "/hrmlayout/payroll",
      },
      {
        label: "Advance",
        value: fmtMoney(myStats.upcomingAdvance),
        sub: "Outstanding",
        icon: Wallet,
        color: "text-pink-600 bg-pink-50",
        valueColor: "text-pink-600",
        path: null,
      },
      {
        label: "Upcoming Holidays",
        value: myStats.upcomingHolidays,
        sub: "All Holidays",
        icon: CalendarClock,
        color: "text-teal-600 bg-teal-50",
        valueColor: "text-teal-600",
        path: "/hrmlayout/holidays",
      },
    ];

    return (
      <div className="p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          Welcome{currentUser?.name ? `, ${currentUser.name}` : ""}
        </h2>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {myCards.map((c) => {
            const cardContent = (
              <Card
                noPadding
                className="p-4 hover:shadow-lg transition-shadow h-full"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-full ${c.color}`}>
                    <c.icon size={20} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{c.label}</p>
                    <p className={`text-xl font-bold ${c.valueColor}`}>
                      {c.value}
                    </p>
                    <p className="text-xs text-gray-400">{c.sub}</p>
                  </div>
                </div>
              </Card>
            );

            if (c.path) {
              return (
                <NavLink key={c.label} to={c.path} className="block">
                  {cardContent}
                </NavLink>
              );
            }
            return <div key={c.label}>{cardContent}</div>;
          })}
        </div>

        <SignInOutCard />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((c) => {
          const isActive = activeCard === c.key;
          return (
            <Card
              key={c.key}
              noPadding
              className="p-6 cursor-pointer transition-all"
              style={isActive ? { backgroundColor: "#e5e7eb" } : undefined}
              onClick={() => setActiveCard(c.key)}
            >
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-full ${c.color}`}>
                  <c.icon size={20} />
                </div>
                <div>
                  <p className="text-xs text-gray-500 flex items-center gap-1">
                    {c.label}
                  </p>
                  <p className={`text-xl font-bold ${c.valueColor}`}>
                    {c.value}
                  </p>
                  <p className="text-xs text-gray-400">{c.sub}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Range tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {(activeCard === "upcomingHolidays"
          ? HOLIDAY_RANGE_TABS
          : activeCard === "activeStaff"
            ? ACTIVE_STAFF_RANGE_TABS
            : RANGE_TABS
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              if (tab.key === "custom") {
                // Opening the Custom Date modal fresh (no custom range
                // applied yet) for Upcoming Holidays: jump straight to the
                // first month that actually has an upcoming holiday
                // (e.g. August) instead of the current month, which is
                // often empty and makes the calendar look broken/stuck.
                // If a custom range is already applied, keep editing it
                // as-is rather than overriding the user's choice.
                if (
                  activeCard === "upcomingHolidays" &&
                  range !== "custom" &&
                  earliestUpcomingHolidayDate
                ) {
                  setDraftCustomFrom(earliestUpcomingHolidayDate);
                  setDraftCustomTo(earliestUpcomingHolidayDate);
                } else {
                  setDraftCustomFrom(customFrom);
                  setDraftCustomTo(customTo);
                }
                setCustomModalOpen(true);
                return;
              }
              setRange(tab.key);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              range === tab.key
                ? "bg-white border-gray-300 text-gray-900 shadow-sm"
                : "border-transparent text-gray-500 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
        {range === "custom" && (
          <button
            onClick={() => {
              setDraftCustomFrom(customFrom);
              setDraftCustomTo(customTo);
              setCustomModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100"
          >
            <Calendar className="w-3.5 h-3.5" />
            {formatDateToDDMMMYYYY(customFrom)} –{" "}
            {formatDateToDDMMMYYYY(customTo)}
          </button>
        )}
      </div>

      {/* Custom Date modal — Start Date / End Date, matching the app's
          existing custom-date-filter pattern. */}
      <Modal
        isOpen={customModalOpen}
        onClose={() => setCustomModalOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            {`Custom Date – ${cards.find((c) => c.key === activeCard)?.label || ""}`}
          </span>
        }
        actions={
          <>
            <button
              onClick={() => setCustomModalOpen(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setCustomFrom(draftCustomFrom);
                setCustomTo(draftCustomTo);
                setRange("custom");
                setCustomModalOpen(false);
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white"
            >
              Apply Filter
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <DatePicker
            label="Start Date"
            value={draftCustomFrom}
            onChange={(e) => setDraftCustomFrom(e.target.value)}
          />
          <DatePicker
            label="End Date"
            value={draftCustomTo}
            onChange={(e) => setDraftCustomTo(e.target.value)}
            minDate={draftCustomFrom ? new Date(draftCustomFrom) : undefined}
          />
        </div>
      </Modal>

      {/* Leaderboard + table */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 mb-8">
        <Card noPadding className="p-6">
          {activeCard === "activeStaff" ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">
                  Recent Joins - Last 7
                </h3>
                <Calendar className="w-4 h-4 text-gray-400" />
              </div>
              {recentJoins.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No active staff have joined yet
                </p>
              ) : (
                <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1">
                  {recentJoins.map((s) => (
                    <div
                      key={s._id}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 text-sm font-semibold flex items-center justify-center">
                          {(s.staffName || "?").charAt(0).toUpperCase()}
                        </div>
                        <p className="text-sm font-semibold text-gray-800">
                          {s.staffName}
                        </p>
                      </div>
                      <span className="text-xs text-gray-500">
                        {formatDateToDDMMMYYYY(s.date)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : activeCard === "upcomingHolidays" ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">
                  This Week's Holidays
                </h3>
                <CalendarClock className="w-4 h-4 text-gray-400" />
              </div>
              {thisWeekHolidays.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No holidays fall in this week
                </p>
              ) : (
                <div className="space-y-4">
                  {thisWeekHolidays.map((h) => (
                    <div
                      key={h._id}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-teal-100 text-teal-600 text-sm font-semibold flex items-center justify-center">
                          <CalendarClock className="w-3.5 h-3.5" />
                        </div>
                        <p className="text-sm font-semibold text-gray-800">
                          {h.name}
                        </p>
                      </div>
                      <span className="text-xs text-gray-500">
                        {formatDateToDDMMMYYYY(h.startDate)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : range === "today" ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">
                  Attendance Mark - Today
                </h3>
                <Calendar className="w-4 h-4 text-gray-400" />
              </div>

              <div className="mb-4">
                <p className="text-xs font-semibold text-green-600 mb-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Present ({presentToday.length})
                </p>
                {presentToday.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    No one has signed in yet
                  </p>
                ) : (
                  <div className="space-y-3">
                    {presentToday.map((s) => (
                      <div key={s._id} className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-green-100 text-green-600 text-sm font-semibold flex items-center justify-center">
                          {(s.staffName || "?").charAt(0).toUpperCase()}
                        </div>
                        <p className="text-sm font-medium text-gray-800">
                          {s.staffName}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-red-500 mb-2 flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" />
                  Not Present ({notPresentToday.length})
                </p>
                {notPresentToday.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    Everyone has signed in
                  </p>
                ) : (
                  <div className="space-y-3">
                    {notPresentToday.map((s) => (
                      <div key={s._id} className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-red-100 text-red-600 text-sm font-semibold flex items-center justify-center">
                          {(s.staffName || "?").charAt(0).toUpperCase()}
                        </div>
                        <p className="text-sm font-medium text-gray-800">
                          {s.staffName}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">
                  Top 5 Highest Present Staff
                </h3>
                <Award className="w-4 h-4 text-gray-400" />
              </div>
              {topPresentStaff.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No attendance records for {rangeLabel}
                </p>
              ) : (
                <div className="space-y-4">
                  {topPresentStaff.map((s, idx) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 text-xs font-bold flex items-center justify-center">
                          #{idx + 1}
                        </div>
                        <p className="text-sm font-semibold text-gray-800">
                          {s.staffName}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-gray-500">
                        {s.count} day{s.count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Highest Present Staff wise Leave: same range, ranked
                   by who has taken the most leave ──────────────────── */}
              <div className="flex items-center justify-between mt-6 mb-4">
                <h3 className="font-semibold text-gray-800">
                  Highest Present Staff Wise Leave
                </h3>
                <UserX className="w-4 h-4 text-gray-400" />
              </div>
              {topLeaveStaff.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No leave records for {rangeLabel}
                </p>
              ) : (
                <div className="space-y-4">
                  {topLeaveStaff.map((s, idx) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-orange-100 text-orange-600 text-xs font-bold flex items-center justify-center">
                          #{idx + 1}
                        </div>
                        <p className="text-sm font-semibold text-gray-800">
                          {s.staffName}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-gray-500">
                        {s.count} leave{s.count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>

        <Card noPadding className="p-6">
          {/* ── Active Staff: full roster of every currently active staff
               member, plus the Recent Joins panel beside it ─────────────── */}
          {activeCard === "activeStaff" && (
            <>
              <h3 className="font-semibold text-gray-800 mb-4">
                Active Staff - All
              </h3>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-center border-collapse">
                  <thead className="bg-gray-50 text-gray-600 border-b">
                    <tr>
                      <th className="p-3 text-sm font-medium">#</th>
                      <th className="p-3 text-sm font-medium">Name</th>
                      <th className="p-3 text-sm font-medium">Team</th>
                      <th className="p-3 text-sm font-medium">Contact</th>
                      <th className="p-3 text-sm font-medium">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeStaffRowsForRange.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="p-8 text-center text-gray-400"
                        >
                          No active staff found
                        </td>
                      </tr>
                    ) : (
                      activeStaffRowsForRange.map((s, idx) => (
                        <tr
                          key={s._id || idx}
                          className={
                            idx < activeStaffRowsForRange.length - 1
                              ? "border-b"
                              : ""
                          }
                        >
                          <td className="p-3 text-sm text-gray-500">
                            #{idx + 1}
                          </td>
                          <td className="p-3 text-sm font-medium text-gray-800">
                            {s.staffName}
                          </td>
                          <td className="p-3 text-sm text-gray-600">
                            {s.projectName || "—"}
                          </td>
                          <td className="p-3 text-sm text-gray-600">
                            {s.contactNo || "—"}
                          </td>
                          <td className="p-3 text-sm text-gray-600">
                            {s.email || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {activeStaffRowsForRange.length > 0 && (
                <p className="text-center text-xs text-gray-400 mt-3">
                  Showing {activeStaffRowsForRange.length} active staff
                </p>
              )}
            </>
          )}

          {/* ── Present tab: staff roster with Present/Absent status for the
               selected range, and a View Attendance action that opens that
               staff's present/absent calendar with a date filter ───────── */}
          {activeCard === "present" && (
            <>
              <h3 className="font-semibold text-gray-800 mb-4">
                Present - {rangeLabel}
              </h3>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-center border-collapse">
                  <thead className="bg-gray-50 text-gray-600 border-b">
                    <tr>
                      <th className="p-3 text-sm font-medium">#</th>
                      <th className="p-3 text-sm font-medium">Name</th>
                      <th className="p-3 text-sm font-medium">Team</th>
                      <th className="p-3 text-sm font-medium">Status</th>
                      <th className="p-3 text-sm font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeStaffRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="p-8 text-center text-gray-400"
                        >
                          No active staff found
                        </td>
                      </tr>
                    ) : (
                      activeStaffRows.map((s, idx) => {
                        const isPresent = presentStaffIdSet.has(String(s._id));
                        return (
                          <tr
                            key={s._id || idx}
                            className={
                              idx < activeStaffRows.length - 1 ? "border-b" : ""
                            }
                          >
                            <td className="p-3 text-sm text-gray-500">
                              #{idx + 1}
                            </td>
                            <td className="p-3 text-sm font-medium text-gray-800">
                              {s.staffName}
                            </td>
                            <td className="p-3 text-sm text-gray-600">
                              {s.projectName || "—"}
                            </td>
                            <td className="p-3 text-sm">
                              <span
                                className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  isPresent
                                    ? "bg-green-100 text-green-700"
                                    : "bg-red-100 text-red-600"
                                }`}
                              >
                                {isPresent ? "Present" : "Not Present"}
                              </span>
                            </td>
                            <td className="p-3 text-sm">
                              <button
                                onClick={() => handleViewAttendance(s._id)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                View Attendance
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {activeStaffRows.length > 0 && (
                <p className="text-center text-xs text-gray-400 mt-3">
                  Showing {activeStaffRows.length} active staff
                </p>
              )}
            </>
          )}

          {/* ── On Leave, a range other than Today is picked:
               show the Paid Leave / Leave Taken / Remaining Paid / Extra
               Hours summary, same as the Attendance & Leaves page ─────── */}
          {showLeaveSummary && (
            <>
              <h3 className="font-semibold text-gray-800 mb-4">
                Leave Summary - {rangeLabel}
              </h3>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-center border-collapse">
                  <thead className="bg-gray-50 text-gray-600 border-b">
                    <tr>
                      <th className="p-3 text-sm font-medium">Name</th>
                      <th className="p-3 text-sm font-medium">Email</th>
                      <th className="p-3 text-sm font-medium">Contact</th>
                      <th className="p-3 text-sm font-medium">Paid Leave</th>
                      <th className="p-3 text-sm font-medium">Leave Taken</th>
                      <th className="p-3 text-sm font-medium">
                        Remaining Paid
                      </th>
                      <th className="p-3 text-sm font-medium">Extra Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffSummary.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="p-8 text-center text-gray-400"
                        >
                          No staff summary data found
                        </td>
                      </tr>
                    ) : (
                      staffSummary.map((row, idx) => (
                        <tr
                          key={row.staffId || idx}
                          className={
                            idx < staffSummary.length - 1 ? "border-b" : ""
                          }
                        >
                          <td className="p-3 text-sm font-medium text-gray-800">
                            {row.staffName}
                          </td>
                          <td className="p-3 text-sm text-gray-600">
                            {row.email || "—"}
                          </td>
                          <td className="p-3 text-sm text-gray-600">
                            {row.contactNo || "—"}
                          </td>
                          <td className="p-3 text-sm">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                              {row.paidLeaveAllotted}
                            </span>
                          </td>
                          <td className="p-3 text-sm">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600">
                              {row.leaveTaken}
                            </span>
                          </td>
                          <td className="p-3 text-sm">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">
                              {Number(row.remainingPaid || 0).toFixed(2)}
                            </span>
                          </td>
                          <td className="p-3 text-sm">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                              {row.extraHoursDays || 0}d{" "}
                              {fmtExtraMinutes(row.extraHoursRemainingMinutes)}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── On Leave, range === Today: who's on leave today ─────────── */}
          {activeCard === "onLeave" && !showLeaveSummary && (
            <>
              <h3 className="font-semibold text-gray-800 mb-4">
                On Leave - {rangeLabel}
              </h3>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-center border-collapse">
                  <thead className="bg-gray-50 text-gray-600 border-b">
                    <tr>
                      <th className="p-3 text-sm font-medium">Staff Name</th>
                      <th className="p-3 text-sm font-medium">Leave Type</th>
                      <th className="p-3 text-sm font-medium">Date</th>
                      <th className="p-3 text-sm font-medium">Reason</th>
                      <th className="p-3 text-sm font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaveRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="p-8 text-center text-gray-400"
                        >
                          No leave records for this period
                        </td>
                      </tr>
                    ) : (
                      leaveRows.map((l, idx) => {
                        const s =
                          staffMap[l.userId] ||
                          resolveStaffForAttendance(l.userId);
                        const displayName =
                          l.staffName || s?.staffName || "Unknown";
                        return (
                          <tr
                            key={l._id || idx}
                            className={
                              idx < leaveRows.length - 1 ? "border-b" : ""
                            }
                          >
                            <td className="p-3 text-sm font-medium text-gray-800">
                              {displayName}
                            </td>
                            <td className="p-3 text-sm text-gray-600 capitalize">
                              {l.leaveType || "—"}
                            </td>
                            <td className="p-3 text-sm text-gray-600">
                              {l.leaveDate
                                ? new Date(l.leaveDate).toLocaleDateString()
                                : "—"}
                            </td>
                            <td className="p-3 text-sm text-gray-600 truncate max-w-[200px]">
                              {l.reason || "—"}
                            </td>
                            <td className="p-3 text-sm">
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-600 capitalize">
                                {l.status || "pending"}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {range === "today" && (
                <div className="mt-6">
                  <h4 className="font-semibold text-gray-800 mb-3 text-sm">
                    Not Logged In Today ({notPresentToday.length})
                  </h4>
                  {notPresentToday.length === 0 ? (
                    <p className="text-sm text-gray-400">
                      Everyone has signed in today
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-gray-200">
                      <table className="w-full text-center border-collapse">
                        <thead className="bg-gray-50 text-gray-600 border-b">
                          <tr>
                            <th className="p-3 text-sm font-medium">#</th>
                            <th className="p-3 text-sm font-medium">Name</th>
                            <th className="p-3 text-sm font-medium">Team</th>
                          </tr>
                        </thead>
                        <tbody>
                          {notPresentToday.map((s, idx) => (
                            <tr
                              key={s._id || idx}
                              className={
                                idx < notPresentToday.length - 1
                                  ? "border-b"
                                  : ""
                              }
                            >
                              <td className="p-3 text-sm text-gray-500">
                                #{idx + 1}
                              </td>
                              <td className="p-3 text-sm font-medium text-gray-800">
                                {s.staffName}
                              </td>
                              <td className="p-3 text-sm text-gray-600">
                                {s.projectName || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Upcoming Holidays: name + date, excluding the count of
               generic Saturday/Sunday off-days (those are never stored as
               named Holiday records) ────────────────────────────────────── */}
          {activeCard === "upcomingHolidays" && (
            <>
              <h3 className="font-semibold text-gray-800 mb-4">
                Upcoming Holidays - {rangeLabel}
              </h3>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-center border-collapse">
                  <thead className="bg-gray-50 text-gray-600 border-b">
                    <tr>
                      <th className="p-3 text-sm font-medium">#</th>
                      <th className="p-3 text-sm font-medium">Holiday Name</th>
                      <th className="p-3 text-sm font-medium">Date</th>
                      <th className="p-3 text-sm font-medium">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingHolidayRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="p-8 text-center text-gray-400"
                        >
                          No upcoming holidays for {rangeLabel}
                        </td>
                      </tr>
                    ) : (
                      upcomingHolidayRows.map((h, idx) => (
                        <tr
                          key={h._id || idx}
                          className={
                            idx < upcomingHolidayRows.length - 1
                              ? "border-b"
                              : ""
                          }
                        >
                          <td className="p-3 text-sm text-gray-500">
                            #{idx + 1}
                          </td>
                          <td className="p-3 text-sm font-medium text-gray-800">
                            {h.name}
                          </td>
                          <td className="p-3 text-sm text-gray-600">
                            {formatDateToDDMMMYYYY(h.startDate)}
                            {h.endDate &&
                            toDayKey(h.endDate) !== toDayKey(h.startDate)
                              ? ` – ${formatDateToDDMMMYYYY(h.endDate)}`
                              : ""}
                          </td>
                          <td className="p-3 text-sm text-gray-600">
                            {h.type || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {upcomingHolidayRows.length > 0 && (
                <p className="text-center text-xs text-gray-400 mt-3">
                  {upcomingHolidayRows.length} holiday
                  {upcomingHolidayRows.length !== 1 ? "s" : ""} (Saturdays &
                  Sundays not counted)
                </p>
              )}
            </>
          )}

          {/* ── Total Payroll / Pending Payroll: payroll rows for the
               selected range (Pending Payroll additionally filtered to
               status === "pending") ─────────────────────────────────────── */}
          {(activeCard === "totalPayroll" || activeCard === "pendingPayroll") && (
            <>
              <h3 className="font-semibold text-gray-800 mb-4">
                {activeCard === "pendingPayroll" ? "Pending Payroll" : "Total Payroll"} -{" "}
                {rangeLabel}
              </h3>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-center border-collapse">
                  <thead className="bg-gray-50 text-gray-600 border-b">
                    <tr>
                      <th className="p-3 text-sm font-medium">Staff Name</th>
                      <th className="p-3 text-sm font-medium">Period</th>
                      <th className="p-3 text-sm font-medium">Team</th>
                      <th className="p-3 text-sm font-medium">Net Salary</th>
                      <th className="p-3 text-sm font-medium">Status</th>
                      <th className="p-3 text-sm font-medium">Payment Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollRowsForCard.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-gray-400">
                          No payroll records for {rangeLabel}
                        </td>
                      </tr>
                    ) : (
                      payrollRowsForCard.map((p, idx) => (
                        <tr
                          key={p._id || idx}
                          className={idx < payrollRowsForCard.length - 1 ? "border-b" : ""}
                        >
                          <td className="p-3 text-sm font-medium text-gray-800">
                            {p.staffName || "—"}
                          </td>
                          <td className="p-3 text-sm text-gray-600">{p.period || "—"}</td>
                          <td className="p-3 text-sm text-gray-600">{p.projectName || "—"}</td>
                          <td className="p-3 text-sm text-gray-600">
                            {fmtMoney(p.netSalary)}
                          </td>
                          <td className="p-3 text-sm">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                                p.status === "paid"
                                  ? "bg-green-100 text-green-700"
                                  : p.status === "approved"
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-yellow-100 text-yellow-700"
                              }`}
                            >
                              {p.status || "—"}
                            </span>
                          </td>
                          <td className="p-3 text-sm text-gray-600">
                            {p.paymentDate ? formatDateToDDMMMYYYY(p.paymentDate) : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {payrollRowsForCard.length > 0 && (
                <p className="text-center text-xs text-gray-400 mt-3">
                  Showing {payrollRowsForCard.length} payroll record
                  {payrollRowsForCard.length !== 1 ? "s" : ""}
                </p>
              )}
            </>
          )}

          {/* ── Total Advances: advance rows for the selected range ─────── */}
          {activeCard === "totalAdvances" && (
            <>
              <h3 className="font-semibold text-gray-800 mb-4">
                Total Advances - {rangeLabel}
              </h3>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-center border-collapse">
                  <thead className="bg-gray-50 text-gray-600 border-b">
                    <tr>
                      <th className="p-3 text-sm font-medium">Staff Name</th>
                      <th className="p-3 text-sm font-medium">Amount</th>
                      <th className="p-3 text-sm font-medium">Date</th>
                      <th className="p-3 text-sm font-medium">Reason</th>
                      <th className="p-3 text-sm font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAdvances.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-gray-400">
                          No advances for {rangeLabel}
                        </td>
                      </tr>
                    ) : (
                      filteredAdvances.map((a, idx) => (
                        <tr
                          key={a._id || idx}
                          className={idx < filteredAdvances.length - 1 ? "border-b" : ""}
                        >
                          <td className="p-3 text-sm font-medium text-gray-800">
                            {a.employeeName || "—"}
                          </td>
                          <td className="p-3 text-sm text-gray-600">{fmtMoney(a.amount)}</td>
                          <td className="p-3 text-sm text-gray-600">
                            {formatDateToDDMMMYYYY(a.date)}
                          </td>
                          <td className="p-3 text-sm text-gray-600 truncate max-w-[200px]">
                            {a.reason || "—"}
                          </td>
                          <td className="p-3 text-sm">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize bg-gray-100 text-gray-700">
                              {a.status || "—"}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {filteredAdvances.length > 0 && (
                <p className="text-center text-xs text-gray-400 mt-3">
                  Showing {filteredAdvances.length} advance
                  {filteredAdvances.length !== 1 ? "s" : ""}
                </p>
              )}
            </>
          )}

          {/* ── Total Expense: office expense rows for the selected range ─ */}
          {activeCard === "totalExpense" && (
            <>
              <h3 className="font-semibold text-gray-800 mb-4">
                Total Expense - {rangeLabel}
              </h3>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-center border-collapse">
                  <thead className="bg-gray-50 text-gray-600 border-b">
                    <tr>
                      <th className="p-3 text-sm font-medium">Category</th>
                      <th className="p-3 text-sm font-medium">Amount</th>
                      <th className="p-3 text-sm font-medium">Date</th>
                      <th className="p-3 text-sm font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExpenses.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-gray-400">
                          No expenses for {rangeLabel}
                        </td>
                      </tr>
                    ) : (
                      filteredExpenses.map((e, idx) => (
                        <tr
                          key={e._id || idx}
                          className={idx < filteredExpenses.length - 1 ? "border-b" : ""}
                        >
                          <td className="p-3 text-sm font-medium text-gray-800">
                            {e.categoryName || "—"}
                          </td>
                          <td className="p-3 text-sm text-gray-600">{fmtMoney(e.amount)}</td>
                          <td className="p-3 text-sm text-gray-600">
                            {formatDateToDDMMMYYYY(e.date)}
                          </td>
                          <td className="p-3 text-sm text-gray-600 truncate max-w-[200px]">
                            {e.note || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {filteredExpenses.length > 0 && (
                <p className="text-center text-xs text-gray-400 mt-3">
                  Showing {filteredExpenses.length} expense
                  {filteredExpenses.length !== 1 ? "s" : ""}
                </p>
              )}
            </>
          )}

          {/* ── Every other card: the normal attendance log ─────────────── */}
          {activeCard !== "activeStaff" &&
            activeCard !== "onLeave" &&
            activeCard !== "present" &&
            activeCard !== "upcomingHolidays" &&
            activeCard !== "totalPayroll" &&
            activeCard !== "pendingPayroll" &&
            activeCard !== "totalAdvances" &&
            activeCard !== "totalExpense" &&
            !showLeaveSummary && (
              <>
                <h3 className="font-semibold text-gray-800 mb-4">
                  Attendance Details - {rangeLabel}
                </h3>
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-center border-collapse">
                    <thead className="bg-gray-50 text-gray-600 border-b">
                      <tr>
                        <th className="p-3 text-sm font-medium">Rank</th>
                        <th className="p-3 text-sm font-medium">Staff Name</th>
                        <th className="p-3 text-sm font-medium">Team</th>
                        <th className="p-3 text-sm font-medium">Login</th>
                        <th className="p-3 text-sm font-medium">Logout</th>
                        <th className="p-3 text-sm font-medium">Total Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendanceRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="p-8 text-center text-gray-400"
                          >
                            No attendance records for this period
                          </td>
                        </tr>
                      ) : (
                        attendanceRows.map((row, idx) => {
                          const s = resolveStaffForAttendance(row.userId);
                          const displayName =
                            row.staffName || s?.staffName || "Unknown";
                          const displayTeam =
                            row.projectName || s?.projectName || "—";
                          return (
                            <tr
                              key={row._id || idx}
                              className={
                                idx < attendanceRows.length - 1
                                  ? "border-b"
                                  : ""
                              }
                            >
                              <td className="p-3 text-sm text-gray-500">
                                #{idx + 1}
                              </td>
                              <td className="p-3 text-sm font-medium text-gray-800">
                                {displayName}
                              </td>
                              <td className="p-3 text-sm text-gray-600">
                                {displayTeam}
                              </td>
                              <td className="p-3 text-sm text-gray-600">
                                {fmtClockTime(row.loginTime)}
                              </td>
                              <td className="p-3 text-sm text-gray-600">
                                {fmtClockTime(row.logoutTime)}
                              </td>
                              <td className="p-3 text-sm text-gray-600">
                                {row.totalTime?.slice(0, 5) || "—"}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {attendanceRows.length > 0 && (
                  <p className="text-center text-xs text-gray-400 mt-3">
                    Showing {attendanceRows.length} of{" "}
                    {filteredAttendance.length} record
                    {filteredAttendance.length !== 1 ? "s" : ""}
                  </p>
                )}
              </>
            )}
        </Card>
      </div>
    </div>
  );
};

export default HrmDashboard;
