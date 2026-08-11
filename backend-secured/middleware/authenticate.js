// middleware/authenticate.js
//
// This replaces the three different auth middlewares that existed in the
// old codebase (middleware/auth.js, middleware/authMiddleware.js,
// utils/authMiddleware.js) which had drifted out of sync with each other
// (different error codes, one even had a broken/incomplete login route
// mixed into a "middleware" file). One canonical implementation now.

import { verifyAccessToken } from "../utils/token.js";
import User from "../models/User.js";

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Not authorized",
        code: "NO_TOKEN",
      });
    }

    const token = authHeader.slice(7); // strip "Bearer "

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      const code = err.name === "TokenExpiredError" ? "TOKEN_EXPIRED" : "TOKEN_INVALID";
      const message = err.name === "TokenExpiredError" ? "Session expired" : "Invalid token";
      return res.status(401).json({ success: false, message, code });
    }

    // Re-check the user on every request (cheap indexed lookup) rather
    // than trusting the JWT payload blindly. This means a deactivated
    // account is locked out immediately, not just after the token expires.
    const user = await User.findById(decoded.sub);

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Account not found or deactivated",
        code: "ACCOUNT_INACTIVE",
      });
    }

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: "Authentication error" });
  }
};
