// src/types/express.d.ts
import { AppUser } from '../../entity/User'; // Corrected: AppUser is in User.ts

declare global {
  namespace Express {
    interface Request {
      user?: AppUser;
      token?: string;
    }
  }
}

export {}; // This ensures the file is treated as a module.
