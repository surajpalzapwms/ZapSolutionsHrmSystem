import dns from "dns";

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
      console.log("✅ SRV lookup succeeded using fallback DNS resolvers.");
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
import counselingRoutes from "./routes/counseling.js";

const app = express();

// Deployed behind a reverse proxy (Render/Vercel/nginx/etc). Without this,
// req.ip is always the proxy's address, which breaks per-IP rate limiting
// (everyone shares one bucket) and any secure-cookie "is this really HTTPS"
// checks.
app.set("trust proxy", 1);

// Middleware
app.use(helmet());
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
  }),
);
// Cap request body size — an unauthenticated client could otherwise send
// huge JSON payloads to exhaust memory/CPU before any route-level auth or
// validation even runs.
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(morgan("dev"));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/hrm/payroll", payrollRoutes);
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
app.use("/api/hrm/counseling", counselingRoutes);

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "hrm-backend",
    message:
      "HRM backend API is running. See /health for a health check, and /api/... for endpoints.",
  });
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

async function startServer(retries = 3, delayMs = 3000) {
  await ensureSrvResolvable(MONGO_URI);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await connectDB(MONGO_URI);
      app.listen(PORT, () => {
        console.log(`🚀 HRM backend running on port ${PORT}`);
        console.log(`📊 Environment: ${process.env.NODE_ENV}`);
        console.log(`🌐 Allowed CORS origins: ${allowedOrigins.join(", ")}`);
      });
      return;
    } catch (err) {
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