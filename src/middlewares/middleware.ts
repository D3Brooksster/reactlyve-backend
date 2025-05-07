import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../entity/User';
import { query } from '../config/database.config';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      token?: string;
    }
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
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
    req.user = rows[0] as User;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
