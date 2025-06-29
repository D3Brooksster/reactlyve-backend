import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AppUser } from '../entity/User'; // Changed User to AppUser

export const generateToken = (user: AppUser):string => { // Changed User to AppUser
    const secret = process.env.JWT_SECRET as string;
    const expiresIn = process.env.JWT_EXPIRES_IN as string;

    if (!secret) {
        throw new Error('JWT_SECRET is not defined in environment variables.');
    }
      return jwt.sign({ id: user.id }, secret as jwt.Secret, {
        expiresIn: expiresIn as any,
    });

};

export const googleCallback = (req: Request, res: Response) => {
  const user = req.user as AppUser; // Changed User to AppUser
  const token = generateToken(user);
  const cookieOptions: any = {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 864e5,
  };
  if (process.env.NODE_ENV === 'production') {
    cookieOptions.secure = true;
  }
  res.cookie('token', token, cookieOptions);
  const redirectUrl = `${process.env.FRONTEND_URL}/auth/success`;
  res.redirect(redirectUrl);
  return; // Adjusted for void compatibility
};

export const logout = (req: Request, res: Response) => {
  const cookieOptions: any = {
    httpOnly: true,
    sameSite: 'lax',
  };
  if (process.env.NODE_ENV === 'production') {
    cookieOptions.secure = true;
  }
  res.clearCookie('token', cookieOptions);
  res.status(200).json({ message: 'Logged out successfully' });
};

export const getCurrentUser = (req: Request, res: Response) => {
  try {
    // requireAuth middleware should ensure req.user is populated.
    // If req.user is not present here, requireAuth did not call next() or there's a middleware setup issue.
    if (!req.user) { 
      // This case should ideally be handled by requireAuth, but as a safeguard.
      res.status(401).json({ error: 'Not authenticated, user not found on request.' });
      return;
    }
    const user = req.user as AppUser; // Changed User to AppUser
    const formattedUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      picture: user.picture,
      role: user.role,
      blocked: user.blocked,
      googleId: user.google_id,
      microsoftId: user.microsoft_id,
      facebookId: user.facebook_id,
      twitterId: user.twitter_id,
      createdAt: user.created_at ? new Date(user.created_at).toISOString() : null,
      updatedAt: user.updated_at ? new Date(user.updated_at).toISOString() : null,
      lastLogin: user.last_login ? new Date(user.last_login).toISOString() : null,
    };
    res.json({ user: formattedUser }); // Use formatted user
    return;
  } catch (error) {
    // It's good practice to log the error and send a generic server error response.
    console.error("Error in getCurrentUser:", error);
    res.status(500).json({ error: 'Internal server error.' });
    return;
  }
};
