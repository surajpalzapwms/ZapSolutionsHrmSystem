// src/components/hrm/HrmDashboard.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  CalendarPlus,
  CalendarCheck,
  FileText,
} from "lucide-react";
import Card from "../common/Card";
import Modal from "../common/Modal";
import Spinner from "../common/Spinner";
import DatePicker from "../common/DatePicker";
import SignInOutCard from "../dashboard/SignInOutCard";
import MySettlementCard from "../staff/MySettlementCard";
import { hasLeftOrganization } from "../../utils/staffStatus";
import BirthdayCelebration from "../dashboard/BirthdayCelebration";
import { staffService } from "../../services/staffService";
import { holidayService } from "../../services/holidayService";
import { payrollService } from "../../services/payrollService";
import { attendanceService } from "../../services/attendanceService";
import { advanceService } from "../../services/advanceService";
import { officeExpenseService } from "../../services/officeExpenseService";
import { getTodayDate, formatDateToDDMMMYYYY } from "../../utils/dateUtils";
import { getCurrentUser, isAdminUser } from "../../utils/authUser";
import { filterHolidaysFromJoiningDate } from "../../utils/holidayHelpers";
import {
  groupRequests,
  sortGroupsNewestFirst,
  groupDateLabel,
  groupTypeLabel,
  groupIsHalfDay,
  leaveTypeLabel,
} from "../leave-requests/leaveRequestHelpers";

import { formatMoney } from "../../utils/brand";
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

const ACTIVE_STAFF_RANGE_TABS = RANGE_TABS.filter((t) => t.key === "today");

const fmtClockTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const fmtMoney = (n) => formatMoney(n);

// "2026-07" -> "Jul 2026"
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const fmtPeriod = (period) => {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return period || "—";
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_SHORT[m - 1] || ""} ${y}`;
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
const isActiveStaff = (s) => {
  if (!s || !s.enabled) return false;
  if (s.status === "Relieved" && s.relievingDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const relievingDate = new Date(s.relievingDate);
    relievingDate.setHours(0, 0, 0, 0);
    if (relievingDate <= today) return false;
  }
  return true;
};

// Most list endpoints wrap their array as { data: [...] }, but some use
// { holidays: [...] } / { leaves: [...] } / { records: [...] } or return a
// bare array.
const unwrap = (res) => {
  if (res.status !== "fulfilled") return [];
  const body = res.value?.data;
  const inner =
    body?.data ?? body?.holidays ?? body?.leaves ?? body?.records ?? body;
  return Array.isArray(inner) ? inner : [];
};

// Start of the current year as "YYYY-MM-DD". The Today / This Month / This
// Year tabs only ever need records from this date on, so the dashboard
// loads just that window first instead of every attendance/leave row ever
// saved. Full history is fetched only if "All" (or a custom range reaching
// into an earlier year) is actually selected.
const yearStartKey = () => `${new Date().getFullYear()}-01-01`;

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

// Status pill colours used in the payroll month-wise detail table.
const payrollStatusClass = (status) => {
  switch (status) {
    case "paid":
      return "bg-green-100 text-green-700";
    case "approved":
      return "bg-blue-100 text-blue-700";
    case "partial":
      return "bg-orange-100 text-orange-700";
    case "not generated":
      return "bg-gray-100 text-gray-600";
    default:
      return "bg-yellow-100 text-yellow-700";
  }
};

const HrmDashboard = () => {
  const navigate = useNavigate();
  const currentUser = useMemo(() => getCurrentUser(), []);
  const admin = isAdminUser(currentUser);

  const [loading, setLoading] = useState(true);
  // Admin only: true while the pending payroll summary / staff summary are
  // still loading in the background (the page itself is already shown).
  const [slowLoading, setSlowLoading] = useState(false);
  // Admin only: true while payroll / advances / expenses are still loading.
  const [moneyLoading, setMoneyLoading] = useState(false);
  const [staff, setStaff] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [staffSummary, setStaffSummary] = useState([]);
  // Admin only: the canonical "Pending Payroll" figure — sums each unpaid
  // payroll record's actual outstanding balance PLUS any fully-elapsed
  // month that has no payroll record at all (using that staff member's
  // Basic Salary), via the same /pending-summary endpoint the standalone
  // Payroll page uses.
  const [pendingPayrollSummary, setPendingPayrollSummary] = useState({
    totalPending: 0,
    pendingCount: 0,
    details: [],
  });
  // Non-admin only: the logged-in account's own Staff profile.
  const [myProfile, setMyProfile] = useState(null);
  // Non-admin only: this staff member's own pending payroll, from the same
  // /pending-summary endpoint the admin dashboard uses (the backend narrows
  // it to the caller). null = not loaded / request failed.
  const [myPendingSummary, setMyPendingSummary] = useState(null);
  // Admin only: whether attendance/leaves older than this year are loaded.
  const [fullHistoryLoaded, setFullHistoryLoaded] = useState(false);

  const [range, setRange] = useState("today");
  // Custom range is a from/to pair, set via the Custom Date modal.
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
  // Staff id whose month-wise payroll details are open in the View modal.
  const [viewPayrollStaffId, setViewPayrollStaffId] = useState(null);
  // Staff dashboard: which stat card's details fill the detail panel.
  const [myDetail, setMyDetail] = useState("leave");

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

  // Close the payroll View modal whenever the card or range changes.
  useEffect(() => {
    setViewPayrollStaffId(null);
  }, [activeCard, range, customFrom, customTo]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        if (admin) {
          const from = yearStartKey();

          // The two slowest endpoints (pending payroll summary and the
          // staff leave summary) are loaded in the background — the
          // dashboard renders as soon as the quick lists are in, and these
          // two fill in their parts when they arrive instead of holding the
          // whole page behind a spinner.
          setSlowLoading(true);
          Promise.allSettled([
            attendanceService.getStaffSummary(),
            payrollService.getPendingSummary(),
          ]).then(([staffSummaryRes, pendingSummaryRes]) => {
            if (!mounted) return;
            setStaffSummary(unwrap(staffSummaryRes));
            if (pendingSummaryRes.status === "fulfilled") {
              const body =
                pendingSummaryRes.value?.data?.data ||
                pendingSummaryRes.value?.data ||
                {};
              setPendingPayrollSummary({
                totalPending: body.totalPending || 0,
                pendingCount: body.pendingCount || 0,
                details: Array.isArray(body.details) ? body.details : [],
              });
            }
            setSlowLoading(false);
          });

          // PERFORMANCE: payroll / advances / expenses (whole history) are
          // only needed for their own cards, so they no longer hold the
          // page behind the spinner — the dashboard shows as soon as the
          // staff / attendance / leave / holiday lists are in, and those
          // three cards fill in a moment later.
          setMoneyLoading(true);
          Promise.allSettled([
            payrollService.getAll(),
            advanceService.getAll(),
            officeExpenseService.getAll(),
          ]).then(([payrollRes, advanceRes, expenseRes]) => {
            if (!mounted) return;
            setPayroll(unwrap(payrollRes));
            setAdvances(unwrap(advanceRes));
            setExpenses(unwrap(expenseRes));
            setMoneyLoading(false);
          });

          const [staffRes, holidayRes, attendanceRes, leaveRes] =
            await Promise.allSettled([
              staffService.getAll(),
              holidayService.getAll(),
              attendanceService.getAttendance({ from }),
              attendanceService.getLeaves({ from }),
            ]);
          if (!mounted) return;
          setStaff(unwrap(staffRes));
          setHolidays(unwrap(holidayRes));
          setAttendance(unwrap(attendanceRes));
          setLeaves(unwrap(leaveRes));
        } else {
          // Plain staff only see their own numbers. Admin-only endpoints
          // are skipped entirely.
          const [
            profileRes,
            holidayRes,
            payrollRes,
            advanceRes,
            myLeavesRes,
            pendingSummaryRes,
          ] = await Promise.allSettled([
            staffService.getMyProfile(),
            holidayService.getAll(),
            payrollService.getAll(),
            advanceService.getAll(),
            attendanceService.getMyLeaveRequests(),
            payrollService.getPendingSummary(),
          ]);
          if (!mounted) return;
          if (pendingSummaryRes.status === "fulfilled") {
            const body =
              pendingSummaryRes.value?.data?.data ||
              pendingSummaryRes.value?.data ||
              {};
            setMyPendingSummary({
              totalPending: Number(body.totalPending || 0),
              pendingCount: Number(body.pendingCount || 0),
              details: Array.isArray(body.details) ? body.details : [],
            });
          }
          setMyProfile(
            profileRes.status === "fulfilled"
              ? profileRes.value?.data?.data || null
              : null,
          );
          setHolidays(unwrap(holidayRes));
          setPayroll(unwrap(payrollRes));
          setAdvances(unwrap(advanceRes));
          setLeaves(unwrap(myLeavesRes));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [admin]);

  // Lazily pull full attendance/leave history the first time a range that
  // needs it is selected.
  const needsFullHistory =
    admin &&
    (range === "all" ||
      (range === "custom" && toDayKey(customFrom) < yearStartKey()));

  useEffect(() => {
    if (!needsFullHistory || fullHistoryLoaded) return;
    let mounted = true;
    Promise.allSettled([
      attendanceService.getAttendance(),
      attendanceService.getLeaves(),
    ]).then(([attendanceRes, leaveRes]) => {
      if (!mounted) return;
      if (attendanceRes.status === "fulfilled")
        setAttendance(unwrap(attendanceRes));
      if (leaveRes.status === "fulfilled") setLeaves(unwrap(leaveRes));
      setFullHistoryLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, [needsFullHistory, fullHistoryLoaded]);

  const staffMap = useMemo(() => {
    const map = {};
    staff.forEach((s) => {
      if (s._id) map[s._id] = s;
      if (s.staffId) map[s.staffId] = s;
    });
    return map;
  }, [staff]);

  // Attendance.userId points at the login User account, not at Staff._id.
  // staffSummary carries the User<->Staff bridge (attendanceUserId).
  const attendanceUserIdToStaff = useMemo(() => {
    const map = {};
    staffSummary.forEach((row) => {
      if (row.attendanceUserId) {
        map[String(row.attendanceUserId)] = row;
      }
    });
    return map;
  }, [staffSummary]);

  const resolveStaffForAttendance = useCallback(
    (userId) => {
      const id = typeof userId === "object" ? userId?._id : userId;
      if (!id) return null;
      return (
        attendanceUserIdToStaff[String(id)] || staffMap[String(id)] || null
      );
    },
    [attendanceUserIdToStaff, staffMap],
  );

  // Staff._id -> attendanceUserId.
  const attendanceUserIdByStaffId = useMemo(() => {
    const map = {};
    staffSummary.forEach((row) => {
      if (row.attendanceUserId) {
        map[String(row.staffId)] = String(row.attendanceUserId);
      }
    });
    return map;
  }, [staffSummary]);

  // Non-admin users only ever see data scoped to themselves.
  const myStats = useMemo(() => {
    if (admin) return null;
    const myId = myProfile?._id;

    const approvedLeaveDays = leaves
      .filter((l) => l.status === "approved")
      .reduce((sum, l) => sum + Number(l.dayValue || 1), 0);
    const myPayroll = myId
      ? payroll.filter((p) => sameId(p.employeeId, myId))
      : [];
    const myAdvances = myId
      ? advances.filter((a) => sameId(a.employeeId, myId))
      : [];

    // Preferred: the backend's pending summary. It counts every unpaid
    // amount the admin dashboard counts for this person — including months
    // that have passed but have no payroll record yet (valued at their Basic
    // Salary) and the unpaid balance of partly-paid months.
    // Fallback (summary request failed): sum what is still unpaid on the
    // payroll records we do have. The old code only looked at status
    // "pending" and used netSalary, so "partial" records were ignored and a
    // part-paid month showed its full salary instead of what is left.
    const pendingPayroll =
      myPendingSummary !== null
        ? myPendingSummary.totalPending
        : myPayroll
            .filter((p) => p.status === "pending" || p.status === "partial")
            .reduce(
              (sum, p) =>
                sum +
                Number(
                  p.pendingAmount != null ? p.pendingAmount : p.netSalary || 0,
                ),
              0,
            );
    const upcomingAdvance = myAdvances
      .filter((a) => a.status !== "repaid" && a.status !== "rejected")
      .reduce(
        (sum, a) => sum + (Number(a.amount || 0) - Number(a.repaidAmount || 0)),
        0,
      );
    const today = todayKey();
    // Same rule as the Holidays page: nothing from before they joined.
    const upcomingHolidays = filterHolidaysFromJoiningDate(
      holidays,
      myProfile?.date,
    ).filter((h) => (toDayKey(h.startDate) || "") >= today);
    const nextHolidays = [...upcomingHolidays]
      .sort((a, b) =>
        (toDayKey(a.startDate) || "").localeCompare(toDayKey(b.startDate) || ""),
      )
      .slice(0, 4);

    // ── Rows for the detail panel (shown when a card is clicked) ──
    const approvedGroups = sortGroupsNewestFirst(
      groupRequests(leaves.filter((l) => l.status === "approved")),
    );
    const leaveByType = {};
    leaves
      .filter((l) => l.status === "approved")
      .forEach((l) => {
        const t = leaveTypeLabel(l.leaveType);
        leaveByType[t] = (leaveByType[t] || 0) + Number(l.dayValue || 1);
      });

    // Pending payroll lines: the backend summary's own breakdown when it
    // has one, otherwise the unpaid payroll records we already have.
    const summaryDetails = myPendingSummary?.details || [];
    const pendingRows = summaryDetails.length
      ? summaryDetails.map((d, i) => ({
          key: `${d.period}-${d.type || "salary"}-${i}`,
          period: d.period,
          type: d.type || "salary",
          amount: Number(d.amount || 0),
          status: d.type ? "pending" : "not generated",
        }))
      : myPayroll
          .filter((p) => p.status === "pending" || p.status === "partial")
          .map((p) => ({
            key: p._id,
            period: p.period,
            type: "salary",
            amount: Number(p.pendingAmount != null ? p.pendingAmount : p.netSalary || 0),
            status: p.status,
          }));
    pendingRows.sort((a, b) => String(b.period || "").localeCompare(String(a.period || "")));

    const advanceRows = [...myAdvances]
      .filter((a) => a.status !== "rejected")
      .sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt))
      .map((a) => ({
        key: a._id,
        date: a.date || a.createdAt,
        amount: Number(a.amount || 0),
        repaid: Number(a.repaidAmount || 0),
        remaining: Math.max(0, Number(a.amount || 0) - Number(a.repaidAmount || 0)),
        status: a.status || "pending",
        reason: a.reason || "",
      }));

    return {
      totalLeave: approvedLeaveDays,
      approvedGroups,
      leaveByType,
      pendingRows,
      advanceRows,
      nextHolidays,
      pendingPayroll,
      upcomingAdvance,
      upcomingHolidays: upcomingHolidays.length,
    };
  }, [admin, myProfile, myPendingSummary, leaves, payroll, advances, holidays]);

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

  const payrollRowsForCard = useMemo(() => {
    if (activeCard !== "pendingPayroll") {
      return filteredPayroll.map((p) => ({ ...p, entryType: "salary" }));
    }

    const realRows = filteredPayroll
      .filter((p) => p.status === "pending" || p.status === "partial")
      .map((p) => ({ ...p, entryType: "salary" }));
    if (range !== "today") return realRows;

    const hasRealRecord = (employeeId, period) =>
      payroll.some(
        (p) => sameId(p.employeeId, employeeId) && p.period === period,
      );

    const summaryRows = pendingPayrollSummary.details
      // Encashment / advance-recovery entries are always kept; a plain
      // salary month is only added when no real payroll record exists.
      .filter((d) => d.type || !hasRealRecord(d.employeeId, d.period))
      .map((d) => ({
        _id: `summary_${d.employeeId}_${d.period}_${d.type || "salary"}`,
        employeeId: d.employeeId,
        staffName: d.staffName,
        period: d.period,
        entryType: d.type || "salary",
        netSalary: d.amount,
        paidAmount: 0,
        pendingAmount: d.amount,
        status: d.type ? "pending" : "not generated",
        paymentDate: null,
        __synthetic: true,
      }));

    return [...realRows, ...summaryRows];
  }, [filteredPayroll, activeCard, range, payroll, pendingPayrollSummary]);

  const resolvePayrollStaff = useCallback(
    (p) => {
      const populated =
        p.employeeId && typeof p.employeeId === "object" ? p.employeeId : null;
      const id = populated ? populated._id : p.employeeId;
      const fromMap = id ? staffMap[String(id)] : null;
      return {
        staffName:
          populated?.staffName || fromMap?.staffName || p.staffName || "—",
        projectName:
          populated?.projectName ||
          fromMap?.projectName ||
          p.projectName ||
          "—",
      };
    },
    [staffMap],
  );

  // One entry per staff member for the Total / Pending Payroll table.
  // `months` holds the month-wise salary rows shown in the View modal;
  // Paid Leave encashment and advance recovery are kept separately so the
  // modal can show them in the summary.
  const payrollStaffGroups = useMemo(() => {
    const isPending = activeCard === "pendingPayroll";
    const groups = new Map();

    payrollRowsForCard.forEach((p) => {
      const populated =
        p.employeeId && typeof p.employeeId === "object" ? p.employeeId : null;
      const id = String(populated?._id || p.employeeId || p._id);
      const { staffName, projectName } = resolvePayrollStaff(p);
      if (!groups.has(id)) {
        groups.set(id, {
          id,
          staffName,
          projectName,
          months: [],
          salaryTotal: 0,
          paidTotal: 0,
          pendingTotal: 0,
          leaveEncashment: 0,
          advanceRecovery: 0,
          lastPaymentDate: null,
          total: 0,
        });
      }
      const g = groups.get(id);
      const type = p.entryType || "salary";

      if (type === "leaveEncashment") {
        g.leaveEncashment += Math.abs(Number(p.pendingAmount ?? p.netSalary ?? 0));
        return;
      }
      if (type === "advanceRecovery") {
        g.advanceRecovery += Math.abs(Number(p.pendingAmount ?? p.netSalary ?? 0));
        return;
      }

      g.months.push(p);
      g.salaryTotal += Number(p.netSalary || 0);
      g.paidTotal += Number(
        p.paidAmount ?? (p.status === "paid" ? p.netSalary : 0) ?? 0,
      );
      if (
        p.status === "pending" ||
        p.status === "partial" ||
        p.status === "not generated"
      ) {
        g.pendingTotal += Number(p.pendingAmount ?? p.netSalary ?? 0);
      }
      if (
        p.paymentDate &&
        (!g.lastPaymentDate ||
          new Date(p.paymentDate) > new Date(g.lastPaymentDate))
      ) {
        g.lastPaymentDate = p.paymentDate;
      }
    });

    groups.forEach((g) => {
      g.months.sort((a, b) =>
        String(a.period || "").localeCompare(String(b.period || "")),
      );
      g.total = isPending
        ? g.pendingTotal + g.leaveEncashment - g.advanceRecovery
        : g.salaryTotal;
      g.total = Math.round(g.total * 100) / 100;
    });

    return Array.from(groups.values()).sort((a, b) =>
      a.staffName.localeCompare(b.staffName),
    );
  }, [payrollRowsForCard, resolvePayrollStaff, activeCard]);

  const payrollGrandTotal = useMemo(
    () =>
      Math.round(
        payrollStaffGroups.reduce((sum, g) => sum + g.total, 0) * 100,
      ) / 100,
    [payrollStaffGroups],
  );

  const viewPayrollGroup = useMemo(
    () =>
      viewPayrollStaffId
        ? payrollStaffGroups.find((g) => g.id === viewPayrollStaffId) || null
        : null,
    [viewPayrollStaffId, payrollStaffGroups],
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
    const pendingPayroll =
      range === "today"
        ? pendingPayrollSummary.totalPending
        : filteredPayroll
            .filter((p) => p.status === "pending" || p.status === "partial")
            .reduce(
              (sum, p) => sum + Number(p.pendingAmount ?? p.netSalary ?? 0),
              0,
            );
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
      activeStaff: staff.filter(isActiveStaff).length,
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
    range,
    pendingPayrollSummary,
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
      value: moneyLoading ? "Loading…" : fmtMoney(stats.totalPayroll),
      sub: rangeLabel,
      icon: DollarSign,
      color: "text-purple-600 bg-purple-50",
      valueColor: "text-purple-600",
    },
    {
      key: "pendingPayroll",
      label: "Pending Payroll",
      value:
        (slowLoading && range === "today") || (moneyLoading && range !== "today")
          ? "Loading…"
          : fmtMoney(stats.pendingPayroll),
      sub: rangeLabel,
      icon: Clock,
      color: "text-red-600 bg-red-50",
      valueColor: "text-red-600",
    },
    {
      key: "totalAdvances",
      label: "Total Advances",
      value: moneyLoading ? "Loading…" : fmtMoney(stats.totalAdvances),
      sub: rangeLabel,
      icon: Wallet,
      color: "text-pink-600 bg-pink-50",
      valueColor: "text-pink-600",
    },
    {
      key: "totalExpense",
      label: "Total Expense",
      value: moneyLoading ? "Loading…" : fmtMoney(stats.totalExpense),
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

  // Recent Joins: the last 7 staff to join (most recent first).
  const recentJoins = useMemo(
    () =>
      staff
        .filter((s) => isActiveStaff(s) && s.date)
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 7),
    [staff],
  );

  // Active Staff tab's roster table — every currently active staff member.
  const activeStaffRowsForRange = useMemo(
    () =>
      staff
        .filter(isActiveStaff)
        .slice()
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
    [staff],
  );

  // ── Attendance Mark (range === "today") ─────────────────────────────
  const todaysLoginTimeByUserId = useMemo(() => {
    const map = new Map();
    attendance.forEach((a) => {
      if (a.isLeaveDay) return;
      if (!a.loginTime) return;
      if (!inRange(a.date || a.createdAt, "today")) return;
      const id = typeof a.userId === "object" ? a.userId?._id : a.userId;
      if (!id) return;
      const key = String(id);
      const existing = map.get(key);
      if (!existing || new Date(a.loginTime) < new Date(existing)) {
        map.set(key, a.loginTime);
      }
    });
    return map;
  }, [attendance]);

  const todaysAttendanceUserIds = useMemo(
    () => new Set(todaysLoginTimeByUserId.keys()),
    [todaysLoginTimeByUserId],
  );

  const presentToday = useMemo(
    () =>
      staff.filter((s) => {
        if (!isActiveStaff(s)) return false;
        const attendanceUserId = attendanceUserIdByStaffId[String(s._id)];
        return (
          attendanceUserId && todaysAttendanceUserIds.has(attendanceUserId)
        );
      }),
    [staff, attendanceUserIdByStaffId, todaysAttendanceUserIds],
  );

  const todaysLoginTimeForStaff = useCallback(
    (s) => {
      const attendanceUserId = attendanceUserIdByStaffId[String(s._id)];
      if (!attendanceUserId) return null;
      return todaysLoginTimeByUserId.get(attendanceUserId) || null;
    },
    [attendanceUserIdByStaffId, todaysLoginTimeByUserId],
  );

  const notPresentToday = useMemo(() => {
    const presentIds = new Set(presentToday.map((s) => String(s._id)));
    return staff.filter(
      (s) => isActiveStaff(s) && !presentIds.has(String(s._id)),
    );
  }, [staff, presentToday]);

  // ── Top 5 Highest Present Staff (range !== "today") ─────────────────
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
  }, [filteredAttendance, resolveStaffForAttendance]);

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
  }, [filteredLeaves, staffMap, resolveStaffForAttendance]);

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

  // Full active-staff roster shown when the "Present" card is selected.
  const activeStaffRows = useMemo(() => staff.filter(isActiveStaff), [staff]);

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

  const showLeaveSummary = activeCard === "onLeave" && range !== "today";

  // Upcoming holidays, filtered to the selected range.
  const upcomingHolidayRows = useMemo(() => {
    const todayStr = getTodayDate();
    return holidays
      .filter((h) => new Date(h.startDate) >= new Date(todayStr))
      .filter((h) => inRange(h.startDate, range, customFrom, customTo))
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  }, [holidays, range, customFrom, customTo]);

  // Earliest holiday from today onward — used to open the Custom Date
  // modal on the month it actually falls in.
  const earliestUpcomingHolidayDate = useMemo(() => {
    const todayStr = getTodayDate();
    const upcoming = holidays
      .filter((h) => new Date(h.startDate) >= new Date(todayStr))
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    return upcoming[0]?.startDate || null;
  }, [holidays]);

  // This week's holidays (Mon–Sun containing today).
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

  // Staff._id who have at least one attendance entry within the range.
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
    // Leave / Pending Payroll / Advance open their details in the panel on
    // the right; Upcoming Holidays still goes to the Holidays page.
    const myCards = [
      {
        key: "leave",
        label: "Leave Taken",
        value: myStats.totalLeave,
        sub: "Approved days",
        icon: UserX,
        iconClass: "text-orange-600 bg-orange-50",
        ring: "ring-orange-300 border-orange-300",
      },
      {
        key: "payroll",
        label: "Pending Payroll",
        value: fmtMoney(myStats.pendingPayroll),
        sub: "Awaiting payment",
        icon: Clock,
        iconClass: "text-rose-600 bg-rose-50",
        ring: "ring-rose-300 border-rose-300",
      },
      {
        key: "advance",
        label: "Advance",
        value: fmtMoney(myStats.upcomingAdvance),
        sub: "Outstanding",
        icon: Wallet,
        iconClass: "text-pink-600 bg-pink-50",
        ring: "ring-pink-300 border-pink-300",
      },
      {
        key: "holidays",
        label: "Upcoming Holidays",
        value: myStats.upcomingHolidays,
        sub: "This year",
        icon: CalendarClock,
        iconClass: "text-teal-600 bg-teal-50",
        path: "/hrmlayout/holidays",
      },
    ];

    const quickLinks = [
      { label: "Apply Leave", icon: CalendarPlus, path: "/hrmlayout/my-leave-requests", className: "text-blue-600 bg-blue-50" },
      { label: "Attendance", icon: CalendarCheck, path: "/hrmlayout/my-attendance", className: "text-emerald-600 bg-emerald-50" },
      { label: "Payslips", icon: FileText, path: "/hrmlayout/my-payslips", className: "text-violet-600 bg-violet-50" },
      { label: "Holidays", icon: Calendar, path: "/hrmlayout/holidays", className: "text-amber-600 bg-amber-50" },
    ];

    const hour = new Date().getHours();
    const greeting =
      hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const firstName = (currentUser?.name || "").trim().split(/\s+/)[0];
    const todayLabel = new Date().toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const STATUS_PILL = {
      approved: "bg-green-100 text-green-700",
      pending: "bg-amber-100 text-amber-700",
      partial: "bg-blue-100 text-blue-700",
      "not generated": "bg-gray-100 text-gray-600",
      repaid: "bg-green-100 text-green-700",
      active: "bg-amber-100 text-amber-700",
    };
    const pill = (status) => (
      <span
        className={`px-2 py-0.5 rounded-full text-[11px] font-medium capitalize whitespace-nowrap ${
          STATUS_PILL[status] || "bg-gray-100 text-gray-600"
        }`}
      >
        {status}
      </span>
    );
    const shortDate = (d) => {
      const x = new Date(d);
      return isNaN(x)
        ? "—"
        : x.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    };
    const emptyState = (text) => (
      <p className="p-8 text-center text-sm text-gray-400">{text}</p>
    );

    const detail = {
      leave: {
        title: "Leave Taken",
        linkLabel: "My leave requests",
        link: "/hrmlayout/my-leave-requests",
        body: (
          <>
            {Object.keys(myStats.leaveByType).length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-5 pt-3 pb-2">
                {Object.entries(myStats.leaveByType).map(([t, n]) => (
                  <span key={t} className="px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 text-xs font-medium">
                    {t}: {n}
                  </span>
                ))}
              </div>
            )}
            {myStats.approvedGroups.length === 0 ? (
              emptyState("No approved leave yet")
            ) : (
              <ul className="divide-y divide-gray-100">
                {myStats.approvedGroups.map((g) => (
                  <li key={g.key} className="px-5 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-800 truncate">{groupDateLabel(g)}</p>
                      <span className="text-[11px] text-gray-500 whitespace-nowrap">
                        {groupTypeLabel(g)}
                        {groupIsHalfDay(g) ? " · Half" : ""}
                      </span>
                    </div>
                    {g.days[0]?.reason && (
                      <p className="text-xs text-gray-400 truncate">{g.days[0].reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ),
      },
      payroll: {
        title: "Pending Payroll",
        linkLabel: "My payslips",
        link: "/hrmlayout/my-payslips",
        body:
          myStats.pendingRows.length === 0 ? (
            emptyState("Nothing pending — you're all paid up")
          ) : (
            <ul className="divide-y divide-gray-100">
              {myStats.pendingRows.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">{fmtPeriod(r.period)}</p>
                    <p className="text-xs text-gray-400 capitalize">
                      {r.type === "salary" ? "Salary" : r.type.replace(/[-_]/g, " ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {pill(r.status)}
                    <span className="text-sm font-semibold text-gray-800 tabular-nums">{fmtMoney(r.amount)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ),
      },
      advance: {
        title: "Advance",
        linkLabel: null,
        link: null,
        body:
          myStats.advanceRows.length === 0 ? (
            emptyState("No advances taken")
          ) : (
            <ul className="divide-y divide-gray-100">
              {myStats.advanceRows.map((r) => (
                <li key={r.key} className="px-5 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-gray-800">{shortDate(r.date)}</p>
                    <div className="flex items-center gap-2">
                      {pill(r.status)}
                      <span className="text-sm font-semibold text-gray-800 tabular-nums">{fmtMoney(r.amount)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    Repaid {fmtMoney(r.repaid)} · Remaining{" "}
                    <span className="text-pink-600 font-medium">{fmtMoney(r.remaining)}</span>
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ),
      },
    }[myDetail];

    return (
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:h-full lg:overflow-hidden">
        {/* Welcome banner */}
        <div className="flex-shrink-0 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-blue-100">{todayLabel}</p>
            <h2 className="text-2xl font-bold mt-0.5">
              {greeting}
              {firstName ? `, ${firstName}` : ""}
            </h2>
          </div>
          <NavLink
            to="/hrmlayout/my-leave-requests"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-sm font-medium transition-colors"
          >
            <CalendarPlus size={16} />
            Apply for leave
          </NavLink>
        </div>

        {/* Birthdays: today's (with 🎉 Wish) + upcoming */}
        <BirthdayCelebration />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:flex-1 lg:min-h-0">
          {/* Left: Sign in / out on top, Quick Actions below — half each */}
          <div className="flex flex-col gap-4 lg:min-h-0">
            <div className="lg:flex-1 lg:min-h-0">
              {hasLeftOrganization(myProfile) ? (
                <MySettlementCard staff={myProfile} />
              ) : (
                <SignInOutCard />
              )}
            </div>

            <div className="lg:flex-1 lg:min-h-0 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-base font-semibold text-gray-800">Quick Actions</h3>
              </div>
              <div className="flex-1 min-h-0 grid grid-cols-2 auto-rows-fr gap-2.5 p-3 overflow-y-auto">
                {quickLinks.map((q) => (
                  <NavLink
                    key={q.label}
                    to={q.path}
                    className="group flex items-center gap-2.5 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5 hover:bg-white hover:border-blue-200 hover:shadow-sm transition-all"
                  >
                    <span className={`w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center ${q.className}`}>
                      <q.icon size={17} />
                    </span>
                    <span className="text-sm font-medium text-gray-700 group-hover:text-blue-700">{q.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 flex flex-col gap-4 lg:min-h-0">
            {/* Stat cards */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 flex-shrink-0">
              {myCards.map((c) => {
                const selected = !c.path && myDetail === c.key;
                const content = (
                  <div
                    className={`h-full bg-white rounded-2xl border shadow-sm p-4 transition-all ${
                      selected
                        ? `ring-2 ${c.ring}`
                        : "border-gray-200 hover:shadow-md hover:border-blue-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-500 truncate">{c.label}</p>
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.iconClass}`}>
                        <c.icon size={16} />
                      </span>
                    </div>
                    <p className="text-xl 2xl:text-2xl font-bold text-gray-800 mt-2 truncate" title={String(c.value)}>
                      {c.value}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {c.path ? c.sub : selected ? "Showing details" : "Click for details"}
                    </p>
                  </div>
                );
                return c.path ? (
                  <NavLink key={c.key} to={c.path} className="block">
                    {content}
                  </NavLink>
                ) : (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setMyDetail(c.key)}
                    aria-pressed={selected}
                    className="block text-left cursor-pointer"
                  >
                    {content}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:flex-1 lg:min-h-0">
              {/* Upcoming holidays */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col lg:min-h-0">
                <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-gray-800">Upcoming Holidays</h3>
                  <NavLink to="/hrmlayout/holidays" className="text-xs font-medium text-blue-600 hover:text-blue-700">
                    View all
                  </NavLink>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {myStats.nextHolidays.length === 0 ? (
                    emptyState("No upcoming holidays")
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {myStats.nextHolidays.map((h) => {
                        const d = new Date(h.startDate);
                        return (
                          <li key={h._id || `${h.name}-${h.startDate}`} className="flex items-center gap-3 px-5 py-2.5">
                            <div className="w-11 flex-shrink-0 text-center rounded-lg bg-amber-50 border border-amber-100 py-1">
                              <p className="text-base font-bold text-amber-700 leading-none">
                                {isNaN(d) ? "–" : String(d.getDate()).padStart(2, "0")}
                              </p>
                              <p className="text-[10px] font-semibold uppercase text-amber-500 mt-0.5">
                                {isNaN(d) ? "" : d.toLocaleDateString("en-IN", { month: "short" })}
                              </p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate capitalize">{h.name}</p>
                              <p className="text-xs text-gray-400">
                                {isNaN(d) ? "" : d.toLocaleDateString("en-IN", { weekday: "long" })}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              {/* Details of the selected card (Leave / Pending Payroll / Advance) */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col lg:min-h-0">
                <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-gray-800">{detail.title} Details</h3>
                  {detail.link && (
                    <NavLink to={detail.link} className="text-xs font-medium text-blue-600 hover:text-blue-700">
                      {detail.linkLabel}
                    </NavLink>
                  )}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">{detail.body}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isPendingPayrollCard = activeCard === "pendingPayroll";

  return (
    <div className="p-6">
      {/* Birthdays: today's (with 🎉 Wish) + upcoming */}
      <BirthdayCelebration className="mb-6" />

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

      {/* Custom Date modal */}
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

      <Modal
        isOpen={!!viewPayrollGroup}
        onClose={() => setViewPayrollStaffId(null)}
        title={
          <span className="flex items-center gap-2">
            <Eye className="w-4 h-4" />
            {`${isPendingPayrollCard ? "Pending Payroll" : "Total Payroll"} – ${
              viewPayrollGroup?.staffName || ""
            }`}
          </span>
        }
        actions={
          <button
            onClick={() => setViewPayrollStaffId(null)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            Close
          </button>
        }
      >
        {viewPayrollGroup && (
          <div className="space-y-5">
            <div>
              <h4 className="text-sm font-semibold text-gray-800 mb-2">
                Month-wise Details
              </h4>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-center border-collapse">
                  <thead className="bg-gray-50 text-gray-600 border-b">
                    <tr>
                      <th className="p-2.5 text-xs font-medium">#</th>
                      <th className="p-2.5 text-xs font-medium">Month</th>
                      <th className="p-2.5 text-xs font-medium">Net Salary</th>
                      <th className="p-2.5 text-xs font-medium">Paid</th>
                      <th className="p-2.5 text-xs font-medium">Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewPayrollGroup.months.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="p-6 text-center text-sm text-gray-400"
                        >
                          No month-wise salary entries
                        </td>
                      </tr>
                    ) : (
                      viewPayrollGroup.months.map((m, idx) => {
                        const pending =
                          m.status === "paid"
                            ? 0
                            : Number(m.pendingAmount ?? m.netSalary ?? 0);
                        return (
                          <tr
                            key={m._id || idx}
                            className={
                              idx < viewPayrollGroup.months.length - 1
                                ? "border-b"
                                : ""
                            }
                          >
                            <td className="p-2.5 text-sm text-gray-500">
                              {idx + 1}
                            </td>
                            <td className="p-2.5 text-sm font-medium text-gray-800">
                              {fmtPeriod(m.period)}
                            </td>
                            <td className="p-2.5 text-sm text-gray-600">
                              {fmtMoney(m.netSalary)}
                            </td>
                            <td className="p-2.5 text-sm text-green-700">
                              {fmtMoney(m.paidAmount || 0)}
                            </td>
                            <td className="p-2.5 text-sm text-red-600">
                              {fmtMoney(pending)}
                            </td>
                            
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summary */}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <h4 className="text-sm font-semibold text-gray-800 mb-3">
                Summary
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">
                    Months ({viewPayrollGroup.months.length})
                  </span>
                  <span className="text-gray-800">
                    {viewPayrollGroup.months
                      .map((m) => fmtPeriod(m.period))
                      .join(", ") || "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Net Salary</span>
                  <span className="font-medium text-gray-800">
                    {fmtMoney(viewPayrollGroup.salaryTotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Already Paid</span>
                  <span className="font-medium text-green-700">
                    {fmtMoney(viewPayrollGroup.paidTotal)}
                  </span>
                </div>
                {isPendingPayrollCard && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Salary Pending</span>
                    <span className="font-medium text-gray-800">
                      {fmtMoney(viewPayrollGroup.pendingTotal)}
                    </span>
                  </div>
                )}
                {viewPayrollGroup.leaveEncashment > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">
                      Paid Leave Encashment
                    </span>
                    <span className="font-medium text-green-700">
                      + {fmtMoney(viewPayrollGroup.leaveEncashment)}
                    </span>
                  </div>
                )}
                {viewPayrollGroup.advanceRecovery > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Advance Recovery</span>
                    <span className="font-medium text-red-600">
                      − {fmtMoney(viewPayrollGroup.advanceRecovery)}
                    </span>
                  </div>
                )}
                {viewPayrollGroup.lastPaymentDate && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Last Payment Date</span>
                    <span className="text-gray-800">
                      {formatDateToDDMMMYYYY(viewPayrollGroup.lastPaymentDate)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-gray-300 pt-2 mt-2">
                  <span className="font-semibold text-gray-800">
                    {isPendingPayrollCard ? "Total Pending" : "Total Amount"}
                  </span>
                  <span
                    className={`font-bold ${
                      isPendingPayrollCard ? "text-red-600" : "text-purple-600"
                    }`}
                  >
                    {fmtMoney(viewPayrollGroup.total)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
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
                    {presentToday.map((s) => {
                      const loginTime = todaysLoginTimeForStaff(s);
                      return (
                        <div key={s._id} className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-green-100 text-green-600 text-sm font-semibold flex items-center justify-center">
                            {(s.staffName || "?").charAt(0).toUpperCase()}
                          </div>
                          <p className="text-sm font-medium text-gray-800 flex-1">
                            {s.staffName}
                          </p>
                          {loginTime && (
                            <span className="text-xs text-gray-500">
                              {fmtClockTime(loginTime)}
                            </span>
                          )}
                        </div>
                      );
                    })}
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
          {/* ── Active Staff roster ─────────────────────────────────────── */}
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
                      <th className="p-3 text-sm font-medium">Contact</th>
                      <th className="p-3 text-sm font-medium">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeStaffRowsForRange.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
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

          {/* ── Present tab ─────────────────────────────────────────────── */}
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
                      <th className="p-3 text-sm font-medium">Status</th>
                      <th className="p-3 text-sm font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeStaffRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
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
                    </tr>
                  </thead>
                  <tbody>
                    {staffSummary.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
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
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── On Leave, range === Today ───────────────────────────────── */}
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

          {/* ── Total Payroll / Pending Payroll: one row per staff with the
               total amount; View opens the month-wise details + summary ── */}
          {(activeCard === "totalPayroll" || isPendingPayrollCard) && (
            <>
              <h3 className="font-semibold text-gray-800 mb-4">
                {isPendingPayrollCard ? "Pending Payroll" : "Total Payroll"} -{" "}
                {rangeLabel}
              </h3>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-center border-collapse">
                  <thead className="bg-gray-50 text-gray-600 border-b">
                    <tr>
                      <th className="p-3 text-sm font-medium">#</th>
                      <th className="p-3 text-sm font-medium">Staff Name</th>
                      <th className="p-3 text-sm font-medium">Months</th>
                      <th className="p-3 text-sm font-medium">
                        {isPendingPayrollCard
                          ? "Total Pending Amount"
                          : "Total Amount"}
                      </th>
                      <th className="p-3 text-sm font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollStaffGroups.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="p-8 text-center text-gray-400"
                        >
                          No payroll records for {rangeLabel}
                        </td>
                      </tr>
                    ) : (
                      payrollStaffGroups.map((g, idx) => (
                        <tr key={g.id || idx} className="border-b">
                          <td className="p-3 text-sm text-gray-500">
                            #{idx + 1}
                          </td>
                          <td className="p-3 text-sm font-medium text-gray-800">
                            {g.staffName}
                            {g.leaveEncashment > 0 && (
                              <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">
                                + Paid Leave
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-sm text-gray-600">
                            {g.months.length}
                          </td>
                          <td
                            className={`p-3 text-sm font-semibold ${
                              isPendingPayrollCard
                                ? "text-red-600"
                                : "text-purple-600"
                            }`}
                          >
                            {fmtMoney(g.total)}
                          </td>
                          <td className="p-3 text-sm">
                            <button
                              type="button"
                              onClick={() => setViewPayrollStaffId(g.id)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              View
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {payrollStaffGroups.length > 0 && (
                    <tfoot className="bg-gray-50">
                      <tr>
                        <td
                          colSpan={3}
                          className="p-3 text-sm font-semibold text-gray-800 text-right"
                        >
                          Grand Total
                        </td>
                        <td
                          className={`p-3 text-sm font-bold ${
                            isPendingPayrollCard
                              ? "text-red-600"
                              : "text-purple-600"
                          }`}
                        >
                          {fmtMoney(payrollGrandTotal)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {payrollStaffGroups.length > 0 && (
                <p className="text-center text-xs text-gray-400 mt-3">
                  Showing {payrollStaffGroups.length} staff member
                  {payrollStaffGroups.length !== 1 ? "s" : ""}
                </p>
              )}
            </>
          )}

          {/* ── Total Advances ──────────────────────────────────────────── */}
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
                        <td
                          colSpan={5}
                          className="p-8 text-center text-gray-400"
                        >
                          No advances for {rangeLabel}
                        </td>
                      </tr>
                    ) : (
                      filteredAdvances.map((a, idx) => (
                        <tr
                          key={a._id || idx}
                          className={
                            idx < filteredAdvances.length - 1 ? "border-b" : ""
                          }
                        >
                          <td className="p-3 text-sm font-medium text-gray-800">
                            {a.employeeName || "—"}
                          </td>
                          <td className="p-3 text-sm text-gray-600">
                            {fmtMoney(a.amount)}
                          </td>
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

          {/* ── Total Expense ───────────────────────────────────────────── */}
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
                        <td
                          colSpan={4}
                          className="p-8 text-center text-gray-400"
                        >
                          No expenses for {rangeLabel}
                        </td>
                      </tr>
                    ) : (
                      filteredExpenses.map((e, idx) => (
                        <tr
                          key={e._id || idx}
                          className={
                            idx < filteredExpenses.length - 1 ? "border-b" : ""
                          }
                        >
                          <td className="p-3 text-sm font-medium text-gray-800">
                            {e.categoryName || "—"}
                          </td>
                          <td className="p-3 text-sm text-gray-600">
                            {fmtMoney(e.amount)}
                          </td>
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
                        <th className="p-3 text-sm font-medium">Login</th>
                        <th className="p-3 text-sm font-medium">Logout</th>
                        <th className="p-3 text-sm font-medium">Total Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendanceRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
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