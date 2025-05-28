import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { query } from './database.config';
import { AppUser } from '../entity/User'; // Changed User to AppUser

// Serialize (store user ID in session)
passport.serializeUser<AppUser, string>((user, done) => {
  done(null, user.id);
});

// Deserialize (fetch full user from DB)
passport.deserializeUser(async (id: string, done) => {
  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, rows[0] as AppUser); // Changed User to AppUser
  } catch (err) {
    done(err, null);
  }
});

passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL!,
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const google_id = profile.id;
      const email     = profile.emails?.[0]?.value!;
      const name      = profile.displayName!;
      const picture   = profile.photos?.[0]?.value!;

      // 1) Try to find existing user
      const { rows: existingUsers } = await query(
        `SELECT * FROM users WHERE google_id = $1`,
        [google_id]
      );

      if (existingUsers.length > 0) {
        // Existing user found, update last_login
        const { rows: updatedUsers } = await query(
          `UPDATE users SET last_login = NOW() WHERE google_id = $1 RETURNING *`,
          [google_id]
        );
        return done(null, updatedUsers[0] as AppUser); // Changed User to AppUser
      }

      // 2) Insert new user with role 'guest' and last_login
      const newUserResult = await query(
        `INSERT INTO users (google_id, email, name, picture, role, last_login)
         VALUES ($1, $2, $3, $4, 'guest', NOW())
         RETURNING *`,
        [google_id, email, name, picture]
      );

      return done(null, newUserResult.rows[0] as AppUser); // Changed User to AppUser
    } catch (err) {
      return done(err as Error, undefined);
    }
  }
));

export default passport;
