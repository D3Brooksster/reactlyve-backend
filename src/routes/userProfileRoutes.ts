// src/routes/userProfileRoutes.ts
import { Router } from 'express';
import { getMyProfile, deleteMyAccount } from '../controllers/userProfileController';
import { requireAuth } from '../middlewares/middleware'; // Assuming requireAdmin is not needed here

const router = Router();

// @route   GET /api/profile/me
// @desc    Get current user's profile
// @access  Private
router.get('/me', requireAuth, getMyProfile);

// @route   DELETE /api/profile/me
// @desc    Delete current user's account
// @access  Private
router.delete('/me', requireAuth, deleteMyAccount);

export default router;
