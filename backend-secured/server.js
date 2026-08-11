import dns from "dns";

// Force reliable DNS resolvers so mongodb+srv:// SRV lookups don't fail
// on networks/ISPs whose default DNS doesn't handle SRV records properly
dns.setServers(["8.8.8.8", "1.1.1.1"]);

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

const app = express();

// Deployed behind a reverse proxy (Render/Vercel/nginx/etc). Without this,
// req.ip is always the proxy's address, which breaks per-IP rate limiting
// (everyone shares one bucket) and any secure-cookie "is this really HTTPS"
// checks.
app.set("trust proxy", 1);

// Middleware
app.use(helmet());
// Strip trailing slashes so "http://localhost:5173/" and "http://localhost:5173"
// are treated as the same origin (a common source of CORS rejections).
const stripTrailingSlash = (url) => url.trim().replace(/\/+$/, "");

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
    .map(stripTrailingSlash),
  ...LOCAL_DEV_ORIGINS,
].filter((origin, index, all) => all.indexOf(origin) === index);

app.use(
  cors({
    origin: (origin, callback) => {
      // allow non-browser tools (curl/Postman) that send no Origin header
      if (!origin) return callback(null, true);

      const normalizedOrigin = stripTrailingSlash(origin);

      if (allowedOrigins.includes(normalizedOrigin)) {
        callback(null, true);
      } else {
        // Log exactly what was rejected vs what's allowed, so a mismatched
        // port/host/trailing-slash in FRONTEND_URL is easy to spot.
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

// Root route - simple confirmation that the API is up.
// Without this, hitting the base URL in a browser shows Express's default
// "Cannot GET /" message, which looks like the server is down even when it's
// running fine (it's just that "/" itself has no route handler).
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
