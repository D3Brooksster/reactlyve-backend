// src/routes/adminRoutes.ts
import { Router } from 'express';
import {
  getAllUsers,
  updateUserRole,
  removeUser,
  setUserLimits, // Added import
  getUserDetails // Added import
  , getModerationSummary, getUserPendingModeration
} from '../controllers/adminController';
import {
  requireAuth,
  requireAdminRole // Changed from requireAdmin to requireAdminRole
} from '../middlewares/middleware';

const router = Router();

// @route   GET /api/admin/users
// @desc    Get all users (admin)
// @access  Private (Admin)
router.get('/users', requireAuth, requireAdminRole, getAllUsers);

// @route   PUT /api/admin/users/:userId/role
// @desc    Update user role (admin)
// @access  Private (Admin)
router.put('/users/:userId/role', requireAuth, requireAdminRole, updateUserRole);

// @route   DELETE /api/admin/users/:userId
// @desc    Remove user (admin)
// @access  Private (Admin)
router.delete('/users/:userId', requireAuth, requireAdminRole, removeUser);

// @route   PUT /api/admin/users/:userId/limits
// @desc    Set user message/reaction limits (admin)
// @access  Private (Admin)
router.put(
  '/users/:userId/limits',
  requireAuth,
  requireAdminRole,
  setUserLimits
);

// @route   GET /api/admin/users/:userId/details
// @desc    Get specific user details (admin)
// @access  Private (Admin)
router.get(
  '/users/:userId/details',
  requireAuth,
  requireAdminRole,
  getUserDetails
);

// @route   GET /api/admin/moderation/pending-counts
// @desc    Get count of manual review items for all users
// @access  Private (Admin)
router.get(
  '/moderation/pending-counts',
  requireAuth,
  requireAdminRole,
  getModerationSummary
);

// @route   GET /api/admin/users/:userId/pending-moderation
// @desc    Get Cloudinary IDs of items awaiting manual review for a user
// @access  Private (Admin)
router.get(
  '/users/:userId/pending-moderation',
  requireAuth,
  requireAdminRole,
  getUserPendingModeration
);

export default router;
