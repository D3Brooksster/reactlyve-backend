// src/routes/adminRoutes.ts
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getAllUsers,
  updateUserRole,
  removeUser
} from '../controllers/adminController';
import { requireAuth, requireAdmin } // requireAdmin will be created in the next step
  from '../middlewares/middleware';

const router = Router();

// Rate limiting: maximum of 100 requests per 15 minutes
const adminRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});

// @route   GET /api/admin/users
// @desc    Get all users (admin)
// @access  Private (Admin)
router.get('/users', adminRateLimiter, requireAuth, requireAdmin, getAllUsers);

// @route   PUT /api/admin/users/:userId/role
// @desc    Update user role (admin)
// @access  Private (Admin)
router.put('/users/:userId/role', adminRateLimiter, requireAuth, requireAdmin, updateUserRole);

// @route   DELETE /api/admin/users/:userId
// @desc    Remove user (admin)
// @access  Private (Admin)
router.delete('/users/:userId', adminRateLimiter, requireAuth, requireAdmin, removeUser);

export default router;
