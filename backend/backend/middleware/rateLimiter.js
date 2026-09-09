// middleware/rateLimiter.js
// Requires: npm install express-rate-limit
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { env } from "../config.js";

// Slows down brute-force password guessing against /login.
// Keyed by IP; the account lockout in User.js (registerFailedLogin)
// handles the case of an attacker rotating IPs against one account.
export const loginRateLimiter = rateLimit({
  windowMs: env.loginRateLimit.windowMs,
  max: env.loginRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
  },
});

// A looser limiter for general auth traffic (refresh, me, etc.)
export const generalAuthRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// Keyed by logged-in user id when available, otherwise falls back to IP.
// express-rate-limit v7 requires that IP fallback to go through
// ipKeyGenerator() so IPv6 addresses get normalized (bare req.ip would let
// an IPv6 attacker rotate the tail of their address to dodge the limit).
export const bulkOperationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 import/export calls per admin per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many bulk operations from this account. Please try again later.",
  },
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
});

export const writeOperationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 create/update/delete calls per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please slow down and try again shortly.",
  },
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
});