// import { Request, Response } from 'express';
// import jwt from 'jsonwebtoken';
// import { User } from '../entity/User';

// export const generateToken = (user: User):string => {
//     const secret = process.env.JWT_SECRET as string;
//     const expiresIn = process.env.JWT_EXPIRES_IN as string;

//     if (!secret) {
//         throw new Error('JWT_SECRET is not defined in environment variables.');
//     }
//       return jwt.sign({ id: user.id }, secret as jwt.Secret, {
//         expiresIn: expiresIn as any,
//     });

// };

// export const googleCallback = (req: Request, res: Response) => {
//   const user = req.user as User;
//   const token = generateToken(user);
  
//   // You can send back a JWT token or redirect to the frontend with the token
//   // Option 1: Send JSON response
//   // return res.json({ token, user });
  
//   // Option 2: Redirect to frontend with token (better for OAuth flow)
//   return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/success?token=${token}`);
// };

// export const getCurrentUser = async (req: Request, res: Response):Promise<any> => {
//   try {
//     if (!req.user) {
//       return res.status(401).json({ error: 'Not authenticated' });
//     }
    
//     return res.json({ user: req.user });
//   } catch (error) {
//     return res.status(500).json({ error: 'Server error' });
//   }
// };

import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../entity/User';

export const generateToken = (user: User):string => {
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
  const user = req.user as User;
  const token = generateToken(user);
  // Redirect back to frontend with token
  const redirectUrl = `${process.env.FRONTEND_URL}/auth/success?token=${token}`;
  return res.redirect(redirectUrl);
};

export const getCurrentUser = (req: Request, res: Response) => {
  try {
    // requireAuth middleware should ensure req.user is populated.
    // If req.user is not present here, requireAuth did not call next() or there's a middleware setup issue.
    if (!req.user) { 
      // This case should ideally be handled by requireAuth, but as a safeguard.
      return res.status(401).json({ error: 'Not authenticated, user not found on request.' });
    }
    const user = req.user as User; // Explicitly assert the type
    return res.json({ user: user }); // Use asserted user
  } catch (error) {
    // It's good practice to log the error and send a generic server error response.
    console.error("Error in getCurrentUser:", error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
