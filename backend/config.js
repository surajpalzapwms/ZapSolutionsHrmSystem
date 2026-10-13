import dotenv from "dotenv";

dotenv.config();

export const env = {
  // Server
  port: parseInt(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || "development",

  // JWT
  // No insecure fallback here on purpose: signing tokens with a guessable
  // default secret is worse than failing to start. server.js checks for
  // JWT_SECRET at boot (alongside MONGO_URI) and exits if it's missing.
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",

  // Database
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/zapwms",

  // Rate Limiting
  loginRateLimit: {
    windowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 20,
  },

  // Frontend/Backend URLs
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  backendUrl: process.env.BACKEND_URL || "http://localhost:5000",

  // Email
  email: {
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: parseInt(process.env.EMAIL_PORT) || 587,
    user: process.env.EMAIL_USER || "",
    pass: process.env.EMAIL_PASS || "",
    from: process.env.EMAIL_FROM || "noreply@zapwms.com",
  },
};

export default env;