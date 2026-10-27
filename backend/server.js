// Must be the very first import: it registers a global mongoose plugin that
// times every query, and plugins only apply to models compiled after it.
import { requestTiming } from "./utils/requestTiming.js";
import dns from "dns";
import path from "path";
import { fileURLToPath } from "url";

// Some networks/ISPs' default DNS doesn't handle SRV records properly,
// which breaks mongodb+srv:// lookups. But hardcoding public resolvers
// (8.8.8.8 / 1.1.1.1) unconditionally is itself risky — some networks
// block outbound DNS to those specific IPs while their own default
// resolver works fine, which would turn a working setup into a broken
// one. So: try the SRV lookup with whatever DNS the OS is already using
// first, and only switch to public resolvers if that actually fails.
async function ensureSrvResolvable(mongoUri) {
  const match = mongoUri.match(/^mongodb\+srv:\/\/[^@]+@([^/?]+)/);
  if (!match) return; // not an SRV-style URI, nothing to check

  const srvHost = `_mongodb._tcp.${match[1]}`;

  try {
    await dns.promises.resolveSrv(srvHost);
    // Default resolver works fine — leave it alone.
  } catch (err) {
    console.warn(
      `⚠️  SRV lookup for ${srvHost} failed with the default DNS resolver ` +
        `(${err.code}). Falling back to 8.8.8.8 / 1.1.1.1...`,
    );
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
    try {
      await dns.promises.resolveSrv(srvHost);
    } catch (fallbackErr) {
      console.error(
        `❌ SRV lookup for ${srvHost} also failed using fallback DNS resolvers ` +
          `(${fallbackErr.code}). This network may be blocking DNS to 8.8.8.8/1.1.1.1 ` +
          `as well as your default resolver — check your network/firewall/VPN.`,
      );
    }
  }
}

import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import connectDB from "./utils/db.js";
import authRoutes from "./routes/authRoutes.js";
import payrollRoutes from "./routes/payrollRoutes.js";
import expenseRoutes from "./routes/expenseRoutes.js";
import attendanceRoutes from "./routes/attendance.js";
import holidayRoutes from "./routes/holiday.js";
import saturdayHolidayRoutes from "./routes/saturdayHoliday.js";
import staffRoutes from "./routes/staffRoutes.js";
import advanceRoutes from "./routes/advanceRoutes.js";
import staffBasicPayrollRoutes from "./routes/staffBasicPayrollRoutes.js";
import expenseCategoryRoutes from "./routes/expenseCategoryRoutes.js";
import officeExpenseRoutes from "./routes/officeExpenseRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import leaveAttendanceRoutes from "./routes/leave.js";
import leavePolicyRoutes from "./routes/leavePolicy.js";
import resignationRoutes from "./routes/resignation.js";
import sidebarCountsRoutes from "./routes/sidebarCounts.js";
import counselingRoutes from "./routes/counseling.js";
import presenceRoutes from "./routes/presence.js";
import letterRoutes from "./routes/letterRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import lateDeductionRoutes from "./routes/lateDeduction.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import { runPresenceSweep } from "./services/presence.js";
import { checkSingleCompanyData } from "./services/singleCompanyCheck.js";
import { reloadOfficeNetworks } from "./utils/officeNetwork.js";
import { reconcileAllStaffAbsences } from "./services/leaveAutomation.js";
import {
  invalidateCalendarHealOnWrite,
  markCalendarDataChanged,
} from "./services/calendarHealCache.js";
import { runCacheWarmers, invalidateResponseCache } from "./services/responseCache.js";
import { clearAuthUserCache } from "./middleware/auth.js";
import {
  clearStaffVisibilityCache,
  hideDisabledStaffRows,
} from "./services/staffVisibility.js";

const app = express();

// Deployed behind a reverse proxy (Render/Vercel/nginx/etc). Without this,
// req.ip is always the proxy's address, which breaks per-IP rate limiting
// (everyone shares one bucket) and any secure-cookie "is this really HTTPS"
// checks.
//
// TRUST_PROXY_HOPS = how many proxies sit between the internet and this
// server (default 1 = one proxy, e.g. Render). With 2 (e.g. Cloudflare +
// nginx) a wrong value of 1 makes EVERY device look like it comes from the
// proxy, so the office Wi-Fi is never recognised. "false" = no proxy.
{
  const raw = String(process.env.TRUST_PROXY_HOPS ?? "1").trim().toLowerCase();
  app.set(
    "trust proxy",
    raw === "true" ? true : raw === "false" ? false : Number.isFinite(Number(raw)) ? Number(raw) : raw,
  );
}

// Middleware
app.use(helmet());
// Per-request timing: Server-Timing header (visible in DevTools -> Network ->
// Timing) and a console warning for any request slower than 800ms. See
// utils/requestTiming.js.
app.use(requestTiming);
// Gzip/deflate every JSON response before it goes over the wire. The
// backend already exchanges plain JSON with the frontend end-to-end
// (express.json() in, res.json() out) — this is what actually cuts the
// bytes on the wire for the larger payloads (staff lists, attendance
// calendars, payroll runs), which is usually what "the site feels slow"
// comes down to on a normal connection. compression() only kicks in for
// responses over ~1KB and skips anything the client sends
// "Accept-Encoding: identity" for, so it's a safe default with no
// behavior change for callers — axios/fetch/browsers all negotiate
// gzip automatically and decompress transparently.
app.use(compression());
// Strip trailing slashes AND lowercase the origin so "http://localhost:5173/",
// "http://localhost:5173", and "HTTPS://LOCALHOST:5173" are all treated as
// the same origin. Hostnames are case-insensitive per spec, but a plain
// string comparison is not — without lowercasing here, an allowed origin
// like "https://HRM.zapsolutionz.com" in .env will silently reject the
// real browser Origin header "https://hrm.zapsolutionz.com".
const normalizeOrigin = (url) => url.trim().replace(/\/+$/, "").toLowerCase();

// Origins from FRONTEND_URL (e.g. your deployed Vercel URL) are always
// allowed. On top of that, always allow the common local Vite dev server
// origins too — so switching between local development and production
// never requires editing .env, and localhost:5173 doesn't get rejected
// just because FRONTEND_URL is currently pointed at the deployed site.
const LOCAL_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const allowedOrigins = [
  ...(process.env.FRONTEND_URL || "http://localhost:5173")
    .split(",")
    .map(normalizeOrigin),
  ...LOCAL_DEV_ORIGINS.map(normalizeOrigin),
].filter((origin, index, all) => all.indexOf(origin) === index);

app.use(
  cors({
    origin: (origin, callback) => {
      // allow non-browser tools (curl/Postman) that send no Origin header
      if (!origin) return callback(null, true);

      const normalizedOrigin = normalizeOrigin(origin);

      if (allowedOrigins.includes(normalizedOrigin)) {
        callback(null, true);
      } else {
        // Log exactly what was rejected vs what's allowed, so a mismatched
        // port/host/trailing-slash/case in FRONTEND_URL is easy to spot.
        console.warn(
          `❌ CORS rejected origin "${origin}". Allowed origins: ${allowedOrigins.join(", ")}. ` +
            `Check FRONTEND_URL in your backend .env file.`,
        );
        callback(null, false);
      }
    },
    credentials: true,
    // Let the browser show the Server-Timing numbers for cross-origin calls.
    exposedHeaders: ["Server-Timing"],
  }),
);
app.use((req, res, next) => {
  res.setHeader("Timing-Allow-Origin", "*");
  next();
});
// Cap request body size — an unauthenticated client could otherwise send
// huge JSON payloads to exhaust memory/CPU before any route-level auth or
// validation even runs.
// Staff document / profile photo uploads arrive as base64 JSON, so that one
// path gets a bigger limit (a phone photo is 1-5 MB, ~33% bigger as base64).
// It must run BEFORE the 2mb parser below, which then skips the parsed body.
app.use("/api/documents", express.json({ limit: "12mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
// Colourful per-request logs are useful while developing but add
// synchronous console I/O to every request in production.
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

// Any write to an HRM/staff route may change attendance, leave, holidays
// or staff dates — tell the attendance calendar to re-run its self-heal
// passes on the next view (see services/calendarHealCache.js).
app.use(["/api/hrm", "/api/staff"], invalidateCalendarHealOnWrite);
// Any write to auth/staff/HRM routes may change a user's role, permissions
// or relieved status — drop the short-lived login lookup cache in protect().
app.use(["/api/auth", "/api/hrm", "/api/staff"], (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    clearAuthUserCache();
    clearStaffVisibilityCache();
    res.on("finish", () => {
      clearAuthUserCache();
      clearStaffVisibilityCache();
    });
  }
  next();
});

// A new / changed / removed profile photo changes `photoUrl` in cached lists
// (e.g. the leave staff summary), so drop those cached answers right away.
app.use("/api/documents", (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.on("finish", () => invalidateResponseCache());
  }
  next();
});

// Disabled staff (Enable/Disable toggle on the Staff tab) appear ONLY on the
// Staff tab: their rows are dropped from these lists and dropdown sources.
// Attendance lists also drop days after a left staff member's last working
// day. See services/staffVisibility.js.
app.use(
  "/api/staff",
  hideDisabledStaffRows({ ownIdPaths: ["/"] }),
);
app.use(
  "/api/hrm/leaves",
  hideDisabledStaffRows({
    paths: ["/", "/staff-summary", "/requests/pending", "/requests/all"],
    attendancePaths: [
      "/attendance",
      "/attendance/today",
      "/attendance/yesterday",
      "/attendance/open-today",
    ],
  }),
);
app.use(
  "/api/hrm/payroll",
  hideDisabledStaffRows({ paths: ["/", "/pending-summary"] }),
);
app.use(
  "/api/hrm/staff-basic-payrolls",
  hideDisabledStaffRows({ paths: ["/", "/staff/available"] }),
);
app.use("/api/hrm/advances", hideDisabledStaffRows({ paths: ["/"] }));
// Admin attendance lists (the mobile app's "today" list uses these).
app.use(
  "/api/hrm/attendance",
  hideDisabledStaffRows({ attendancePaths: ["/", "/today", "/yesterday"] }),
);
app.use("/api/hrm/resignations", hideDisabledStaffRows({ paths: ["/all"] }));
app.use("/api/hrm/leave-policy", hideDisabledStaffRows({ paths: ["/balances"] }));
app.use("/api/hrm/letters", hideDisabledStaffRows({ paths: ["/issued"] }));
app.use("/api/documents", hideDisabledStaffRows({ paths: ["/summary"] }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/hrm/payroll", payrollRoutes);
app.use("/api/hrm/late-deduction", lateDeductionRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/hrm/attendance", attendanceRoutes);
app.use("/api/hrm/holidays", holidayRoutes);
app.use("/api/hrm/saturday-holidays", saturdayHolidayRoutes);
app.use("/api/hrm/leaves", leaveAttendanceRoutes);
app.use("/api/hrm/leave-policy", leavePolicyRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/hrm/advances", advanceRoutes);
app.use("/api/hrm/staff-basic-payrolls", staffBasicPayrollRoutes);
app.use("/api/hrm/expense-categories", expenseCategoryRoutes);
app.use("/api/hrm/office-expenses", officeExpenseRoutes);
app.use("/api/hrm/resignations", resignationRoutes);
// Live numbers for the sidebar badges (holidays this month, pending resignations, present today).
app.use("/api/hrm/sidebar-counts", sidebarCountsRoutes);
app.use("/api/hrm/counseling", counselingRoutes);
// Offer / joining / confirmation / termination / leaving / experience letters.
app.use("/api/hrm/letters", letterRoutes);
// Staff documents (Aadhaar, PAN, light bill) + profile photo.
app.use("/api/documents", documentRoutes);
// Automatic sign-in / sign-out from office Wi-Fi presence + PC agent.
app.use("/api/presence", presenceRoutes);

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "hrm-backend",
    message:
      "HRM backend API is running. See /health for a health check, and /api/... for endpoints.",
  });
});

// Public privacy policy page (linked from the Google Play store listing).
// Open: https://<your-domain>/privacy-policy
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const privacyPolicyFile = path.join(__dirname, "public", "privacy-policy.html");
app.get(["/privacy-policy", "/privacy-policy.html", "/privacy"], (req, res) => {
  res.sendFile(privacyPolicyFile);
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "hrm-backend",
    timestamp: new Date().toISOString(),
  });
});

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ Missing MONGO_URI in .env");
  process.exit(1);
}

// Refuse to boot without a real JWT secret rather than silently signing
// tokens with a guessable default — a missing env var should be loud, not
// a login-forgery vulnerability.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error(
    "❌ Missing or too-short JWT_SECRET in .env (use a long random value, e.g. `openssl rand -hex 32`)",
  );
  process.exit(1);
}

// A DB name like "test" or "dev" in a production connection string is a
// common copy-paste leftover from local setup — warn (don't block startup,
// since it may be intentional in a non-prod environment) so it doesn't go
// unnoticed until real data ends up in a throwaway database.
const dbNameMatch = MONGO_URI.match(/\/([^/?]+)(\?|$)/);
const dbName = dbNameMatch ? dbNameMatch[1] : null;
if (
  process.env.NODE_ENV === "production" &&
  dbName &&
  /^(test|dev|development|sample|demo)$/i.test(dbName)
) {
  console.warn(
    `⚠️  MONGO_URI points at database "${dbName}" while NODE_ENV=production. ` +
      `This looks like a placeholder/dev database name — double-check this is intentional.`,
  );
}

// Runs the absent-day auto-leave sweep once now (best-effort, for whatever
// was missed while the server was down) and then every 24h after that.
// This is a plain in-process timer rather than a real cron package — fine
// for a single-instance deployment; if this ever runs on more than one
// server process, prefer pointing an OS-level cron / PM2 cron at
// POST /api/hrm/leaves/reconcile-absences instead and set
// LEAVE_AUTOMATION_DISABLED=true here so it doesn't run twice.
function scheduleDailyAbsenceReconciliation() {
  if (process.env.LEAVE_AUTOMATION_DISABLED === "true") {
    return;
  }

  const runOnce = async () => {
    try {
      const summary = await reconcileAllStaffAbsences();
      markCalendarDataChanged();
    } catch (err) {
      console.error("❌ Daily absence reconciliation failed:", err.message);
    }
  };

  // Wait 2 minutes after startup before the first sweep: it touches every
  // staff member's attendance and used to run at the exact moment the first
  // people opened the app after a restart, slowing those first page loads.
  setTimeout(runOnce, 2 * 60 * 1000).unref?.();
  setInterval(runOnce, 24 * 60 * 60 * 1000);
}

// Automatic attendance: every few minutes, mark users whose devices went
// silent as disconnected and sign out anyone who left the office and didn't
// come back (see services/presence.js). Set PRESENCE_SWEEP_DISABLED=true to
// turn it off (e.g. on extra server instances).
function schedulePresenceSweep() {
  if (process.env.PRESENCE_SWEEP_DISABLED === "true") return;
  const everyMs =
    (parseInt(process.env.PRESENCE_SWEEP_INTERVAL_MINUTES, 10) || 5) * 60 * 1000;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runPresenceSweep();
      if (summary.timedOut || summary.signedOut) {
        console.log("🛰️  Presence sweep:", summary);
      }
    } catch (err) {
      console.error("❌ Presence sweep failed:", err.message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 60 * 1000).unref?.();
  setInterval(tick, everyMs).unref?.();
}

async function startServer(retries = 3, delayMs = 3000) {
  await ensureSrvResolvable(MONGO_URI);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await connectDB(MONGO_URI, checkSingleCompanyData);
      // Office Wi-Fi networks saved from the admin screen (utils/officeNetwork.js).
      await reloadOfficeNetworks();
      app.listen(PORT, () => {
      });
      scheduleDailyAbsenceReconciliation();
      schedulePresenceSweep();
      // Pre-build the payroll pending summary and staff summary so the first
      // Payroll / Dashboard visit after a restart doesn't have to wait.
      setTimeout(runCacheWarmers, 5000).unref?.();
      return;
    } catch (err) {
      if (err.fatal) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
      console.error(
        `❌ MongoDB connection attempt ${attempt} failed:`,
        err.message,
      );
      if (attempt === retries) {
        console.error("❌ Failed to start server after all retries:", err);
        process.exit(1);
      }
      console.log(`⏳ Retrying in ${delayMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

startServer();