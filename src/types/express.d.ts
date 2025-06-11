// src/types/express.d.ts
import { AppUser } from '../entity/User'; // Corrected import path

declare global {
  namespace Express {
    interface Request {
      user?: AppUser;
      token?: string;
    }
  }
}

export {}; // This ensures the file is treated as a module.
