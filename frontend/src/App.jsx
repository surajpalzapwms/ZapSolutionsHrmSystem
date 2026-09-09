import React, { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import HrmLayout from "./components/layout/HrmLayout";
import Login from "./components/login/index";
import DashboardLayout from "./components/layout/DashboardLayout";
import MobileDashboard from "./components/MobileDashboard";
import StaffMemberLayout from "./components/layout/StaffMemberLayout";
import StaffMember from "./components/staff/index";
// HRM pages
import HrmDashboard from "./components/hrm/HrmDashboard";
import Advance from "./components/advance/index";
import Expenses from "./components/expenses/index";
import Holidays from "./components/holidays/index";
import Payroll from "./components/payroll/index";
import AddPayroll from "./components/payroll/AddPayrollPage";
import AddStaffBasicPayroll from "./components/staff-basic-payroll/AddStaffBasicPayrollPage";
import StaffBasicPayroll from "./components/staff-basic-payroll/index";
import MyPayslips from "./components/staff-basic-payroll/MyPayslips";
import MyLeaveRequests from "./components/leave-requests/MyLeaveRequests";
import MyResignation from "./components/resign/Myresignation";
import ResignationRequests from "./components/resign/ResignationRequests";
import AddStaffMember from "./components/staff/AddStaffMemberPage";
import LeaveAndAttendance from "./components/attendance/index";
import LeaveManagement from "./components/leave/index";
import ProtectedRoute from "./components/layout/ProtectedRoute";
import AdminRoute from "./components/layout/AdminRoute";
import InstallPWA from "./components/InstallPWA";
import AdminPermissions from "./components/admin-permissions/AdminPermissions";
import { post } from "./utils/api";
import { isAdminUser } from "./utils/authUser";

const readUserFromStorage = () => {
  // ── Priority 1: proper user object written by the updated Login.jsx ──────
  try {
    const raw = localStorage.getItem("user");
    if (raw) {
      const parsed = JSON.parse(raw);
      // Must be an object with at least a name or id — not a plain JWT string
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed._id || parsed.id || parsed.name)
      ) {
        return parsed;
      }
    }
  } catch {
    /* ignore parse errors */
  }

  // ── Priority 2: fallback — reconstruct from flat keys (old login format) ─
  const email = localStorage.getItem("email");
  const role = localStorage.getItem("role");
  const username = localStorage.getItem("username");

  if (email || role || username) {
    return {
      _id: null,
      id: null,
      name: username || email || "User",
      email: email || null,
      role: role || null,
      username: username || email || null,
    };
  }

  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook: detect if the current viewport is mobile (< 1024px)
// ─────────────────────────────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return isMobile;
}

// ─────────────────────────────────────────────────────────────────────────────
// SmartDashboard: mobile → MobileDashboard, desktop → HrmDashboard
// ─────────────────────────────────────────────────────────────────────────────
function SmartDashboard() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileDashboard /> : <HrmDashboard />;
}

function App() {
  // ✅ Synchronous read on first render — never null after login
  const [currentUser, setCurrentUser] = useState(() => readUserFromStorage());

  useEffect(() => {
    // Cross-tab: another tab logged in or out
    const handleStorageChange = () => setCurrentUser(readUserFromStorage());
    // Same-tab: Login.jsx dispatches this event right after saving to localStorage
    const handleUserLoggedIn = () => setCurrentUser(readUserFromStorage());

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("userLoggedIn", handleUserLoggedIn);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("userLoggedIn", handleUserLoggedIn);
    };
  }, []);

  // ── Silent auto-attendance ──────────────────────────────────────────────
  // Fired once per browser tab per day, the first time the app loads with
  // a logged-in (non-admin) user — this is what actually marks "opened the
  // app this morning". The backend decides whether it counts (only from
  // the office network — see utils/officeNetwork.js on the backend) and
  // always responds 200, so this never shows an error to the user even
  // when they're working from home and nothing gets marked.
  useEffect(() => {
    if (!currentUser || isAdminUser(currentUser)) return;

    const todayKey = `autoCheckinAttempted:${new Date().toDateString()}`;
    if (sessionStorage.getItem(todayKey)) return;
    sessionStorage.setItem(todayKey, "1");

    post("/api/hrm/leaves/attendance/auto-checkin").catch(() => {
      // Best-effort background call — nothing to show the user either way.
    });
  }, [currentUser]);

  return (
    <>
      <Toaster position="bottom-right" reverseOrder={false} />
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* ── Main protected shell ── */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<SmartDashboard />} />
          <Route path="dashboard" element={<SmartDashboard />} />
          <Route path="mobile-dashboard" element={<MobileDashboard />} />

          {/* Staff routes */}
          <Route
            path="staffmemberLayout"
            element={
              <AdminRoute requiredTab="staff">
                <StaffMemberLayout />
              </AdminRoute>
            }
          >
            <Route path="staffmember" element={<StaffMember />} />
            <Route
              path="staffmember/add"
              element={
                <AdminRoute requiredTab="staff.add">
                  <AddStaffMember />
                </AdminRoute>
              }
            />
          </Route>

          <Route path="hrmlayout" element={<HrmLayout />}>
            <Route index element={<HrmDashboard />} />
            <Route path="dashboard">
              <Route index element={<HrmDashboard />} />
              <Route
                path="new"
                element={
                  <AdminRoute requiredTab="staff.add">
                    <AddStaffMember />
                  </AdminRoute>
                }
              />
            </Route>
            <Route
              path="staff"
              element={
                <AdminRoute requiredTab="staff">
                  <StaffMember />
                </AdminRoute>
              }
            />
            <Route path="holidays" element={<Holidays />} />
            {/* Open to any logged-in role — each only ever shows/affects
                the caller's own records (enforced server-side too). */}
            <Route path="my-payslips" element={<MyPayslips />} />
            <Route path="my-leave-requests" element={<MyLeaveRequests />} />
            <Route path="my-resignation" element={<MyResignation />} />
            {/* Admin: view every staff member's resignation requests
                (including ones submitted from the mobile app) and
                approve/reject them. */}
            <Route
              path="resignations"
              element={
                <AdminRoute requiredTab="resignations">
                  <ResignationRequests />
                </AdminRoute>
              }
            />
            <Route
              path="leaveattendance"
              element={
                <AdminRoute requiredTab="attendance">
                  <LeaveAndAttendance />
                </AdminRoute>
              }
            />
            <Route path="leave" element={<LeaveManagement />} />
            <Route path="payroll">
              <Route
                index
                element={
                  <AdminRoute requiredTab="payroll">
                    <Payroll />
                  </AdminRoute>
                }
              />
              <Route
                path="new"
                element={
                  <AdminRoute requiredTab="payroll.add">
                    <AddPayroll />
                  </AdminRoute>
                }
              />
            </Route>
            <Route path="staffbasicpayroll">
              <Route
                index
                element={
                  <AdminRoute requiredTab="staffbasicpayroll">
                    <StaffBasicPayroll />
                  </AdminRoute>
                }
              />
              <Route
                path="new"
                element={
                  <AdminRoute requiredTab="staffbasicpayroll.add">
                    <AddStaffBasicPayroll />
                  </AdminRoute>
                }
              />
            </Route>
            <Route
              path="advance"
              element={
                <AdminRoute requiredTab="advance">
                  <Advance />
                </AdminRoute>
              }
            />
            <Route
              path="expenses"
              element={
                <AdminRoute requiredTab="expenses">
                  <Expenses />
                </AdminRoute>
              }
            />
            <Route
              path="permissions"
              element={
                <AdminRoute superAdminOnly>
                  <AdminPermissions />
                </AdminRoute>
              }
            />
          </Route>
        </Route>
      </Routes>
      <InstallPWA />
    </>
  );
}

export default App;