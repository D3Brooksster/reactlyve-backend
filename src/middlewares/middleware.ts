import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppUser } from '../entity/User'; // Changed User to AppUser
import { query } from '../config/database.config';
// AuthenticatedRequest import removed

declare global {
  namespace Express {
    interface Request {
      user?: AppUser; // Changed User to AppUser
      token?: string;
    }
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction):Promise<any> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.split(' ')[1];
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

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    // This case should ideally be caught by requireAuth first,
    // but as a safeguard:
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
  next();
};
