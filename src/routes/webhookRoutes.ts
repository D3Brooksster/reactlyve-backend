import express, { Router } from 'express';
import { handleCloudinaryModerationWebhook } from '../controllers/webhookController';

const router = Router();

// Middleware to make raw body available for this specific route
// This should be placed before express.json() if that is used globally without a verify function
// Or, ensure the global express.json() has a verify function that saves rawBody.
// For simplicity here, using express.raw() specifically for this route.
router.post(
  '/cloudinary-moderation',
  express.raw({ type: 'application/json' }), // Process as raw first
  handleCloudinaryModerationWebhook
);

export default router;
