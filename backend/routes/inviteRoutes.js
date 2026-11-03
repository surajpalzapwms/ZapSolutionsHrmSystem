import express from "express";
import { getInvite, acceptInvite } from "../controllers/inviteController.js";
import { loginRateLimiter, generalAuthRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// Public — the token in the link is the secret. Throttled like login, because
// these endpoints are unauthenticated and the accept step hits bcrypt.
router.get("/:token", generalAuthRateLimiter, getInvite);
router.post("/:token/accept", loginRateLimiter, acceptInvite);

export default router;
