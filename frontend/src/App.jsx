import React, { useEffect, useState, Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import HrmLayout from "./components/layout/HrmLayout";
import Login from "./components/login/index";
import DashboardLayout from "./components/layout/DashboardLayout";
import StaffMemberLayout from "./components/layout/StaffMemberLayout";
import ProtectedRoute from "./components/layout/ProtectedRoute";
import AdminRoute from "./components/layout/AdminRoute";
import StaffOnlyRoute from "./components/layout/StaffOnlyRoute";
import Spinner from "./components/common/Spinner";
import { presenceService } from "./services/presenceService";
import { getCurrentUser, isSuperAdminUser } from "./utils/authUser";

// ─────────────────────────────────────────────────────────────────────────────
// Lazy-loaded pages: each becomes its own JS chunk that only downloads the
// first time the user actually navigates there, instead of every page (plus
// the heavy libs some of them pull in — exceljs, xlsx, jspdf, recharts, etc.)
// being bundled into the one script that has to load before anything renders.
// This is what was making the app feel slow to render on first load.
// ─────────────────────────────────────────────────────────────────────────────
const MobileDashboard = lazy(() => import("./components/MobileDashboard"));
const StaffMember = lazy(() => import("./components/staff/index"));
const HrmDashboard = lazy(() => import("./components/hrm/HrmDashboard"));
const Advance = lazy(() => import("./components/advance/index"));
const FinalSettlement = lazy(() =>
  import("./components/final-settlement/index"),
);
const Expenses = lazy(() => import("./components/expenses/index"));
const Holidays = lazy(() => import("./components/holidays/index"));
const Payroll = lazy(() => import("./components/payroll/index"));
const AddPayroll = lazy(() => import("./components/payroll/AddPayrollPage"));
const AddStaffBasicPayroll = lazy(() =>
  import("./components/staff-basic-payroll/AddStaffBasicPayrollPage"),
);
const StaffBasicPayroll = lazy(() =>
  import("./components/staff-basic-payroll/index"),
);
const MyPayslips = lazy(() =>
  import("./components/staff-basic-payroll/MyPayslips"),
);
const MyLeaveRequests = lazy(() =>
  import("./components/leave-requests/MyLeaveRequests"),
);
const MyResignation = lazy(() => import("./components/resign/Myresignation"));
const ResignationRequests = lazy(() =>
  import("./components/resign/ResignationRequests"),
);
const AddStaffMember = lazy(() =>
  import("./components/staff/AddStaffMemberPage"),
);
const LeaveAndAttendance = lazy(() => import("./components/attendance/index"));
const MyAttendance = lazy(() => import("./components/attendance/MyAttendance"));
const LeaveManagement = lazy(() => import("./components/leave/index"));
const Settings = lazy(() => import("./components/settings/Settings"));
const AdminPermissions = lazy(() =>
  import("./components/admin-permissions/AdminPermissions"),
);

// Top-level fallback (login / first paint). Pages inside the dashboard have
// their own Suspense boundary in DashboardLayout so the sidebar/header stay
// visible while a page chunk loads.
const RouteFallback = () => (
  <div className="flex items-center justify-center w-full py-24">
    <Spinner size="lg" />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Hook: detect if the current viewport is mobile (< 1024px)
// ─────────────────────────────────────────────────────────────────────────────
// matchMedia only fires when the breakpoint is actually crossed, instead of
// a state update on every single "resize" event while dragging the window.
const MOBILE_QUERY = "(max-width: 1023.98px)";
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(MOBILE_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
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
  // Synchronous read on first render — never null right after login.
  const [currentUser, setCurrentUser] = useState(getCurrentUser);

  useEffect(() => {
    // "storage": another tab logged in/out. "userLoggedIn": Login.jsx
    // dispatches this right after saving to localStorage in this tab.
    const refresh = () => setCurrentUser(getCurrentUser());
    window.addEventListener("storage", refresh);
    window.addEventListener("userLoggedIn", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("userLoggedIn", refresh);
    };
  }, []);

  // ── Automatic attendance (office network presence) ─────────────────────
  // While a logged-in staff member or admin has the site open, the browser checks
  // in on load, whenever the tab becomes visible again or the network comes
  // back, and every 5 minutes. The backend decides whether the request came
  // from the office network (OFFICE_ALLOWED_IPS): if so and the user hasn't
  // signed in today, they are signed in automatically; leaving the office
  // network stores the disconnect time (see backend services/presence.js).
  // The super admin is never marked.
  // Background call — never shows an error to the user.
  useEffect(() => {
    if (!currentUser || isSuperAdminUser(currentUser)) {
      return undefined;
    }

    const beat = (event) => {
      presenceService
        .heartbeat(event)
        .then((res) => {
          const action = res.data?.action;
          if (["signed_in", "signed_out", "reconnected", "disconnected"].includes(action)) {
            window.dispatchEvent(new CustomEvent("attendanceChanged", { detail: res.data }));
          }
        })
        .catch(() => {});
    };

    beat("startup");
    const onVisible = () => {
      if (document.visibilityState === "visible") beat("resume");
    };
    const onOnline = () => setTimeout(() => beat("online"), 3000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") beat("heartbeat");
    }, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [currentUser]);

  return (
    <>
      <Toaster position="bottom-right" reverseOrder={false} />
      <Suspense fallback={<RouteFallback />}>
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
              {/* Staff self-service: "Attendance" tab shows only the
                  logged-in account's own calendar. The admin's full
                  Attendance screen (staff list + any staff's calendar) stays
                  on "leaveattendance" below, gated by AdminRoute. */}
              <Route path="my-attendance" element={<MyAttendance />} />
              {/* Staff-only self-service: applying for your own leave with
                  the Sick/Casual/Paid/Unpaid checkboxes. Admins/super-admins
                  already apply leave for anyone (including themselves as a
                  staff record) from the Attendance → Leave modal, so this
                  screen is deliberately not for them — enforced here and
                  again server-side on POST/GET /leaves/requests/my. */}
              <Route
                path="my-leave-requests"
                element={
                  <StaffOnlyRoute>
                    <MyLeaveRequests />
                  </StaffOnlyRoute>
                }
              />
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
              <Route
                path="leave"
                element={
                  <AdminRoute requiredTab="leave">
                    <LeaveManagement />
                  </AdminRoute>
                }
              />
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
                path="finalsettlement"
                element={
                  <AdminRoute requiredTab="finalsettlement">
                    <FinalSettlement />
                  </AdminRoute>
                }
              />
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
                path="settings"
                element={
                  <AdminRoute requiredTab="settings">
                    <Settings />
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
      </Suspense>
    </>
  );
}

export default App;