// src/components/layout/DashboardLayout.jsx
import React, { useState, useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { LogOut, Menu, Bell } from "lucide-react";
import HolidayAnnouncement from "../dashboard/HolidayAnnouncement";
import Sidebar from "../common/Sidebar";

// Mirrors App.jsx's readUserFromStorage: some login flows only ever write
// the flat "email"/"role"/"username" keys (never a "user" JSON blob), so a
// naive `JSON.parse(localStorage.getItem("user"))` silently returns null.
const readUser = () => {
  try {
    const raw = localStorage.getItem("user");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed._id ||
          parsed.id ||
          parsed.name ||
          parsed.firstName ||
          parsed.email)
      ) {
        return parsed;
      }
    }
  } catch {
    /* ignore parse errors, fall through to flat-key lookup */
  }

  const email = localStorage.getItem("email");
  const role = localStorage.getItem("role");
  const username = localStorage.getItem("username");

  if (email || role || username) {
    return { name: username || email || "User", email, role, username };
  }

  return null;
};

const formatDateTime = (d) =>
  d.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

const DashboardLayout = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const [user, setUser] = useState(() => readUser());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // Re-read whenever another tab logs in/out, or right after this tab's
    // own login flow dispatches "userLoggedIn" (see components/login/index.jsx).
    const refresh = () => setUser(readUser());
    window.addEventListener("storage", refresh);
    window.addEventListener("userLoggedIn", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("userLoggedIn", refresh);
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("email");
    localStorage.removeItem("role");
    localStorage.removeItem("username");
    navigate("/login", { replace: true });
  };

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
        <Sidebar isOpen={true} toggleSidebar={() => {}} isMobile={false} />
      </div>

      <div className="lg:hidden">
        <Sidebar
          isOpen={sidebarOpen}
          toggleSidebar={() => setSidebarOpen(false)}
          isMobile={true}
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

            <span className="hidden xl:block text-sm text-gray-500 tabular-nums whitespace-nowrap">
              {formatDateTime(now)}
            </span>

            <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
              <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold">
                {initials || "U"}
              </div>

              <div className="hidden sm:block leading-tight">
                <p className="text-sm font-medium text-gray-800 truncate max-w-[160px]">
                  {displayName}
                </p>

                <p className="text-xs text-gray-500 capitalize">{role}</p>
              </div>
            </div>

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
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
