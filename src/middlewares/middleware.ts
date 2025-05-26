import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppUser } from '../entity/User'; // Import kept for type assertions
import { query } from '../config/database.config';
// AuthenticatedRequest import removed

// Global Express Request augmentation removed, will be handled by src/types/express.d.ts

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
