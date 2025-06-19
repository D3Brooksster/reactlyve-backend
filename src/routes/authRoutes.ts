// import { Router } from 'express';
// import passport from 'passport';
// import { googleCallback, getCurrentUser } from '../controllers/authController';
// import { requireAuth } from '../middlewares/middleware';

// const router = Router();

// router.get(
//   '/google',
//   passport.authenticate('google', { scope: ['profile', 'email'] })
// );

// router.get(
//   '/google/callback',
//   passport.authenticate('google', { session: false, failureRedirect: '/login' }),
//   googleCallback
// );

// router.get('/me', requireAuth, getCurrentUser);

// export default router;

import { Router } from 'express';
import passport from 'passport';
import { googleCallback, getCurrentUser, logout } from '../controllers/authController';
import { requireAuth, setOAuthStateCookie, verifyOAuthState } from '../middlewares/middleware';

const router = Router();

router.get('/google', setOAuthStateCookie, (req: any, res, next) => {
  const state = req.oauthState as string;
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    state,
  })(req, res, next);
});

router.get(
  '/google/callback',
  verifyOAuthState,
  passport.authenticate('google', {
    session: false,
    failureRedirect: `${process.env.FRONTEND_URL}/login`
  }),
  googleCallback
);
//@ts-ignore
router.get('/me', requireAuth, getCurrentUser);

router.post('/logout', logout);

export default router;
