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
  (req, res, next) => { // Then parse JSON if needed, or let controller handle rawBody
    // If the controller expects req.body to be parsed JSON after rawBody is read:
    // try {
    //   req.body = JSON.parse((req as any).rawBody.toString());
    // } catch (e) {
    //   // ignore parsing error if body isn't json, or handle as appropriate
    // }
    // The controller is currently written to expect (req as any).rawBody and then it parses.
    next();
  },
  handleCloudinaryModerationWebhook
);

export default router;
