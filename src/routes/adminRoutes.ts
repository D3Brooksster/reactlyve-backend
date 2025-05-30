// src/routes/adminRoutes.ts
import { Router } from 'express';
import {
  getAllUsers,
  updateUserRole,
  removeUser
} from '../controllers/adminController';
import { requireAuth, requireAdmin } // requireAdmin will be created in the next step
  from '../middlewares/middleware';

const router = Router();

// @route   GET /api/admin/users
// @desc    Get all users (admin)
// @access  Private (Admin)
router.get('/users', requireAuth, requireAdmin, getAllUsers);

// @route   PUT /api/admin/users/:userId/role
// @desc    Update user role (admin)
// @access  Private (Admin)
router.put('/users/:userId/role', requireAuth, requireAdmin, updateUserRole);

// @route   DELETE /api/admin/users/:userId
// @desc    Remove user (admin)
// @access  Private (Admin)
router.delete('/users/:userId', requireAuth, requireAdmin, removeUser);

export default router;
