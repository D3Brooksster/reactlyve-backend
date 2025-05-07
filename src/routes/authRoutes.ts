import { Router } from 'express';
import passport from 'passport';
import { googleCallback, getCurrentUser } from '../controllers/authController';
import { requireAuth } from '../middlewares/middleware';

const router = Router();

router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  googleCallback
);

router.get('/me', requireAuth, getCurrentUser);

export default router;