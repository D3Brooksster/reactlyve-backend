// // import passport from 'passport';
// // import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
// // import { query } from './database.config';

// // passport.serializeUser((user: any, done) => {
// //   done(null, user.id);
// // });

// // passport.deserializeUser(async (id: number, done) => {
// //   try {
// //     const result = await query('SELECT * FROM users WHERE id = $1', [id]);
// //     const user = result.rows[0];
// //     done(null, user);
// //   } catch (error) {
// //     done(error, null);
// //   }
// // });

// // passport.use(
// //   new GoogleStrategy(
// //     {
// //       clientID: process.env.GOOGLE_CLIENT_ID!,
// //       clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
// //       callbackURL: process.env.GOOGLE_CALLBACK_URL!,
// //       scope: ['profile', 'email']
// //     },
// //     async (accessToken, refreshToken, profile, done) => {
// //       try {
// //         // Check if user already exists
// //         const existingUser = await query('SELECT * FROM users WHERE google_id = $1', [
// //           profile.id
// //         ]);

// //         if (existingUser.rows.length) {
// //           return done(null, existingUser.rows[0]);
// //         }

// //         // If not, create a new user
// //         const result = await query(
// //           'INSERT INTO users (googleId, email, name, picture) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
// //           [
// //             profile.id,
// //             profile.emails?.[0].value,
// //             profile.name,
// //             profile.picture,
// //             profile.name?.familyName,
// //             profile.photos?.[0].value
// //           ]
// //         );

// //         const newUser = result.rows[0];
// //         done(null, newUser);
// //       } catch (error) {
// //         //@ts-ignore
// //         done(error, null);
// //       }
// //     }
// //   )
// // );

// // export default passport;


// import passport from 'passport';
// import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
// import { query } from './database.config';
// import { User } from '../entity/User'; 

// // Serialize user
// passport.serializeUser((user: any, done) => {
//   done(null, user.id);
// });

// // Deserialize user
// passport.deserializeUser(async (id: number, done) => {
//   try {
//     const result = await query('SELECT * FROM users WHERE id = $1', [id]);
//     const user: User = result.rows[0];
//     done(null, user);
//   } catch (error) {
//     done(error, null);
//   }
// });

// // Use Google Strategy
// passport.use(
//   new GoogleStrategy(
//     {
//       clientID: process.env.GOOGLE_CLIENT_ID!,
//       clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
//       callbackURL: process.env.GOOGLE_CALLBACK_URL!,
//       scope: ['profile', 'email']
//     },
//     async (accessToken, refreshToken, profile, done) => {
//       try {
//         const googleId = profile.id;
//         const email = profile.emails?.[0]?.value;
//         const name = profile.displayName || '';
//         const picture = profile.photos?.[0]?.value;

//         // Check if user already exists
//         const existingUser = await query('SELECT * FROM users WHERE google_id = $1', [googleId]);

//         if (existingUser.rows.length > 0) {
//           return done(null, existingUser.rows[0]);
//         }

//         // If not, insert a new user
//         const result = await query(
//           'INSERT INTO users (google_id, email, name, picture) VALUES ($1, $2, $3, $4) RETURNING *',
//           [googleId, email, name, picture]
//         );

//         const newUser: User = result.rows[0];
//         return done(null, newUser);
//       } catch (error) {
//         return done(error as Error, null as any);
//       }
//     }
//   )
// );

// export default passport;


import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { query } from './database.config';
import { User } from '../entity/User';

// Serialize (store user ID in session)
passport.serializeUser<any, any>((user, done) => {
  //@ts-ignore
  done(null, user.id);
});

// Deserialize (fetch full user from DB)
passport.deserializeUser(async (id: string, done) => {
  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, rows[0] as User);
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
        return done(null, updatedUsers[0] as User);
      }

      // 2) Insert new user with role 'guest' and last_login
      const newUserResult = await query(
        `INSERT INTO users (google_id, email, name, picture, role, last_login)
         VALUES ($1, $2, $3, $4, 'guest', NOW())
         RETURNING *`,
        [google_id, email, name, picture]
      );

      return done(null, newUserResult.rows[0] as User);
    } catch (err) {
      return done(err as Error, undefined);
    }
  }
));

export default passport;
