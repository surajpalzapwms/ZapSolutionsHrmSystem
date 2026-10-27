// src/components/layout/DashboardLayout.jsx
import React, { Suspense, memo, useCallback, useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { LogOut, Menu, Bell } from "lucide-react";
import HolidayAnnouncement from "../dashboard/HolidayAnnouncement";
import Sidebar from "../common/Sidebar";
import ProfileMenu from "./ProfileMenu";
import Spinner from "../common/Spinner";
import { getCurrentUser } from "../../utils/authUser";
import { useBrand } from "../../contexts/BrandContext";

const formatDateTime = (d) =>
  d.toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

// The clock ticks every second. It lives in its own tiny component so only
// this <span> re-renders each tick — previously the timer sat in the layout
// itself, which re-rendered the whole header + both sidebars every second.
const LiveClock = memo(function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="hidden xl:block text-sm text-gray-500 tabular-nums whitespace-nowrap">
      {formatDateTime(now)}
    </span>
  );
});

// Shown only in the content area while a lazy page chunk downloads, so the
// sidebar and header stay on screen during navigation.
const PageFallback = () => (
  <div className="flex items-center justify-center w-full py-24">
    <Spinner size="lg" />
  </div>
);

const noop = () => {};

const DashboardLayout = () => {
  // Re-mount the open page when the payroll currency changes so every
  // amount on it is shown in the new currency straight away.
  const brand = useBrand();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState(getCurrentUser);

  useEffect(() => {
    // Re-read whenever another tab logs in/out, or right after this tab's
    // own login flow dispatches "userLoggedIn" (see components/login/index.jsx).
    const refresh = () => setUser(getCurrentUser());
    window.addEventListener("storage", refresh);
    window.addEventListener("userLoggedIn", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("userLoggedIn", refresh);
    };
  }, []);

  const handleLogout = useCallback(() => {
    ["token", "user", "email", "role", "username", "selectedCompany"].forEach((k) =>
      localStorage.removeItem(k),
    );
    navigate("/login", { replace: true });
  }, [navigate]);

  const fullName =
    user?.name ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.username ||
    "";
  const displayName = fullName || user?.email || "User";
  const role = user?.role || "User";
  const initials = (fullName || displayName)
    .split(/[@.\s]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      <div className="hidden lg:block">
        <Sidebar isOpen toggleSidebar={noop} isMobile={false} />
      </div>

      <div className="lg:hidden">
        <Sidebar
          isOpen={sidebarOpen}
          toggleSidebar={() => setSidebarOpen(false)}
          isMobile
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center h-16 bg-white border-b border-gray-200 px-4 lg:px-6">
          {/* Left */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 lg:hidden"
              aria-label="Open Menu"
            >
              <Menu size={20} />
            </button>

            <h1 className="text-lg font-semibold text-gray-800 whitespace-nowrap">
              HRM Dashboard
            </h1>
          </div>

          {/* Middle */}
          <div className="flex-1 mx-6 min-w-0 hidden md:flex items-center overflow-hidden">
            <div className="w-full">
              <HolidayAnnouncement />
            </div>
          </div>

          {/* Right */}
          <div className="flex items-center gap-3 lg:gap-4 flex-shrink-0">
            <button
              className="relative p-2 rounded-full text-gray-500 hover:bg-gray-100 cursor-pointer"
              aria-label="Notifications"
            >
              <Bell size={18} />
            </button>

            <LiveClock />

            {/* Avatar (profile photo) — opens the profile card with
                Add / Change photo and Log out together. */}
            <ProfileMenu
              user={user}
              displayName={displayName}
              role={role}
              initials={initials}
              onLogout={handleLogout}
              onUserChange={setUser}
            />

            <button
              onClick={handleLogout}
              className="p-2 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
              aria-label="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Suspense fallback={<PageFallback />}>
            <Outlet key={`${brand.currencyCode}-${brand.numberLocale}`} />
          </Suspense>
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
