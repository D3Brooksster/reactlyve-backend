import { Request, Response, NextFunction, CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AppUser } from '../entity/User'; // Import kept for type assertions
import { query } from '../config/database.config';
// AuthenticatedRequest import removed

// Global Express Request augmentation removed, will be handled by src/types/express.d.ts

export const requireAuth = async (req: Request, res: Response, next: NextFunction):Promise<any> => {
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { id: string };
    // Optionally fetch full user
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.id]);
    if (!rows.length) return res.status(401).json({ error: 'User not found' });
    req.user = rows[0] as AppUser; // Changed User to AppUser
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    // This case should ideally be caught by requireAuth first,
    // but as a safeguard:
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const user = req.user as AppUser; // Assert type
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    return;
  }
  next();
};

export const requireAdminRole = (req: Request, res: Response, next: NextFunction) => {
  if (req.user && (req.user as AppUser).role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Access denied. Admin role required.' });
  }
};

export const setOAuthStateCookie = (req: Request, res: Response, next: NextFunction) => {
  const state = crypto.randomBytes(16).toString('hex');
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  };
  if (process.env.NODE_ENV === 'production') {
    cookieOptions.secure = true;
  }
  res.cookie('oauth_state', state, cookieOptions);
  (req as any).oauthState = state;
  next();
};

export const verifyOAuthState = (req: Request, res: Response, next: NextFunction) => {
  const stateCookie = req.cookies?.oauth_state;
  const stateParam = req.query.state as string | undefined;
  if (!stateCookie || !stateParam || stateCookie !== stateParam) {
    res.status(400).json({ error: 'Invalid OAuth state' });
    return;
  }
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
  };
  if (process.env.NODE_ENV === 'production') {
    cookieOptions.secure = true;
  }
  res.clearCookie('oauth_state', cookieOptions);
  next();
};
