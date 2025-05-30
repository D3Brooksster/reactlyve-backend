// src/routes/userProfileRoutes.ts
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getMyProfile, deleteMyAccount } from '../controllers/userProfileController';
import { requireAuth } from '../middlewares/middleware'; // Assuming requireAdmin is not needed here

const router = Router();

// Rate limiter: maximum of 100 requests per 15 minutes
const profileRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});

// @route   GET /api/profile/me
// @desc    Get current user's profile
// @access  Private
router.get('/me', profileRateLimiter, requireAuth, getMyProfile);

// @route   DELETE /api/profile/me
// @desc    Delete current user's account
// @access  Private
router.delete('/me', profileRateLimiter, requireAuth, deleteMyAccount);

export default router;
